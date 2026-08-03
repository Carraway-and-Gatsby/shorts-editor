import { buildDefaultComposition, isAnalysisDoc, type AnalysisDoc } from '@shorts/shared';
import { storageKeys } from '@shorts/storage';
import { buildCompositionFromAnalysis } from '../compose/compose.js';
import type { PipelineDeps, StagePayload } from './deps.js';

/**
 * Compose 단계 (docs/04-pipeline-spec.md §4.3):
 * analysis.json + 옵션 → 컴포지션 산출 → Render enqueue.
 * 분석 결과가 없거나 손상된 경우 기본 컴포지션으로 폴백한다 (NFR-23).
 */
export async function processComposeJob(deps: PipelineDeps, payload: StagePayload): Promise<void> {
  const { jobId, revision } = payload;
  const { repos, storage } = deps;

  const job = await repos.jobs.find(jobId);
  if (!job) {
    console.error(`[compose] job not found: ${jobId}`);
    return;
  }

  const started = await repos.jobs.transition(jobId, 'ANALYZING', 'COMPOSING', {
    stage: 'compose',
    progress: 45,
  });
  if (!started && job.status !== 'COMPOSING') {
    console.warn(`[compose] skipping job ${jobId} in status ${job.status}`);
    return;
  }

  try {
    const existing = await repos.jobs.getComposition(jobId, revision);
    if (!existing) {
      let analysis: AnalysisDoc | null = null;
      try {
        const raw = await storage.get(storageKeys.analysis(jobId));
        const parsed: unknown = JSON.parse(raw.toString());
        if (isAnalysisDoc(parsed)) {
          analysis = parsed;
        }
      } catch {
        analysis = null;
      }

      const composition = analysis
        ? buildCompositionFromAnalysis({
            jobId,
            revision,
            analysis,
            options: job.options,
            scoring: deps.scoring,
            presets: deps.presets,
            bgmCatalog: deps.bgmCatalog,
            bannedWords: deps.bannedWords,
          })
        : buildDefaultComposition({
            jobId,
            revision,
            sourceDuration: job.sourceMeta?.duration ?? 60,
            sourceFps: job.sourceMeta?.fps,
            targetDuration: job.options.targetDuration,
            preset: job.options.preset,
          });
      if (!analysis) {
        console.warn(`[compose] analysis missing for ${jobId}, using default composition`);
      }
      await repos.jobs.insertComposition(jobId, revision, composition, 'auto');
    }

    await repos.jobs.transition(jobId, 'COMPOSING', 'RENDERING', { stage: 'render', progress: 50 });
    await deps.enqueueRender({ jobId, revision });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repos.jobs.fail(jobId, 'COMPOSE_FAILED', '편집 구성 중 오류가 발생했습니다.', {
      message,
    });
    throw err;
  }
}
