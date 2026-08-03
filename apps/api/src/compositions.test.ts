import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMemoryRepos, type JobOptions } from '@shorts/db';
import type { EnqueueOptions, StageJobPayload } from '@shorts/queue';
import type { AnalysisDoc, Composition, JobStage } from '@shorts/shared';
import { LocalFsStorage, storageKeys } from '@shorts/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { runCleanup } from './cleanup.js';
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

interface EnqueuedJob {
  stage: JobStage;
  payload: StageJobPayload;
  options?: EnqueueOptions;
}

function sampleComposition(jobId: string, revision: number): Composition {
  return {
    version: 1,
    jobId,
    revision,
    output: { width: 1080, height: 1920, fps: 30, duration: 20 },
    cuts: [{ id: 'c1', sourceStart: 5, sourceEnd: 25, transition: 'cut' }],
    reframe: { mode: 'pad', keyframes: [] },
    subtitles: {
      style: 'clean',
      blocks: [{ id: 's1', start: 1, end: 2.5, text: '원본 자막', words: [] }],
    },
    audio: { bgm: null, loudnessTarget: -14 },
    style: { preset: 'clean', titleCard: null, lut: null },
  };
}

function sampleAnalysis(jobId: string): AnalysisDoc {
  return {
    version: 1,
    jobId,
    source: { duration: 60, fps: 30, width: 1920, height: 1080, hasAudio: true },
    shots: [
      {
        start: 0,
        end: 60,
        signals: { motion: 0.5, shake: 0.1, quality: 0.8, facePresence: 0.5, darkness: 0.1 },
        subjectTrack: [],
      },
    ],
    transcript: {
      language: 'ko',
      segments: [
        {
          start: 6,
          end: 8,
          text: '원본 자막',
          words: [
            { start: 6, end: 7, text: '원본' },
            { start: 7, end: 8, text: '자막' },
          ],
        },
        {
          start: 31,
          end: 33,
          text: '뒷부분 자막',
          words: [
            { start: 31, end: 32, text: '뒷부분' },
            { start: 32, end: 33, text: '자막' },
          ],
        },
      ],
    },
    silences: [],
    energy: [],
    warnings: [],
  };
}

describe('composition editing api', () => {
  let root: string;
  let deps: AppDeps & { enqueued: EnqueuedJob[] };
  let app: FastifyInstance;
  const sid = 'ses_owner';
  const jobId = 'job_edit';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shorts-comp-'));
    const enqueued: EnqueuedJob[] = [];
    deps = {
      repos: createMemoryRepos(),
      storage: new LocalFsStorage(root),
      queue: {
        async enqueue(stage, payload, options) {
          enqueued.push({ stage, payload, options });
        },
        async close() {},
      },
      signer: new FileTokenSigner('test-secret'),
      presetCatalog: [],
      bgmCatalog: [],
      checkRedis: async () => true,
      checkPostgres: async () => true,
      enqueued,
    };
    app = await buildServer(deps);

    await deps.repos.sessions.create(sid);
    await deps.repos.jobs.create({
      id: jobId,
      sessionId: sid,
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await deps.repos.jobs.transition(jobId, 'QUEUED', 'ANALYZING');
    await deps.repos.jobs.transition(jobId, 'ANALYZING', 'COMPOSING');
    await deps.repos.jobs.transition(jobId, 'COMPOSING', 'RENDERING');
    await deps.repos.jobs.insertComposition(jobId, 1, sampleComposition(jobId, 1), 'auto');
    await deps.repos.jobs.transition(jobId, 'RENDERING', 'DONE', { progress: 100 });
    await deps.storage.put(
      storageKeys.analysis(jobId),
      JSON.stringify(sampleAnalysis(jobId)),
    );
  });

  afterEach(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns the current composition with analysis summary', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}/composition`,
      cookies: { sid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.composition.cuts).toHaveLength(1);
    expect(body.hasDraft).toBe(false);
    expect(body.analysisSummary.sourceDuration).toBe(60);
    expect(body.analysisSummary.speech).toHaveLength(2);
  });

  it('PATCH saves a draft, records corrections, and remaps subtitles on cut change', async () => {
    // 자막 텍스트 수정 (F-22)
    const textEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${jobId}/composition`,
      cookies: { sid },
      payload: {
        subtitles: {
          blocks: [{ id: 's1', start: 1, end: 2.5, text: '교정된 자막', words: [] }],
        },
      },
    });
    expect(textEdit.statusCode).toBe(200);
    expect(textEdit.json().composition.subtitles.blocks[0].text).toBe('교정된 자막');
    expect(deps.repos.dump().corrections).toEqual([
      { jobId, blockId: 's1', originalText: '원본 자막', correctedText: '교정된 자막' },
    ]);

    // 컷 범위 보정 (F-21) → 새 컷에 맞춰 자막 리매핑
    const cutEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${jobId}/composition`,
      cookies: { sid },
      payload: { cuts: [{ id: 'c1', sourceStart: 30, sourceEnd: 40 }] },
    });
    expect(cutEdit.statusCode).toBe(200);
    const composition = cutEdit.json().composition;
    expect(composition.output.duration).toBe(10);
    // 31~33초 발화 → 출력 1~3초
    expect(composition.subtitles.blocks[0].text).toContain('뒷부분');

    // 드래프트가 GET에 반영됨
    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}/composition`,
      cookies: { sid },
    });
    expect(got.json().hasDraft).toBe(true);
    expect(got.json().composition.output.duration).toBe(10);
  });

  it('rejects invalid patches and wrong-state jobs', async () => {
    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${jobId}/composition`,
      cookies: { sid },
      payload: { cuts: [{ id: 'c1', sourceStart: 0, sourceEnd: 120 }] },
    });
    expect(invalid.statusCode).toBe(400);

    await deps.repos.jobs.transition(jobId, 'DONE', 'RENDERING');
    const wrongState = await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${jobId}/composition`,
      cookies: { sid },
      payload: {},
    });
    expect(wrongState.statusCode).toBe(409);
  });

  it('re-render promotes the draft to a new revision (UC-2 flow)', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/jobs/${jobId}/composition`,
      cookies: { sid },
      payload: {
        subtitles: { blocks: [{ id: 's1', start: 1, end: 2.5, text: '교정', words: [] }] },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/render`,
      cookies: { sid },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ jobId, status: 'RENDERING', revision: 2 });

    const job = await deps.repos.jobs.find(jobId);
    expect(job?.status).toBe('RENDERING');
    expect(job?.currentRevision).toBe(2);
    expect(await deps.repos.jobs.getDraft(jobId)).toBeNull();
    const revision2 = await deps.repos.jobs.getComposition(jobId, 2);
    expect(revision2?.subtitles.blocks[0].text).toBe('교정');
    expect(deps.enqueued).toEqual([
      { stage: 'render', payload: { jobId, revision: 2 }, options: { attempts: 2 } },
    ]);

    // 렌더 중에는 재렌더 요청 거부
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/render`,
      cookies: { sid },
    });
    expect(again.statusCode).toBe(409);
  });

  it('lists revisions with outputs', async () => {
    await deps.repos.jobs.insertOutput({
      jobId,
      revision: 1,
      storageKey: storageKeys.output(jobId, 1),
      thumbnailKey: storageKeys.outputThumbnail(jobId, 1),
      duration: 20,
      width: 1080,
      height: 1920,
      sizeBytes: 100,
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}/revisions`,
      cookies: { sid },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].revision).toBe(1);
    expect(res.json()[0].thumbnailUrl).toContain('/api/v1/files?token=');
  });

  it('serves catalogs', async () => {
    deps.presetCatalog.push({ id: 'clean', name: '클린', bgmMood: 'calm', titleCard: false });
    deps.bgmCatalog.push({
      id: 'bgm_calm_01',
      name: 'Calm',
      moods: ['calm'],
      durationSeconds: 24,
      file: 'x.m4a',
      licenseNote: 'CC0',
    });
    const presets = await app.inject({ method: 'GET', url: '/api/v1/presets', cookies: { sid } });
    expect(presets.json()).toEqual([
      { id: 'clean', name: '클린', description: '', titleCard: false },
    ]);
    const tracks = await app.inject({
      method: 'GET',
      url: '/api/v1/bgm-tracks?mood=calm',
      cookies: { sid },
    });
    expect(tracks.json()).toHaveLength(1);
  });

  it('lists session jobs with pagination', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/jobs?limit=10', cookies: { sid } });
    expect(res.statusCode).toBe(200);
    expect(res.json().jobs).toHaveLength(1);
    expect(res.json().jobs[0].jobId).toBe(jobId);
    expect(res.json().nextCursor).toBeNull();
  });
});

describe('cleanup batch', () => {
  it('deletes expired job files but keeps thumbnails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shorts-cleanup-'));
    const repos = createMemoryRepos();
    const storage = new LocalFsStorage(root);
    await repos.sessions.create('ses_1');
    await repos.jobs.create({
      id: 'job_old',
      sessionId: 'ses_1',
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: new Date(Date.now() - 1000),
    });
    await repos.jobs.insertOutput({
      jobId: 'job_old',
      revision: 1,
      storageKey: storageKeys.output('job_old', 1),
      thumbnailKey: storageKeys.outputThumbnail('job_old', 1),
      duration: 10,
      width: 1080,
      height: 1920,
      sizeBytes: 10,
      createdAt: new Date(),
    });
    for (const key of [
      storageKeys.source('job_old', 'mp4'),
      storageKeys.proxy('job_old'),
      storageKeys.analysis('job_old'),
      storageKeys.thumbnail('job_old'),
      storageKeys.output('job_old', 1),
      storageKeys.outputThumbnail('job_old', 1),
    ]) {
      await storage.put(key, 'x');
    }

    const result = await runCleanup({ repos, storage });
    expect(result.cleanedJobs).toBe(1);

    expect(await storage.exists(storageKeys.source('job_old', 'mp4'))).toBe(false);
    expect(await storage.exists(storageKeys.output('job_old', 1))).toBe(false);
    expect(await storage.exists(storageKeys.analysis('job_old'))).toBe(false);
    // 썸네일은 이력 표시용으로 보존
    expect(await storage.exists(storageKeys.thumbnail('job_old'))).toBe(true);
    expect(await storage.exists(storageKeys.outputThumbnail('job_old', 1))).toBe(true);
    expect(await repos.jobs.getOutput('job_old', 1)).toBeNull();

    // 두 번째 실행은 대상 없음 (멱등)
    expect((await runCleanup({ repos, storage })).cleanedJobs).toBe(0);
    await fs.rm(root, { recursive: true, force: true });
  });
});
