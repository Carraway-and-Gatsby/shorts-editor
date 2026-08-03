import type { JobRow, OutputRow } from '@shorts/db';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { apiError } from '../lib/errors.js';

const DOWNLOAD_TTL_HOURS = 24;
const THUMBNAIL_TTL_HOURS = 1;

function jobResponse(job: JobRow, output: OutputRow | null, deps: AppDeps) {
  const result =
    job.status === 'DONE' && output
      ? {
          revision: output.revision,
          duration: output.duration,
          thumbnailUrl: output.thumbnailKey
            ? fileUrl(deps, output.thumbnailKey, 'inline', THUMBNAIL_TTL_HOURS)
            : null,
          downloadUrl: null,
        }
      : null;
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    createdAt: job.createdAt.toISOString(),
    source: job.sourceMeta
      ? {
          duration: job.sourceMeta.duration,
          width: job.sourceMeta.width,
          height: job.sourceMeta.height,
          hasAudio: job.sourceMeta.hasAudio,
        }
      : null,
    options: job.options,
    currentRevision: job.currentRevision,
    result,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage } : null,
  };
}

function fileUrl(
  deps: AppDeps,
  key: string,
  disposition: 'inline' | 'attachment',
  ttlHours: number,
  filename?: string,
): string {
  const token = deps.signer.sign({
    key,
    exp: Math.floor(Date.now() / 1000) + ttlHours * 3600,
    disposition,
    filename,
  });
  return `/api/v1/files?token=${token}`;
}

export function registerJobRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { repos } = deps;

  // 잡 상세 (F-40)
  app.get<{ Params: { id: string } }>('/api/v1/jobs/:id', async (req, reply) => {
    const job = await repos.jobs.find(req.params.id);
    if (!job || job.sessionId !== req.sessionId) {
      return apiError(reply, 404, 'NOT_FOUND', '잡을 찾을 수 없습니다.');
    }
    const output =
      job.status === 'DONE' ? await repos.jobs.getOutput(job.id, job.currentRevision) : null;
    return reply.send(jobResponse(job, output, deps));
  });

  // 상태 스트림 (SSE, F-40)
  app.get<{ Params: { id: string } }>('/api/v1/jobs/:id/events', async (req, reply) => {
    const job = await repos.jobs.find(req.params.id);
    if (!job || job.sessionId !== req.sessionId) {
      return apiError(reply, 404, 'NOT_FOUND', '잡을 찾을 수 없습니다.');
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(':ok\n\n');

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let lastSerialized = '';
    let finished = false;

    const finish = () => {
      if (!finished) {
        finished = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        reply.raw.end();
      }
    };

    const tick = async () => {
      const current = await repos.jobs.find(req.params.id);
      if (!current) {
        finish();
        return;
      }
      if (current.status === 'DONE') {
        send('done', { status: 'DONE', revision: current.currentRevision });
        finish();
        return;
      }
      if (current.status === 'FAILED') {
        send('failed', {
          status: 'FAILED',
          error: { code: current.errorCode, message: current.errorMessage },
        });
        finish();
        return;
      }
      const payload = {
        status: current.status,
        progress: current.progress,
        stage: current.stage,
      };
      const serialized = JSON.stringify(payload);
      if (serialized !== lastSerialized) {
        lastSerialized = serialized;
        send('progress', payload);
      }
    };

    const timer = setInterval(() => void tick(), 1000);
    const heartbeat = setInterval(() => {
      if (!finished) {
        reply.raw.write(':hb\n\n');
      }
    }, 15_000);
    req.raw.on('close', finish);
    await tick();
  });

  // 다운로드 URL 발급 (F-30)
  app.post<{ Params: { id: string } }>('/api/v1/jobs/:id/download-url', async (req, reply) => {
    const job = await repos.jobs.find(req.params.id);
    if (!job || job.sessionId !== req.sessionId) {
      return apiError(reply, 404, 'NOT_FOUND', '잡을 찾을 수 없습니다.');
    }
    if (job.status !== 'DONE') {
      return apiError(reply, 409, 'INVALID_STATE', '아직 결과물이 준비되지 않았습니다.');
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const revision =
      typeof body.revision === 'number' ? body.revision : job.currentRevision;
    const output = await repos.jobs.getOutput(job.id, revision);
    if (!output) {
      return apiError(reply, 404, 'NOT_FOUND', '해당 리비전의 결과물이 없습니다.');
    }
    const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_HOURS * 3600 * 1000);
    const url = fileUrl(
      deps,
      output.storageKey,
      'attachment',
      DOWNLOAD_TTL_HOURS,
      `shorts_${job.id}_r${revision}.mp4`,
    );
    return reply.send({ url, expiresAt: expiresAt.toISOString() });
  });
}
