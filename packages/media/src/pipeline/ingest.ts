import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SourceMeta } from '@shorts/db';
import { downloadToFile, storageKeys, uploadFromFile } from '@shorts/storage';
import { buildAudioExtractArgs, buildProxyArgs, buildThumbnailArgs } from '../commands.js';
import { probeFile, runFfmpeg } from '../run.js';
import { validateSource } from '../validate-source.js';
import type { PipelineDeps, StagePayload } from './deps.js';

/**
 * Ingest 단계 (docs/04-pipeline-spec.md §4.1):
 * 검증 → 메타데이터 기록 → 프록시 → STT용 오디오 → 썸네일 → Analyze enqueue.
 */
export async function processIngestJob(deps: PipelineDeps, payload: StagePayload): Promise<void> {
  const { jobId } = payload;
  const { repos, storage } = deps;

  const job = await repos.jobs.find(jobId);
  if (!job) {
    console.error(`[ingest] job not found: ${jobId}`);
    return;
  }

  const started = await repos.jobs.transition(jobId, 'QUEUED', 'ANALYZING', {
    stage: 'ingest',
    progress: 1,
  });
  if (!started && job.status !== 'ANALYZING') {
    console.warn(`[ingest] skipping job ${jobId} in status ${job.status}`);
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(deps.tempRoot ?? os.tmpdir(), 'shorts-ingest-'));
  try {
    const sourcePath = path.join(tempDir, `source.${job.sourceExt}`);
    await downloadToFile(storage, storageKeys.source(jobId, job.sourceExt), sourcePath);

    // 1. 검증 (실패는 재시도 없는 최종 실패 — throw하지 않는다)
    const probe = await probeFile(sourcePath);
    const validation = validateSource(probe);
    if (!validation.ok) {
      await repos.jobs.fail(jobId, validation.code, validation.message);
      return;
    }

    const meta: SourceMeta = {
      duration: probe!.duration,
      width: probe!.width,
      height: probe!.height,
      fps: probe!.fps,
      hasAudio: probe!.hasAudio,
      rotation: probe!.rotation,
    };
    await repos.jobs.setSourceMeta(jobId, meta);
    await repos.jobs.setProgress(jobId, 'ingest', 4);

    // 2. 분석용 프록시
    const proxyPath = path.join(tempDir, 'proxy.mp4');
    await runFfmpeg(buildProxyArgs(sourcePath, proxyPath));
    await uploadFromFile(storage, storageKeys.proxy(jobId), proxyPath);
    await repos.jobs.setProgress(jobId, 'ingest', 7);

    // 3. STT/에너지 분석용 오디오 (16kHz mono WAV)
    if (meta.hasAudio) {
      const audioPath = path.join(tempDir, 'audio.wav');
      await runFfmpeg(buildAudioExtractArgs(sourcePath, audioPath));
      await uploadFromFile(storage, storageKeys.audio(jobId), audioPath);
    }
    await repos.jobs.setProgress(jobId, 'ingest', 9);

    // 4. 대표 썸네일 (중간 지점)
    const thumbPath = path.join(tempDir, 'thumbnail.jpg');
    await runFfmpeg(buildThumbnailArgs(sourcePath, thumbPath, meta.duration / 2));
    await uploadFromFile(storage, storageKeys.thumbnail(jobId), thumbPath);
    await repos.jobs.setProgress(jobId, 'ingest', 10);

    // 5. 분석 단계로 (상태는 ANALYZING 유지, stage만 갱신)
    await repos.jobs.setProgress(jobId, 'analyze', 12);
    await deps.enqueueAnalyze({ jobId, revision: payload.revision });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repos.jobs.fail(jobId, 'INGEST_FAILED', '영상 준비 중 오류가 발생했습니다.', {
      message,
    });
    throw err;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
