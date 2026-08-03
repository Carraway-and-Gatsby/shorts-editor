import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDefaultComposition } from '@shorts/shared';
import type { SourceMeta } from '@shorts/db';
import { downloadToFile, storageKeys, uploadFromFile } from '@shorts/storage';
import { buildProxyArgs, buildThumbnailArgs } from '../commands.js';
import { probeFile, runFfmpeg } from '../run.js';
import { validateSource } from '../validate-source.js';
import type { PipelineDeps, StagePayload } from './deps.js';

/**
 * Ingest 단계 (docs/04-pipeline-spec.md §4.1):
 * 검증 → 메타데이터 기록 → 프록시 → 썸네일 → 기본 컴포지션 생성 → Render enqueue.
 * M1에서는 Analyze가 없으므로 Ingest 완료 후 곧바로 COMPOSING → RENDERING으로 넘어간다.
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
    await repos.jobs.setProgress(jobId, 'ingest', 8);

    // 3. 대표 썸네일 (중간 지점)
    const thumbPath = path.join(tempDir, 'thumbnail.jpg');
    await runFfmpeg(buildThumbnailArgs(sourcePath, thumbPath, meta.duration / 2));
    await uploadFromFile(storage, storageKeys.thumbnail(jobId), thumbPath);
    await repos.jobs.setProgress(jobId, 'ingest', 10);

    // 4. 기본 컴포지션 (M1: 분석 없이 시작부터 목표 길이. M2에서 하이라이트 기반으로 대체)
    const revision = 1;
    const existing = await repos.jobs.getComposition(jobId, revision);
    if (!existing) {
      const composition = buildDefaultComposition({
        jobId,
        revision,
        sourceDuration: meta.duration,
        sourceFps: meta.fps,
        targetDuration: job.options.targetDuration,
        preset: job.options.preset,
      });
      await repos.jobs.insertComposition(jobId, revision, composition, 'auto');
    }

    // 5. 상태 전이 후 렌더링 enqueue (M1: Analyze 단계는 통과 처리)
    await repos.jobs.transition(jobId, 'ANALYZING', 'COMPOSING', { stage: 'compose', progress: 45 });
    await repos.jobs.transition(jobId, 'COMPOSING', 'RENDERING', { stage: 'render', progress: 50 });
    await deps.enqueueRender({ jobId, revision });
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
