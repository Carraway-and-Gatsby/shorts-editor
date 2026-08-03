import { createPgRepos, createPool, defaultMigrationsDir, migrate } from '@shorts/db';
import { loadBgmCatalog, loadPresetCatalog } from '@shorts/media';
import { BullStageQueue } from '@shorts/queue';
import { LocalFsStorage } from '@shorts/storage';
import IORedis from 'ioredis';
import { scheduleCleanup } from './cleanup.js';
import { FileTokenSigner } from './lib/signer.js';
import { buildServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3000);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://shorts:shorts@localhost:5432/shorts';
const STORAGE_ROOT = process.env.STORAGE_ROOT ?? './storage-data';
const FILE_TOKEN_SECRET = process.env.FILE_TOKEN_SECRET ?? '';
const PRESETS_DIR = process.env.PRESETS_DIR ?? './config/presets';
const BGM_CATALOG = process.env.BGM_CATALOG ?? './assets/bgm/catalog.json';
const CLEANUP_INTERVAL_HOURS = Number(process.env.CLEANUP_INTERVAL_HOURS ?? 24);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref(),
    ),
  ]);
}

async function main(): Promise<void> {
  let fileTokenSecret = FILE_TOKEN_SECRET;
  if (!fileTokenSecret) {
    console.warn('[api] FILE_TOKEN_SECRET not set — using an insecure development secret');
    fileTokenSecret = 'dev-file-token-secret';
  }

  const redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('error', (err) => {
    console.error('[api] redis error:', err.message);
  });

  const pool = createPool(DATABASE_URL);
  const applied = await migrate(pool, defaultMigrationsDir());
  if (applied.length > 0) {
    console.log('[api] applied migrations:', applied.join(', '));
  }

  const queue = new BullStageQueue(REDIS_URL);
  const repos = createPgRepos(pool);
  const storage = new LocalFsStorage(STORAGE_ROOT);

  const app = await buildServer({
    repos,
    storage,
    queue,
    signer: new FileTokenSigner(fileTokenSecret),
    presetCatalog: loadPresetCatalog(PRESETS_DIR),
    bgmCatalog: loadBgmCatalog(BGM_CATALOG),
    checkRedis: () =>
      withTimeout(redis.ping(), 1500)
        .then(() => true)
        .catch(() => false),
    checkPostgres: () =>
      withTimeout(pool.query('SELECT 1'), 1500)
        .then(() => true)
        .catch(() => false),
  });

  // 보관 정책 정리 배치 (F-41, docs/07-data-model.md §7.5)
  scheduleCleanup({ repos, storage }, CLEANUP_INTERVAL_HOURS, app.log);

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await queue.close();
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: PORT });
}

main().catch((err) => {
  console.error('[api] fatal:', err);
  process.exit(1);
});
