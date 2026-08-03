import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemoryRepos, type JobOptions } from '@shorts/db';
import { LocalFsStorage } from '@shorts/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { FileTokenSigner } from './lib/signer.js';
import { buildServer } from './server.js';

const OPTIONS: JobOptions = {
  targetDuration: 'auto',
  preset: 'clean',
  subtitle: 'on',
  bgm: 'auto',
  reframe: 'auto',
  language: 'auto',
};

describe('auth (F-42)', () => {
  let root: string;
  let deps: AppDeps;
  let app: FastifyInstance;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shorts-auth-'));
    deps = {
      repos: createMemoryRepos(),
      storage: new LocalFsStorage(root),
      queue: { enqueue: async () => {}, close: async () => {} },
      signer: new FileTokenSigner('test-secret'),
      presetCatalog: [],
      bgmCatalog: [],
      checkRedis: async () => true,
      checkPostgres: async () => true,
    };
    app = await buildServer(deps);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function newSession(): Promise<string> {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    return res.cookies.find((c) => c.name === 'sid')!.value;
  }

  it('signs up, reports the user, and rejects duplicates', async () => {
    const sid = await newSession();
    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      cookies: { sid },
      payload: { email: 'Me@Example.com', password: 'password123' },
    });
    expect(signup.statusCode).toBe(201);
    expect(signup.json().user.email).toBe('me@example.com');

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { sid } });
    expect(me.json().user.email).toBe('me@example.com');

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      cookies: { sid: await newSession() },
      payload: { email: 'me@example.com', password: 'password123' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('validates email and password on signup', async () => {
    const sid = await newSession();
    const badEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      cookies: { sid },
      payload: { email: 'not-an-email', password: 'password123' },
    });
    expect(badEmail.statusCode).toBe(400);
    const shortPw = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      cookies: { sid },
      payload: { email: 'a@b.com', password: 'short' },
    });
    expect(shortPw.statusCode).toBe(400);
  });

  it('merges anonymous jobs on signup and shares them across sessions (F-42)', async () => {
    // 익명 세션에서 잡 생성
    const sid1 = await newSession();
    await deps.repos.jobs.create({
      id: 'job_anon',
      sessionId: sid1,
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const signup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      cookies: { sid: sid1 },
      payload: { email: 'merge@example.com', password: 'password123' },
    });
    expect(signup.json().mergedJobs).toBe(1);

    // 다른 기기(새 세션)에서 로그인하면 병합된 잡이 보인다
    const sid2 = await newSession();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      cookies: { sid: sid2 },
      payload: { email: 'merge@example.com', password: 'password123' },
    });
    expect(login.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/v1/jobs', cookies: { sid: sid2 } });
    expect(list.json().jobs.map((j: { jobId: string }) => j.jobId)).toContain('job_anon');

    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/job_anon',
      cookies: { sid: sid2 },
    });
    expect(detail.statusCode).toBe(200);

    // 로그인하지 않은 제3의 세션에서는 보이지 않는다
    const sid3 = await newSession();
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs/job_anon',
      cookies: { sid: sid3 },
    });
    expect(denied.statusCode).toBe(404);
  });

  it('rejects wrong credentials and supports logout', async () => {
    const sid = await newSession();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      cookies: { sid },
      payload: { email: 'out@example.com', password: 'password123' },
    });

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      cookies: { sid: await newSession() },
      payload: { email: 'out@example.com', password: 'wrong-password' },
    });
    expect(wrong.statusCode).toBe(401);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { sid },
    });
    expect(logout.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { sid } });
    expect(me.json().user).toBeNull();
  });
});
