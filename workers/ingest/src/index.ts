import fs from 'node:fs';
import path from 'node:path';
import { createPgRepos, createPool } from '@shorts/db';
import {
  loadBgmCatalog,
  loadPresetCatalog,
  parseBannedWords,
  presetsById,
  processComposeJob,
  processIngestJob,
  type PipelineDeps,
  type ScoringConfig,
} from '@shorts/media';
import { BullStageQueue, startStageWorker } from '@shorts/queue';
import { storageFromEnv } from '@shorts/storage';
import { parse as parseYaml } from 'yaml';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://shorts:shorts@localhost:5432/shorts';
const SCORING_CONFIG_PATH = process.env.SCORING_CONFIG ?? './config/scoring.yaml';
const PRESETS_DIR = process.env.PRESETS_DIR ?? './config/presets';
const BGM_CATALOG = process.env.BGM_CATALOG ?? './assets/bgm/catalog.json';
const BANNED_WORDS = process.env.BANNED_WORDS ?? './config/banned-words.json';

function loadBannedWords(): string[] {
  try {
    return parseBannedWords(fs.readFileSync(path.resolve(BANNED_WORDS), 'utf8'));
  } catch {
    return [];
  }
}

function loadScoringConfig(): ScoringConfig | undefined {
  try {
    const raw = fs.readFileSync(path.resolve(SCORING_CONFIG_PATH), 'utf8');
    const parsed = parseYaml(raw) as ScoringConfig;
    if (parsed?.weights && parsed?.penalties) {
      console.log(`[worker:ingest] scoring config loaded from ${SCORING_CONFIG_PATH}`);
      return parsed;
    }
  } catch {
    // 기본 가중치 사용
  }
  return undefined;
}

const pool = createPool(DATABASE_URL);
const queue = new BullStageQueue(REDIS_URL);

const deps: PipelineDeps = {
  repos: createPgRepos(pool),
  storage: storageFromEnv(),
  enqueueAnalyze: (payload) => queue.enqueue('analyze', payload),
  // 렌더 실패는 1회 자동 재시도 (docs/04-pipeline-spec.md §4.4)
  enqueueRender: (payload) => queue.enqueue('render', payload, { attempts: 2 }),
  scoring: loadScoringConfig(),
  presets: presetsById(loadPresetCatalog(PRESETS_DIR)),
  bgmCatalog: loadBgmCatalog(BGM_CATALOG),
  bannedWords: loadBannedWords(),
};

// 이 프로세스는 ingest와 compose 두 큐를 소비한다 (compose는 경량 데이터 작업)
const ingestRuntime = startStageWorker({
  stage: 'ingest',
  redisUrl: REDIS_URL,
  healthPort: Number(process.env.HEALTH_PORT ?? 8081),
  handler: (payload) => processIngestJob(deps, payload),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
});
const composeRuntime = startStageWorker({
  stage: 'compose',
  redisUrl: REDIS_URL,
  handler: (payload) => processComposeJob(deps, payload),
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void Promise.all([ingestRuntime.close(), composeRuntime.close()])
      .then(() => queue.close())
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
}
