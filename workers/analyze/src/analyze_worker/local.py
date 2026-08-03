"""로컬 디버깅용 CLI: 큐/DB 없이 분석만 실행한다.

사용법: STORAGE_ROOT=./storage-data python -m analyze_worker.local <jobId>
(Ingest가 만든 proxy.mp4 / audio.wav가 스토리지에 있어야 한다)
"""

import json
import logging
import sys

from .analyze import analyze_job, write_analysis

logging.basicConfig(level=logging.INFO, format="[analyze:local] %(message)s")


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python -m analyze_worker.local <jobId>", file=sys.stderr)
        raise SystemExit(2)
    job_id = sys.argv[1]
    doc = analyze_job(job_id, progress=lambda p: print(f"progress {p}%", file=sys.stderr))
    path = write_analysis(job_id, doc)
    print(json.dumps({"written": str(path), "warnings": doc["warnings"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
