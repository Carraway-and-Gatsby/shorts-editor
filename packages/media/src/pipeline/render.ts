import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadToFile, storageKeys, uploadFromFile } from '@shorts/storage';
import { buildAssDocument } from '../ass.js';
import { buildThumbnailArgs } from '../commands.js';
import {
  buildConcatArgs,
  buildConcatList,
  buildCutFilter,
  buildCutRenderArgs,
  buildFinalPassArgs,
} from '../render-plan.js';
import { FfmpegError, probeFile, runFfmpeg } from '../run.js';
import type { PipelineDeps, StagePayload } from './deps.js';

export interface RenderAttemptInfo {
  /** 이번 시도가 마지막(재시도 소진)인지 */
  isFinalAttempt: boolean;
}

/**
 * Render 단계 (docs/04-pipeline-spec.md §4.4):
 * 컷별 9:16 변환(중간 파일) → concat → 자막 번인 + 라우드니스 → 최종 MP4.
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
    const hasAudio = job.sourceMeta?.hasAudio ?? true;
    const source = {
      width: job.sourceMeta?.width ?? composition.output.width,
      height: job.sourceMeta?.height ?? composition.output.height,
    };

    const sourcePath = path.join(tempDir, `source.${job.sourceExt}`);
    await downloadToFile(storage, storageKeys.source(jobId, job.sourceExt), sourcePath);
    await repos.jobs.setProgress(jobId, 'render', 52);

    // 1. 컷별 중간 파일 (진행률 52% → 88%)
    const totalDuration = composition.cuts.reduce((s, c) => s + (c.sourceEnd - c.sourceStart), 0);
    const intermediates: string[] = [];
    let renderedSoFar = 0;
    let cutOutputStart = 0;
    for (const [i, cut] of composition.cuts.entries()) {
      const filter = buildCutFilter({ composition, cut, cutOutputStart, source });
      const filterScriptPath = path.join(tempDir, `filter_${i}.txt`);
      await fs.writeFile(filterScriptPath, filter);
      const outputPath = path.join(tempDir, `cut_${i}.mp4`);
      const cutDuration = cut.sourceEnd - cut.sourceStart;
      const baseProgress = renderedSoFar;
      await runFfmpeg(
        buildCutRenderArgs({
          composition,
          cut,
          cutOutputStart,
          source,
          inputPath: sourcePath,
          filterScriptPath,
          outputPath,
          hasAudio,
        }),
        {
          totalDuration: cutDuration,
          onProgress: (ratio) => {
            const overall = (baseProgress + ratio * cutDuration) / totalDuration;
            void repos.jobs.setProgress(jobId, 'render', Math.round(52 + overall * 36));
          },
        },
      );
      intermediates.push(outputPath);
      renderedSoFar += cutDuration;
      cutOutputStart += cutDuration;
    }

    // 2. concat (스트림 복사)
    let combinedPath: string;
    if (intermediates.length === 1) {
      combinedPath = intermediates[0];
    } else {
      const listPath = path.join(tempDir, 'concat.txt');
      await fs.writeFile(listPath, buildConcatList(intermediates));
      combinedPath = path.join(tempDir, 'combined.mp4');
      await runFfmpeg(buildConcatArgs(listPath, combinedPath));
    }
    await repos.jobs.setProgress(jobId, 'render', 90);

    // 3. 최종 패스: 자막 번인(F-14) + 라우드니스(-14 LUFS)
    let assPath: string | null = null;
    if (composition.subtitles.blocks.length > 0) {
      assPath = path.join(tempDir, 'subtitles.ass');
      await fs.writeFile(assPath, buildAssDocument(composition.subtitles.blocks, composition.style));
    }
    const outputPath = path.join(tempDir, 'output.mp4');
    await runFfmpeg(
      buildFinalPassArgs({
        inputPath: combinedPath,
        outputPath,
        assPath,
        hasAudio,
        loudnessTarget: composition.audio.loudnessTarget,
      }),
    );
    await repos.jobs.setProgress(jobId, 'render', 96);

    const outputProbe = await probeFile(outputPath);
    const outputStat = await fs.stat(outputPath);

    const thumbPath = path.join(tempDir, 'output_thumb.jpg');
    await runFfmpeg(
      buildThumbnailArgs(outputPath, thumbPath, (outputProbe?.duration ?? totalDuration) / 2),
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
