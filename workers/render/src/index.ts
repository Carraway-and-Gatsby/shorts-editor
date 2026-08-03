import { createPgRepos, createPool } from '@shorts/db';
import { processRenderJob, type PipelineDeps } from '@shorts/media';
import { startStageWorker } from '@shorts/queue';
import { storageFromEnv } from '@shorts/storage';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://shorts:shorts@localhost:5432/shorts';
const BGM_DIR = process.env.BGM_DIR ?? './assets/bgm';

const pool = createPool(DATABASE_URL);

const deps: PipelineDeps = {
  repos: createPgRepos(pool),
  storage: storageFromEnv(),
  enqueueAnalyze: async () => {
    throw new Error('render worker does not enqueue analyze jobs');
  },
  enqueueRender: async () => {
    throw new Error('render worker does not enqueue render jobs');
  },
  bgmDir: BGM_DIR,
};

const runtime = startStageWorker({
  stage: 'render',
  redisUrl: REDIS_URL,
  healthPort: Number(process.env.HEALTH_PORT ?? 8082),
  handler: (payload, context) =>
    processRenderJob(deps, payload, {
      isFinalAttempt: context.attemptsMade + 1 >= context.attemptsTotal,
    }),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void runtime
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
