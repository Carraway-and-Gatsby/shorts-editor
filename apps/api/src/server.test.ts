import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('healthz', () => {
  it('returns 200 when all dependencies are up', async () => {
    const app = buildServer({
      checkRedis: async () => true,
      checkPostgres: async () => true,
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', redis: 'up', postgres: 'up' });
    await app.close();
  });

  it('returns 503 when redis is down', async () => {
    const app = buildServer({
      checkRedis: async () => false,
      checkPostgres: async () => true,
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', redis: 'down', postgres: 'up' });
    await app.close();
  });

  it('handles a check that throws as down', async () => {
    const app = buildServer({
      checkRedis: async () => true,
      checkPostgres: async () => {
        throw new Error('connection refused');
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().postgres).toBe('down');
    await app.close();
  });

  it('exposes the same health check under /api/v1', async () => {
    const app = buildServer({
      checkRedis: async () => true,
      checkPostgres: async () => true,
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
