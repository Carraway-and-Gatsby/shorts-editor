import { randomBytes } from 'node:crypto';
import pg from 'pg';

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  pool.on('error', (err) => {
    console.error('[db] pool error:', err.message);
  });
  return pool;
}

/** 접두사 있는 불투명 ID 생성 (예: job_x1y2z3…) */
export function newId(prefix: 'ses' | 'up' | 'job'): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}
