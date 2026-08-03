import http from 'node:http';
import type { JobStage } from '@shorts/shared';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { QUEUE_NAMES, type StageJobPayload } from './names.js';

export interface StageJobContext {
  /** 이번 실행 이전까지의 시도 횟수 (0 = 첫 시도) */
  attemptsMade: number;
  /** 설정된 총 시도 횟수 */
  attemptsTotal: number;
}

export interface StageWorkerOptions {
  stage: JobStage;
  redisUrl: string;
  /** /healthz 엔드포인트를 노출할 포트 */
  healthPort: number;
  handler: (payload: StageJobPayload, context: StageJobContext) => Promise<void>;
  concurrency?: number;
}

export interface StageWorkerRuntime {
  close(): Promise<void>;
}

/**
 * 단계 워커 공통 런타임: BullMQ 워커 + HTTP 헬스체크 서버.
 * 헬스체크는 Redis 연결이 준비 상태일 때 200, 아니면 503을 반환한다.
 */
export function startStageWorker(options: StageWorkerOptions): StageWorkerRuntime {
  const { stage, redisUrl, healthPort, handler, concurrency = 1 } = options;

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (err) => {
    console.error(`[worker:${stage}] redis error:`, err.message);
  });

  const worker = new Worker(
    QUEUE_NAMES[stage],
    async (job) =>
      handler(job.data as StageJobPayload, {
        attemptsMade: job.attemptsMade,
        attemptsTotal: job.opts.attempts ?? 1,
      }),
    { connection, concurrency },
  );
  worker.on('failed', (job, err) => {
    console.error(`[worker:${stage}] job ${job?.id ?? '?'} failed:`, err.message);
  });
  worker.on('ready', () => {
    console.log(`[worker:${stage}] ready, consuming queue "${QUEUE_NAMES[stage]}"`);
  });

  const server = http.createServer((req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }
    const redisOk = connection.status === 'ready';
    res
      .writeHead(redisOk ? 200 : 503, { 'content-type': 'application/json' })
      .end(
        JSON.stringify({
          status: redisOk ? 'ok' : 'degraded',
          stage,
          redis: redisOk ? 'up' : 'down',
        }),
      );
  });
  server.listen(healthPort, () => {
    console.log(`[worker:${stage}] health endpoint on :${healthPort}/healthz`);
  });

  return {
    async close(): Promise<void> {
      await worker.close();
      await connection.quit().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
