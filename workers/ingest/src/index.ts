import { createPgRepos, createPool } from '@shorts/db';
import { processIngestJob, type PipelineDeps } from '@shorts/media';
import { BullStageQueue, startStageWorker } from '@shorts/queue';
import { LocalFsStorage } from '@shorts/storage';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://shorts:shorts@localhost:5432/shorts';
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? './storage-data';

const pool = createPool(DATABASE_URL);
const queue = new BullStageQueue(REDIS_URL);

const deps: PipelineDeps = {
  repos: createPgRepos(pool),
  storage: new LocalFsStorage(STORAGE_ROOT),
  // 렌더 실패는 1회 자동 재시도 (docs/04-pipeline-spec.md §4.4)
  enqueueRender: (payload) => queue.enqueue('render', payload, { attempts: 2 }),
};

const runtime = startStageWorker({
  stage: 'ingest',
  redisUrl: REDIS_URL,
  healthPort: Number(process.env.HEALTH_PORT ?? 8081),
  handler: (payload) => processIngestJob(deps, payload),
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void runtime
      .close()
      .then(() => queue.close())
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
