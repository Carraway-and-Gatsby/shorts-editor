import IORedis from 'ioredis';
import pg from 'pg';
import { buildServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3000);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://shorts:shorts@localhost:5432/shorts';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref(),
    ),
  ]);
}

async function main(): Promise<void> {
  const redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('error', (err) => {
    console.error('[api] redis error:', err.message);
  });

  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
  pool.on('error', (err) => {
    console.error('[api] postgres pool error:', err.message);
  });

  const app = buildServer({
    checkRedis: () =>
      withTimeout(redis.ping(), 1500)
        .then(() => true)
        .catch(() => false),
    checkPostgres: () =>
      withTimeout(pool.query('SELECT 1'), 1500)
        .then(() => true)
        .catch(() => false),
  });

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
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
