import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemoryRepos } from '@shorts/db';
import type { EnqueueOptions, StageJobPayload } from '@shorts/queue';
import type { JobStage } from '@shorts/shared';
import { LocalFsStorage, storageKeys } from '@shorts/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { FileTokenSigner } from './lib/signer.js';
import { CHUNK_SIZE } from './lib/upload-rules.js';
import { buildServer } from './server.js';

interface EnqueuedJob {
  stage: JobStage;
  payload: StageJobPayload;
  options?: EnqueueOptions;
}

function createTestDeps(storageRoot: string): AppDeps & { enqueued: EnqueuedJob[] } {
  const enqueued: EnqueuedJob[] = [];
  return {
    repos: createMemoryRepos(),
    storage: new LocalFsStorage(storageRoot),
    queue: {
      async enqueue(stage, payload, options) {
        enqueued.push({ stage, payload, options });
      },
      async close() {},
    },
    signer: new FileTokenSigner('test-secret'),
    presetCatalog: [
      { id: 'clean', name: '클린', bgmMood: 'calm', titleCard: false },
      { id: 'promo', name: '프로모', bgmMood: 'energetic', titleCard: true },
    ],
    bgmCatalog: [
      {
        id: 'bgm_calm_01',
        name: 'Calm',
        moods: ['calm'],
        durationSeconds: 24,
        file: 'bgm_calm_01.m4a',
        licenseNote: 'CC0',
      },
    ],
    checkRedis: async () => true,
    checkPostgres: async () => true,
    enqueued,
  };
}

describe('api server', () => {
  let root: string;
  let deps: ReturnType<typeof createTestDeps>;
  let app: FastifyInstance;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shorts-api-'));
    deps = createTestDeps(root);
    app = await buildServer(deps);
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function newSessionCookie(): Promise<string> {
    const res = await app.inject({ method: 'GET', url: '/api/v1/jobs/none' });
    const sid = res.cookies.find((c) => c.name === 'sid');
    expect(sid).toBeDefined();
    return sid!.value;
  }

  describe('healthz', () => {
    it('returns 200 when dependencies are up', async () => {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', redis: 'up', postgres: 'up' });
    });

    it('returns 503 when a dependency is down', async () => {
      deps.checkRedis = async () => false;
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(503);
      expect(res.json().redis).toBe('down');
    });
  });

  describe('upload flow', () => {
    it('uploads chunks, assembles the source, and creates a QUEUED job', async () => {
      const sid = await newSessionCookie();
      const content = Buffer.from('fake video bytes for testing');

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        cookies: { sid },
        payload: { filename: 'clip.mp4', size: content.length, mimeType: 'video/mp4' },
      });
      expect(created.statusCode).toBe(201);
      const { uploadId, chunkSize } = created.json();
      expect(chunkSize).toBe(CHUNK_SIZE);

      const put = await app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${uploadId}/chunks/0`,
        cookies: { sid },
        headers: { 'content-type': 'application/octet-stream' },
        payload: content,
      });
      expect(put.statusCode).toBe(204);

      const completed = await app.inject({
        method: 'POST',
        url: `/api/v1/uploads/${uploadId}/complete`,
        cookies: { sid },
        payload: { options: { targetDuration: 30 } },
      });
      expect(completed.statusCode).toBe(201);
      const { jobId, status } = completed.json();
      expect(status).toBe('QUEUED');

      // 원본이 조립되어 저장됨
      const source = await deps.storage.get(storageKeys.source(jobId, 'mp4'));
      expect(source.equals(content)).toBe(true);
      // ingest 큐에 등록됨
      expect(deps.enqueued).toEqual([
        { stage: 'ingest', payload: { jobId, revision: 1 }, options: undefined },
      ]);
      // 옵션이 기본값과 병합되어 저장됨
      const job = await deps.repos.jobs.find(jobId);
      expect(job?.options.targetDuration).toBe(30);
      expect(job?.options.preset).toBe('clean');
    });

    it('rejects a chunk with the wrong size', async () => {
      const sid = await newSessionCookie();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        cookies: { sid },
        payload: { filename: 'clip.mp4', size: 100, mimeType: 'video/mp4' },
      });
      const { uploadId } = created.json();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${uploadId}/chunks/0`,
        cookies: { sid },
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(50),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects completion when chunks are missing', async () => {
      const sid = await newSessionCookie();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        cookies: { sid },
        payload: { filename: 'clip.mp4', size: CHUNK_SIZE + 10, mimeType: 'video/mp4' },
      });
      const { uploadId } = created.json();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/uploads/${uploadId}/complete`,
        cookies: { sid },
        payload: {},
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects oversized and unsupported uploads up front', async () => {
      const sid = await newSessionCookie();
      const tooBig = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        cookies: { sid },
        payload: { filename: 'clip.mp4', size: 3 * 1024 ** 3, mimeType: 'video/mp4' },
      });
      expect(tooBig.statusCode).toBe(413);

      const badType = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        cookies: { sid },
        payload: { filename: 'audio.m4a', size: 100, mimeType: 'audio/mp4' },
      });
      expect(badType.statusCode).toBe(422);
    });

    it('hides uploads from other sessions', async () => {
      const sid = await newSessionCookie();
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/uploads',
        cookies: { sid },
        payload: { filename: 'clip.mp4', size: 100, mimeType: 'video/mp4' },
      });
      const { uploadId } = created.json();

      const otherSid = await newSessionCookie();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/uploads/${uploadId}/chunks/0`,
        cookies: { sid: otherSid },
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(100),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('job endpoints', () => {
    async function seedDoneJob(sessionId: string): Promise<string> {
      await deps.repos.sessions.create(sessionId);
      const job = await deps.repos.jobs.create({
        id: 'job_done',
        sessionId,
        options: {
          targetDuration: 'auto',
          preset: 'clean',
          subtitle: 'on',
          bgm: 'auto',
          reframe: 'auto',
          language: 'auto',
        },
        sourceExt: 'mp4',
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await deps.repos.jobs.transition(job.id, 'QUEUED', 'ANALYZING');
      await deps.repos.jobs.transition(job.id, 'ANALYZING', 'COMPOSING');
      await deps.repos.jobs.transition(job.id, 'COMPOSING', 'RENDERING');
      await deps.repos.jobs.transition(job.id, 'RENDERING', 'DONE', { progress: 100 });
      const outputKey = storageKeys.output(job.id, 1);
      await deps.storage.put(outputKey, 'rendered-video-bytes');
      await deps.repos.jobs.insertComposition(
        job.id,
        1,
        {
          version: 1,
          jobId: job.id,
          revision: 1,
          output: { width: 1080, height: 1920, fps: 30, duration: 10 },
          cuts: [{ id: 'c1', sourceStart: 0, sourceEnd: 10, transition: 'cut' }],
          reframe: { mode: 'pad', keyframes: [] },
          subtitles: { style: 'clean', blocks: [] },
          audio: { bgm: null, loudnessTarget: -14 },
          style: { preset: 'clean', titleCard: null, lut: null },
        },
        'auto',
      );
      await deps.repos.jobs.insertOutput({
        jobId: job.id,
        revision: 1,
        storageKey: outputKey,
        thumbnailKey: null,
        duration: 10,
        width: 1080,
        height: 1920,
        sizeBytes: 20,
        createdAt: new Date(),
      });
      return job.id;
    }

    it('returns job details with result when DONE', async () => {
      const jobId = await seedDoneJob('ses_owner');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${jobId}`,
        cookies: { sid: 'ses_owner' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('DONE');
      expect(body.result.revision).toBe(1);
    });

    it('hides jobs from other sessions', async () => {
      const jobId = await seedDoneJob('ses_owner');
      const otherSid = await newSessionCookie();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/jobs/${jobId}`,
        cookies: { sid: otherSid },
      });
      expect(res.statusCode).toBe(404);
    });

    it('issues a working download url with range support', async () => {
      const jobId = await seedDoneJob('ses_owner');
      const issued = await app.inject({
        method: 'POST',
        url: `/api/v1/jobs/${jobId}/download-url`,
        cookies: { sid: 'ses_owner' },
        payload: {},
      });
      expect(issued.statusCode).toBe(200);
      const { url } = issued.json();

      // 서명 URL은 세션 없이도 접근 가능
      const full = await app.inject({ method: 'GET', url });
      expect(full.statusCode).toBe(200);
      expect(full.headers['content-type']).toBe('video/mp4');
      expect(full.headers['content-disposition']).toContain('attachment');
      expect(full.body).toBe('rendered-video-bytes');

      const partial = await app.inject({
        method: 'GET',
        url,
        headers: { range: 'bytes=0-7' },
      });
      expect(partial.statusCode).toBe(206);
      expect(partial.headers['content-range']).toBe('bytes 0-7/20');
      expect(partial.body).toBe('rendered');
    });

    it('refuses a download url before the job is DONE', async () => {
      await deps.repos.sessions.create('ses_owner');
      await deps.repos.jobs.create({
        id: 'job_pending',
        sessionId: 'ses_owner',
        options: {
          targetDuration: 'auto',
          preset: 'clean',
          subtitle: 'on',
          bgm: 'auto',
          reframe: 'auto',
          language: 'auto',
        },
        sourceExt: 'mp4',
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/jobs/job_pending/download-url',
        cookies: { sid: 'ses_owner' },
        payload: {},
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('INVALID_STATE');
    });

    it('rejects files requests with a bad token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/files?token=garbage' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('job events (SSE)', () => {
    it('streams progress and completes on DONE', async () => {
      await deps.repos.sessions.create('ses_owner');
      await deps.repos.jobs.create({
        id: 'job_sse',
        sessionId: 'ses_owner',
        options: {
          targetDuration: 'auto',
          preset: 'clean',
          subtitle: 'on',
          bgm: 'auto',
          reframe: 'auto',
          language: 'auto',
        },
        sourceExt: 'mp4',
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await deps.repos.jobs.transition('job_sse', 'QUEUED', 'ANALYZING', {
        stage: 'ingest',
        progress: 5,
      });

      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      // 1.2초 후 DONE으로 전환 → 스트림이 done 이벤트와 함께 종료되어야 한다
      const finishJob = async () => {
        await new Promise((r) => setTimeout(r, 1200));
        await deps.repos.jobs.transition('job_sse', 'ANALYZING', 'COMPOSING');
        await deps.repos.jobs.transition('job_sse', 'COMPOSING', 'RENDERING');
        await deps.repos.jobs.transition('job_sse', 'RENDERING', 'DONE', { progress: 100 });
      };
      void finishJob();

      const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/job_sse/events`, {
        headers: { cookie: 'sid=ses_owner' },
        signal: AbortSignal.timeout(10_000),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      const body = await res.text();
      expect(body).toContain('event: progress');
      expect(body).toContain('"progress":5');
      expect(body).toContain('event: done');
    }, 15_000);
  });
});
