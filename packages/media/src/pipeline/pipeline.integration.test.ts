/**
 * 실제 ffmpeg로 Ingest → (분석 결과 주입) → Compose → Render 파이프라인을 검증하는 통합 테스트.
 * Analyze 워커(Python)의 산출물은 동일 스키마의 AnalysisDoc으로 재현한다.
 * ffmpeg가 없는 환경에서는 자동 스킵된다.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createMemoryRepos, type JobOptions } from '@shorts/db';
import type { AnalysisDoc } from '@shorts/shared';
import { LocalFsStorage, storageKeys, uploadFromFile } from '@shorts/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpegAvailable, probeFile } from '../run.js';
import type { PipelineDeps, StagePayload } from './deps.js';
import { processComposeJob } from './compose.js';
import { processIngestJob } from './ingest.js';
import { processRenderJob } from './render.js';

const execFileAsync = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';

const OPTIONS: JobOptions = {
  targetDuration: 'auto',
  preset: 'clean',
  subtitle: 'on',
  bgm: 'auto',
  reframe: 'auto',
  language: 'auto',
};

const hasFfmpeg = await ffmpegAvailable();

interface TestHarness {
  repos: ReturnType<typeof createMemoryRepos>;
  storage: LocalFsStorage;
  deps: PipelineDeps;
  analyzeQueue: StagePayload[];
  renderQueue: StagePayload[];
}

function makeHarness(storageDir: string): TestHarness {
  const repos = createMemoryRepos();
  const storage = new LocalFsStorage(storageDir);
  const analyzeQueue: StagePayload[] = [];
  const renderQueue: StagePayload[] = [];
  return {
    repos,
    storage,
    analyzeQueue,
    renderQueue,
    deps: {
      repos,
      storage,
      enqueueAnalyze: async (p) => {
        analyzeQueue.push(p);
      },
      enqueueRender: async (p) => {
        renderQueue.push(p);
      },
    },
  };
}

async function createJob(harness: TestHarness, jobId: string, sourceFile: string): Promise<void> {
  await harness.repos.sessions.create('ses_1');
  await harness.repos.jobs.create({
    id: jobId,
    sessionId: 'ses_1',
    options: OPTIONS,
    sourceExt: 'mp4',
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await uploadFromFile(harness.storage, storageKeys.source(jobId, 'mp4'), sourceFile);
}

describe.skipIf(!hasFfmpeg)('pipeline integration (ffmpeg)', () => {
  let workDir: string;
  let speechSource: string;
  let silentSource: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shorts-pipeline-'));
    // 25초 1280x720 테스트 영상 (사인파 오디오 포함) — auto 목표에서 컷 편집 대상
    speechSource = path.join(workDir, 'speech.mp4');
    await execFileAsync(FFMPEG, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=25:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=25',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest',
      speechSource,
    ]);
    // 8초 무음 영상 (UC-3)
    silentSource = path.join(workDir, 'silent.mp4');
    await execFileAsync(FFMPEG, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=8:size=1280x720:rate=30',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-an',
      silentSource,
    ]);
  }, 120_000);

  afterAll(async () => {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  });

  it('UC-1: full auto generation with subtitles and highlight cuts', async () => {
    const harness = makeHarness(path.join(workDir, 'storage-uc1'));
    const jobId = 'job_uc1';
    await createJob(harness, jobId, speechSource);

    // Ingest: 프록시/오디오/썸네일 생성 후 analyze enqueue
    await processIngestJob(harness.deps, { jobId, revision: 1 });
    let job = await harness.repos.jobs.find(jobId);
    expect(job?.status).toBe('ANALYZING');
    expect(job?.stage).toBe('analyze');
    expect(await harness.storage.exists(storageKeys.proxy(jobId))).toBe(true);
    expect(await harness.storage.exists(storageKeys.audio(jobId))).toBe(true);
    expect(harness.analyzeQueue).toEqual([{ jobId, revision: 1 }]);

    // Analyze 산출물 주입 (Python 워커가 생성하는 것과 동일한 스키마):
    // 5~13초, 17~24초에 발화가 있고 얼굴이 자주 등장하는 시나리오
    const analysis: AnalysisDoc = {
      version: 1,
      jobId,
      source: { duration: 25, fps: 30, width: 1280, height: 720, hasAudio: true },
      shots: [
        {
          start: 0,
          end: 25,
          signals: { motion: 0.5, shake: 0.1, quality: 0.85, facePresence: 0.9, darkness: 0.05 },
          subjectTrack: Array.from({ length: 50 }, (_, i) => ({
            t: i * 0.5,
            cx: 0.35 + 0.1 * Math.sin(i / 8),
            cy: 0.4,
            w: 0.2,
            h: 0.35,
          })),
        },
      ],
      transcript: {
        language: 'ko',
        segments: [
          {
            start: 5,
            end: 13,
            text: '첫 번째 하이라이트 발화입니다',
            words: [
              { start: 5.0, end: 6.2, text: '첫' },
              { start: 6.2, end: 7.4, text: '번째' },
              { start: 7.4, end: 9.6, text: '하이라이트' },
              { start: 9.6, end: 13.0, text: '발화입니다' },
            ],
          },
          {
            start: 17,
            end: 24,
            text: '두 번째 구간의 발화입니다',
            words: [
              { start: 17.0, end: 18.5, text: '두' },
              { start: 18.5, end: 20.0, text: '번째' },
              { start: 20.0, end: 22.0, text: '구간의' },
              { start: 22.0, end: 24.0, text: '발화입니다' },
            ],
          },
        ],
      },
      silences: [{ start: 13, end: 17 }],
      energy: Array.from({ length: 50 }, (_, i) => {
        const t = i * 0.5;
        const speaking = (t >= 5 && t < 13) || (t >= 17 && t < 24);
        return { t, rms: speaking ? 0.4 : 0.03 };
      }),
      warnings: [],
    };
    await harness.storage.put(storageKeys.analysis(jobId), JSON.stringify(analysis));

    // Compose: 분석 기반 컴포지션 산출
    await processComposeJob(harness.deps, { jobId, revision: 1 });
    job = await harness.repos.jobs.find(jobId);
    expect(job?.status).toBe('RENDERING');
    expect(harness.renderQueue).toEqual([{ jobId, revision: 1 }]);

    const composition = await harness.repos.jobs.getComposition(jobId, 1);
    expect(composition).not.toBeNull();
    // 25초 원본 auto → 전체 아님: 발화 두 구간이 선택되고 무음 구간(13~17)은 제외
    expect(composition!.cuts.length).toBeGreaterThanOrEqual(1);
    expect(composition!.output.duration).toBeLessThan(25);
    // 얼굴 90% → track 모드 + 키프레임 존재
    expect(composition!.reframe.mode).toBe('track');
    expect(composition!.reframe.keyframes.length).toBeGreaterThan(0);
    // 자막 블록 생성됨
    expect(composition!.subtitles.blocks.length).toBeGreaterThan(0);

    // Render: 최종 출력
    await processRenderJob(harness.deps, { jobId, revision: 1 });
    job = await harness.repos.jobs.find(jobId);
    expect(job?.status).toBe('DONE');

    const output = await harness.repos.jobs.getOutput(jobId, 1);
    const outPath = path.join(workDir, 'uc1-out.mp4');
    const stream = await harness.storage.getStream(output!.storageKey);
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(stream, createWriteStream(outPath));
    const outProbe = await probeFile(outPath);
    expect(outProbe?.width).toBe(1080);
    expect(outProbe?.height).toBe(1920);
    expect(outProbe?.hasAudio).toBe(true);
    // 출력 길이 = 선택된 컷 합 (±1초 컨테이너 오차)
    expect(Math.abs((outProbe?.duration ?? 0) - composition!.output.duration)).toBeLessThan(1);
  }, 300_000);

  it('UC-3: silent video gets shot-based cuts, no subtitles, pad mode', async () => {
    const harness = makeHarness(path.join(workDir, 'storage-uc3'));
    const jobId = 'job_uc3';
    await createJob(harness, jobId, silentSource);

    await processIngestJob(harness.deps, { jobId, revision: 1 });
    expect(await harness.storage.exists(storageKeys.audio(jobId))).toBe(false);

    // 무음 분석 결과: transcript 없음, 얼굴 없음
    const analysis: AnalysisDoc = {
      version: 1,
      jobId,
      source: { duration: 8, fps: 30, width: 1280, height: 720, hasAudio: false },
      shots: [
        {
          start: 0,
          end: 8,
          signals: { motion: 0.6, shake: 0.1, quality: 0.8, facePresence: 0, darkness: 0.1 },
          subjectTrack: [],
        },
      ],
      transcript: null,
      silences: [],
      energy: [],
      warnings: ['stt_skipped_no_audio'],
    };
    await harness.storage.put(storageKeys.analysis(jobId), JSON.stringify(analysis));

    await processComposeJob(harness.deps, { jobId, revision: 1 });
    const composition = await harness.repos.jobs.getComposition(jobId, 1);
    // 8초 ≤ 20초 → 전체 사용, 자막 없음, 얼굴 없음 → pad
    expect(composition!.cuts).toHaveLength(1);
    expect(composition!.subtitles.blocks).toEqual([]);
    expect(composition!.reframe.mode).toBe('pad');

    await processRenderJob(harness.deps, { jobId, revision: 1 });
    const job = await harness.repos.jobs.find(jobId);
    expect(job?.status).toBe('DONE');

    const output = await harness.repos.jobs.getOutput(jobId, 1);
    const outPath = path.join(workDir, 'uc3-out.mp4');
    const stream = await harness.storage.getStream(output!.storageKey);
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(stream, createWriteStream(outPath));
    const outProbe = await probeFile(outPath);
    expect(outProbe?.width).toBe(1080);
    expect(outProbe?.height).toBe(1920);
    expect(outProbe?.hasAudio).toBe(false);
  }, 300_000);

  it('falls back to a default composition when analysis is missing', async () => {
    const harness = makeHarness(path.join(workDir, 'storage-fallback'));
    const jobId = 'job_fb';
    await createJob(harness, jobId, silentSource);
    await processIngestJob(harness.deps, { jobId, revision: 1 });

    // analysis.json 없이 compose 실행 → 기본 컴포지션 폴백 (NFR-23)
    await processComposeJob(harness.deps, { jobId, revision: 1 });
    const composition = await harness.repos.jobs.getComposition(jobId, 1);
    expect(composition).not.toBeNull();
    expect(composition!.cuts).toHaveLength(1);
    const job = await harness.repos.jobs.find(jobId);
    expect(job?.status).toBe('RENDERING');
  }, 120_000);

  it('fails a job with a non-video source without throwing', async () => {
    const harness = makeHarness(path.join(workDir, 'storage-bad'));
    const jobId = 'job_bad';
    await harness.repos.sessions.create('ses_1');
    await harness.repos.jobs.create({
      id: jobId,
      sessionId: 'ses_1',
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await harness.storage.put(storageKeys.source(jobId, 'mp4'), 'this is not a video file');

    await processIngestJob(harness.deps, { jobId, revision: 1 });
    const job = await harness.repos.jobs.find(jobId);
    expect(job?.status).toBe('FAILED');
    expect(job?.errorCode).toBe('INVALID_MEDIA');
  }, 60_000);
});
