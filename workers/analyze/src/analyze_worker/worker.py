"""BullMQ 큐 소비: stage-analyze → 분석 → stage-compose enqueue."""

import asyncio
import logging
import os

from bullmq import Queue, Worker

from . import db
from .analyze import analyze_job, write_analysis

log = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
ANALYZE_QUEUE = "stage-analyze"
COMPOSE_QUEUE = "stage-compose"


async def run_worker(shutdown: asyncio.Event) -> None:
    compose_queue = Queue(COMPOSE_QUEUE, {"connection": REDIS_URL})

    async def process(job, _token: str):
        payload = job.data
        job_id = payload["jobId"]
        log.info("analyzing job %s", job_id)

        status = await asyncio.to_thread(db.get_job_status, job_id)
        if status != "ANALYZING":
            log.warning("skipping job %s in status %s", job_id, status)
            return {}

        def report(progress: int) -> None:
            db.set_progress(job_id, "analyze", progress)

        try:
            language = os.environ.get("STT_LANGUAGE", "auto")
            doc = await asyncio.to_thread(analyze_job, job_id, language, report)
            await asyncio.to_thread(write_analysis, job_id, doc)
        except Exception as err:
            # 시각 분석 실패는 잡 실패 (docs/04-pipeline-spec.md §4.2 실패 정책)
            log.exception("analysis failed for %s", job_id)
            await asyncio.to_thread(
                db.fail_job,
                job_id,
                "ANALYZE_FAILED",
                "영상 분석 중 오류가 발생했습니다.",
                {"message": str(err)},
            )
            raise

        await asyncio.to_thread(db.set_progress, job_id, "analyze", 45)
        await compose_queue.add("compose", payload, {})
        log.info("job %s analyzed, compose enqueued (warnings: %s)", job_id, doc["warnings"])
        return {}

    worker = Worker(ANALYZE_QUEUE, process, {"connection": REDIS_URL, "concurrency": 1})
    log.info("consuming queue %s", ANALYZE_QUEUE)
    await shutdown.wait()
    log.info("shutting down worker")
    await worker.close()
    await compose_queue.close()
