/**
 * 실제 ffmpeg로 Ingest → Render 전체 파이프라인을 검증하는 통합 테스트.
 * ffmpeg가 없는 환경에서는 자동 스킵된다 (CI에서는 ffmpeg 설치 후 실행).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createMemoryRepos, type JobOptions } from '@shorts/db';
import { LocalFsStorage, storageKeys, uploadFromFile } from '@shorts/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpegAvailable, probeFile } from '../run.js';
import type { StagePayload } from './deps.js';
import { processIngestJob } from './ingest.js';
import { processRenderJob } from './render.js';

const execFileAsync = promisify(execFile);

const OPTIONS: JobOptions = {
  targetDuration: 'auto',
  preset: 'clean',
  subtitle: 'on',
  bgm: 'auto',
  reframe: 'auto',
  language: 'auto',
};

const hasFfmpeg = await ffmpegAvailable();

describe.skipIf(!hasFfmpeg)('pipeline integration (ffmpeg)', () => {
  let workDir: string;
  let sourceFile: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shorts-pipeline-'));
    // 5초짜리 1280x720 테스트 영상 생성 (컬러 패턴 + 사인파 오디오)
    sourceFile = path.join(workDir, 'test-source.mp4');
    await execFileAsync(process.env.FFMPEG_PATH ?? 'ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=5:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest',
      sourceFile,
    ]);
  }, 60_000);

  afterAll(async () => {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  it('turns an uploaded source into a 1080x1920 mp4', async () => {
    const repos = createMemoryRepos();
    const storage = new LocalFsStorage(path.join(workDir, 'storage'));
    const renderQueue: StagePayload[] = [];
    const deps = {
      repos,
      storage,
      enqueueRender: async (payload: StagePayload) => {
        renderQueue.push(payload);
      },
    };

    // 업로드 완료 상태 재현: 원본이 스토리지에 있고 잡은 QUEUED
    const jobId = 'job_e2e';
    await repos.sessions.create('ses_1');
    await repos.jobs.create({
      id: jobId,
      sessionId: 'ses_1',
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await uploadFromFile(storage, storageKeys.source(jobId, 'mp4'), sourceFile);

    // Ingest
    await processIngestJob(deps, { jobId, revision: 1 });
    let job = await repos.jobs.find(jobId);
    expect(job?.status).toBe('RENDERING');
    expect(job?.sourceMeta).toMatchObject({ width: 1280, height: 720, hasAudio: true });
    expect(job?.sourceMeta?.duration).toBeGreaterThan(4.5);
    expect(await storage.exists(storageKeys.proxy(jobId))).toBe(true);
    expect(await storage.exists(storageKeys.thumbnail(jobId))).toBe(true);
    expect(renderQueue).toEqual([{ jobId, revision: 1 }]);

    // 컴포지션: 5초 원본 → 전체 사용 단일 컷
    const composition = await repos.jobs.getComposition(jobId, 1);
    expect(composition?.cuts).toHaveLength(1);
    expect(composition?.cuts[0].sourceStart).toBe(0);
    expect(composition?.output.duration).toBeCloseTo(5, 0);

    // Render
    await processRenderJob(deps, { jobId, revision: 1 });
    job = await repos.jobs.find(jobId);
    expect(job?.status).toBe('DONE');
    expect(job?.progress).toBe(100);

    const output = await repos.jobs.getOutput(jobId, 1);
    expect(output).not.toBeNull();
    expect(await storage.exists(output!.storageKey)).toBe(true);
    expect(await storage.exists(output!.thumbnailKey!)).toBe(true);

    // 출력 파일이 실제로 1080x1920 규격인지 ffprobe로 확인 (M1 완료 기준)
    const outPath = path.join(workDir, 'final-check.mp4');
    const stream = await storage.getStream(output!.storageKey);
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(stream, createWriteStream(outPath));
    const outProbe = await probeFile(outPath);
    expect(outProbe?.width).toBe(1080);
    expect(outProbe?.height).toBe(1920);
    expect(outProbe?.hasAudio).toBe(true);
    expect(outProbe?.duration).toBeGreaterThan(4);
  }, 120_000);

  it('fails a job with a non-video source without throwing', async () => {
    const repos = createMemoryRepos();
    const storage = new LocalFsStorage(path.join(workDir, 'storage-bad'));
    const deps = {
      repos,
      storage,
      enqueueRender: async () => {},
    };

    const jobId = 'job_bad';
    await repos.sessions.create('ses_1');
    await repos.jobs.create({
      id: jobId,
      sessionId: 'ses_1',
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await storage.put(storageKeys.source(jobId, 'mp4'), 'this is not a video file');

    await processIngestJob(deps, { jobId, revision: 1 });
    const job = await repos.jobs.find(jobId);
    expect(job?.status).toBe('FAILED');
    expect(job?.errorCode).toBe('INVALID_MEDIA');
  }, 60_000);
});
