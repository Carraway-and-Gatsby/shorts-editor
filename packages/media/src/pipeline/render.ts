import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadToFile, storageKeys, uploadFromFile } from '@shorts/storage';
import { buildRenderArgs, buildThumbnailArgs } from '../commands.js';
import { FfmpegError, probeFile, runFfmpeg } from '../run.js';
import type { PipelineDeps, StagePayload } from './deps.js';

export interface RenderAttemptInfo {
  /** 이번 시도가 마지막(재시도 소진)인지 */
  isFinalAttempt: boolean;
}

/**
 * Render 단계 (docs/04-pipeline-spec.md §4.4):
 * 컴포지션의 컷을 원본에서 추출해 9:16 pad 변환 후 최종 MP4로 인코딩한다.
 * M1 제약: 단일 컷 컴포지션만 지원 (기본 컴포지션이 항상 단일 컷).
 */
export async function processRenderJob(
  deps: PipelineDeps,
  payload: StagePayload,
  attempt: RenderAttemptInfo = { isFinalAttempt: true },
): Promise<void> {
  const { jobId, revision } = payload;
  const { repos, storage } = deps;

  const job = await repos.jobs.find(jobId);
  if (!job) {
    console.error(`[render] job not found: ${jobId}`);
    return;
  }
  if (job.status !== 'RENDERING') {
    console.warn(`[render] skipping job ${jobId} in status ${job.status}`);
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(deps.tempRoot ?? os.tmpdir(), 'shorts-render-'));
  try {
    const composition = await repos.jobs.getComposition(jobId, revision);
    if (!composition) {
      throw new Error(`composition not found: ${jobId} r${revision}`);
    }
    if (composition.cuts.length !== 1) {
      throw new Error(`M1 renderer supports exactly one cut, got ${composition.cuts.length}`);
    }
    const cut = composition.cuts[0];

    const sourcePath = path.join(tempDir, `source.${job.sourceExt}`);
    await downloadToFile(storage, storageKeys.source(jobId, job.sourceExt), sourcePath);
    await repos.jobs.setProgress(jobId, 'render', 52);

    // 인코딩 (진행률 52% → 97%)
    const outputPath = path.join(tempDir, 'output.mp4');
    const cutDuration = cut.sourceEnd - cut.sourceStart;
    await runFfmpeg(
      buildRenderArgs({
        inputPath: sourcePath,
        outputPath,
        cut,
        fps: composition.output.fps,
        hasAudio: job.sourceMeta?.hasAudio ?? true,
        width: composition.output.width,
        height: composition.output.height,
      }),
      {
        totalDuration: cutDuration,
        onProgress: (ratio) => {
          void repos.jobs.setProgress(jobId, 'render', Math.round(52 + ratio * 45));
        },
      },
    );

    const outputProbe = await probeFile(outputPath);
    const outputStat = await fs.stat(outputPath);

    const thumbPath = path.join(tempDir, 'output_thumb.jpg');
    await runFfmpeg(
      buildThumbnailArgs(outputPath, thumbPath, (outputProbe?.duration ?? cutDuration) / 2),
    );

    const outputKey = storageKeys.output(jobId, revision);
    const thumbKey = storageKeys.outputThumbnail(jobId, revision);
    await uploadFromFile(storage, outputKey, outputPath);
    await uploadFromFile(storage, thumbKey, thumbPath);

    await repos.jobs.insertOutput({
      jobId,
      revision,
      storageKey: outputKey,
      thumbnailKey: thumbKey,
      duration: outputProbe?.duration ?? null,
      width: outputProbe?.width ?? null,
      height: outputProbe?.height ?? null,
      sizeBytes: outputStat.size,
      createdAt: new Date(),
    });

    await repos.jobs.transition(jobId, 'RENDERING', 'DONE', { progress: 100 });
  } catch (err) {
    if (attempt.isFinalAttempt) {
      const message = err instanceof Error ? err.message : String(err);
      const stderr = err instanceof FfmpegError ? err.stderrTail : undefined;
      await repos.jobs.fail(jobId, 'RENDER_FAILED', '렌더링에 실패했습니다.', {
        message,
        stderr,
      });
    }
    throw err;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
