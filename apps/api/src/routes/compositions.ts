import { applyCompositionPatch, type CompositionPatchInput } from '@shorts/media';
import { isAnalysisDoc, type AnalysisDoc, type Composition } from '@shorts/shared';
import { storageKeys } from '@shorts/storage';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { canAccessJob } from '../lib/access.js';
import { apiError } from '../lib/errors.js';

async function loadAnalysis(deps: AppDeps, jobId: string): Promise<AnalysisDoc | null> {
  try {
    const raw = await deps.storage.get(storageKeys.analysis(jobId));
    const parsed: unknown = JSON.parse(raw.toString());
    return isAnalysisDoc(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function currentComposition(deps: AppDeps, jobId: string): Promise<Composition | null> {
  const draft = await deps.repos.jobs.getDraft(jobId);
  if (draft) {
    return draft;
  }
  const job = await deps.repos.jobs.find(jobId);
  if (!job || job.currentRevision === 0) {
    return null;
  }
  return deps.repos.jobs.getComposition(jobId, job.currentRevision);
}

/** 보정(F-21/F-22)과 재렌더링(F-24) 라우트. docs/06-api-spec.md §6.4 참조. */
export function registerCompositionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { repos } = deps;

  // 현재 컴포지션 조회 (드래프트 우선) + 타임라인 UI용 분석 요약
  app.get<{ Params: { id: string } }>('/api/v1/jobs/:id/composition', async (req, reply) => {
    const job = await repos.jobs.find(req.params.id);
    if (!job || !canAccessJob(job, req)) {
      return apiError(reply, 404, 'NOT_FOUND', '잡을 찾을 수 없습니다.');
    }
    const composition = await currentComposition(deps, job.id);
    if (!composition) {
      return apiError(reply, 409, 'INVALID_STATE', '아직 컴포지션이 생성되지 않았습니다.');
    }
    const analysis = await loadAnalysis(deps, job.id);
    return reply.send({
      composition,
      hasDraft: (await repos.jobs.getDraft(job.id)) !== null,
      analysisSummary: analysis
        ? {
            sourceDuration: analysis.source.duration,
            speech: (analysis.transcript?.segments ?? []).map((s) => ({
              start: s.start,
              end: s.end,
            })),
            silences: analysis.silences,
          }
        : null,
    });
  });

  // 컴포지션 보정 → 드래프트 저장 (리비전 미증가)
  app.patch<{ Params: { id: string } }>('/api/v1/jobs/:id/composition', async (req, reply) => {
    const job = await repos.jobs.find(req.params.id);
    if (!job || !canAccessJob(job, req)) {
      return apiError(reply, 404, 'NOT_FOUND', '잡을 찾을 수 없습니다.');
    }
    if (job.status !== 'DONE') {
      return apiError(reply, 409, 'INVALID_STATE', '완료된 잡만 보정할 수 있습니다.');
    }
    const base = await currentComposition(deps, job.id);
    if (!base) {
      return apiError(reply, 409, 'INVALID_STATE', '컴포지션이 없습니다.');
    }

    const analysis = await loadAnalysis(deps, job.id);
    const result = applyCompositionPatch(base, (req.body ?? {}) as CompositionPatchInput, {
      analysis,
      presets: Object.fromEntries(deps.presetCatalog.map((p) => [p.id, p])),
      bgmCatalog: deps.bgmCatalog,
      hasAudio: job.sourceMeta?.hasAudio,
    });
    if (!result.ok) {
      return apiError(reply, 400, 'VALIDATION_ERROR', result.errors.join('; '));
    }

    await repos.jobs.setDraft(job.id, result.composition);
    for (const correction of result.corrections) {
      await repos.corrections.insert({ jobId: job.id, ...correction });
    }
    return reply.send({ composition: result.composition, hasDraft: true });
  });

  // 재렌더링 (F-24): 드래프트(없으면 현재 컴포지션)를 새 리비전으로 확정하고 렌더만 재실행
  app.post<{ Params: { id: string } }>('/api/v1/jobs/:id/render', async (req, reply) => {
    const job = await repos.jobs.find(req.params.id);
    if (!job || !canAccessJob(job, req)) {
      return apiError(reply, 404, 'NOT_FOUND', '잡을 찾을 수 없습니다.');
    }
    if (job.status !== 'DONE') {
      return apiError(reply, 409, 'INVALID_STATE', '진행 중인 렌더가 있거나 완료되지 않은 잡입니다.');
    }
    const base = await currentComposition(deps, job.id);
    if (!base) {
      return apiError(reply, 409, 'INVALID_STATE', '컴포지션이 없습니다.');
    }

    const revision = job.currentRevision + 1;
    const composition: Composition = { ...base, revision };
    const createdBy = (await repos.jobs.getDraft(job.id)) ? 'user' : 'auto';
    await repos.jobs.insertComposition(job.id, revision, composition, createdBy);

    const transitioned = await repos.jobs.transition(job.id, 'DONE', 'RENDERING', {
      stage: 'render',
      progress: 50,
    });
    if (!transitioned) {
      return apiError(reply, 409, 'INVALID_STATE', '이미 다른 렌더가 시작되었습니다.');
    }
    await repos.jobs.clearDraft(job.id);
    await deps.queue.enqueue('render', { jobId: job.id, revision }, { attempts: 2 });
    return reply.code(202).send({ jobId: job.id, status: 'RENDERING', revision });
  });

  // 리비전 이력 (최근 5개 보관, docs/06-api-spec.md §6.5)
  app.get<{ Params: { id: string } }>('/api/v1/jobs/:id/revisions', async (req, reply) => {
    const job = await repos.jobs.find(req.params.id);
    if (!job || !canAccessJob(job, req)) {
      return apiError(reply, 404, 'NOT_FOUND', '잡을 찾을 수 없습니다.');
    }
    const outputs = await repos.jobs.listOutputs(job.id);
    return reply.send(
      outputs.map((o) => ({
        revision: o.revision,
        createdAt: o.createdAt.toISOString(),
        duration: o.duration,
        thumbnailUrl: o.thumbnailKey
          ? `/api/v1/files?token=${deps.signer.sign({
              key: o.thumbnailKey,
              exp: Math.floor(Date.now() / 1000) + 3600,
              disposition: 'inline',
            })}`
          : null,
      })),
    );
  });
}
