import { startStageWorker } from '@shorts/queue';

const runtime = startStageWorker({
  stage: 'render',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  healthPort: Number(process.env.HEALTH_PORT ?? 8082),
  handler: async (payload) => {
    // M1: 9:16 pad 변환 렌더링 구현 (docs/04-pipeline-spec.md §4.4)
    console.log('[worker:render] received job (no-op skeleton):', payload);
  },
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void runtime.close().then(() => process.exit(0));
  });
}
