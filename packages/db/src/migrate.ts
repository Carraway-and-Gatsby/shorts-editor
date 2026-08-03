import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

const MIGRATION_LOCK_ID = 727270;

/**
 * migrations 디렉터리의 .sql 파일을 파일명 순서로 적용한다.
 * advisory lock으로 다중 인스턴스 동시 실행을 막고, 적용 이력은 schema_migrations에 기록한다.
 */
export async function migrate(pool: pg.Pool, migrationsDir: string): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [
        file,
      ]);
      if (rowCount) {
        continue;
      }
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

/** 패키지에 내장된 기본 마이그레이션 디렉터리 */
export function defaultMigrationsDir(): string {
  return path.resolve(__dirname, '..', 'migrations');
}
