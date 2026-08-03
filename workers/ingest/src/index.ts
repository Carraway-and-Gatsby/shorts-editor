import { startStageWorker } from '@shorts/queue';

const runtime = startStageWorker({
  stage: 'ingest',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  healthPort: Number(process.env.HEALTH_PORT ?? 8081),
  handler: async (payload) => {
    // M1: 원본 검증, 프록시 트랜스코드, 썸네일 추출 구현 (docs/04-pipeline-spec.md §4.1)
    console.log('[worker:ingest] received job (no-op skeleton):', payload);
  },
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void runtime.close().then(() => process.exit(0));
  });
}
