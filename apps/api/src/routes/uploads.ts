import { Readable } from 'node:stream';
import { newId } from '@shorts/db';
import { storageKeys } from '@shorts/storage';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { apiError } from '../lib/errors.js';
import { parseJobOptions } from '../lib/job-options.js';
import {
  CHUNK_SIZE,
  expectedChunkBytes,
  expectedChunkCount,
  JOB_RETENTION_DAYS,
  UPLOAD_TTL_HOURS,
  validateUploadRequest,
} from '../lib/upload-rules.js';

export function registerUploadRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { repos, storage, queue } = deps;

  // 업로드 세션 생성 (F-01)
  app.post('/api/v1/uploads', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const validation = validateUploadRequest(body);
    if (!validation.ok) {
      return apiError(reply, validation.status, validation.code, validation.message);
    }
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_HOURS * 3600 * 1000);
    const upload = await repos.uploads.create({
      id: newId('up'),
      sessionId: req.sessionId,
      filename: body.filename as string,
      sizeBytes: body.size as number,
      mimeType: body.mimeType as string,
      chunkSize: CHUNK_SIZE,
      expiresAt,
    });
    return reply.code(201).send({
      uploadId: upload.id,
      chunkSize: upload.chunkSize,
      expiresAt: upload.expiresAt.toISOString(),
    });
  });

  // 청크 업로드 (멱등)
  app.put<{ Params: { id: string; index: string } }>(
    '/api/v1/uploads/:id/chunks/:index',
    async (req, reply) => {
      const upload = await repos.uploads.find(req.params.id);
      if (!upload || upload.sessionId !== req.sessionId) {
        return apiError(reply, 404, 'NOT_FOUND', '업로드 세션을 찾을 수 없습니다.');
      }
      if (upload.status !== 'active') {
        return apiError(reply, 409, 'INVALID_STATE', '이미 종료된 업로드 세션입니다.');
      }
      if (upload.expiresAt.getTime() < Date.now()) {
        return apiError(reply, 409, 'INVALID_STATE', '만료된 업로드 세션입니다.');
      }
      const index = Number(req.params.index);
      if (!Number.isInteger(index)) {
        return apiError(reply, 400, 'VALIDATION_ERROR', '청크 인덱스가 올바르지 않습니다.');
      }
      const expected = expectedChunkBytes(index, upload.sizeBytes, upload.chunkSize);
      if (expected < 0) {
        return apiError(reply, 400, 'VALIDATION_ERROR', '청크 인덱스가 범위를 벗어났습니다.');
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length !== expected) {
        return apiError(
          reply,
          400,
          'VALIDATION_ERROR',
          `청크 크기가 올바르지 않습니다 (기대: ${expected} bytes).`,
        );
      }
      await storage.put(storageKeys.uploadChunk(upload.id, index), body);
      return reply.code(204).send();
    },
  );

  // 업로드 완료 → 원본 조립 → 잡 생성 (F-01-R3)
  app.post<{ Params: { id: string } }>('/api/v1/uploads/:id/complete', async (req, reply) => {
    const upload = await repos.uploads.find(req.params.id);
    if (!upload || upload.sessionId !== req.sessionId) {
      return apiError(reply, 404, 'NOT_FOUND', '업로드 세션을 찾을 수 없습니다.');
    }
    if (upload.status !== 'active') {
      return apiError(reply, 409, 'INVALID_STATE', '이미 종료된 업로드 세션입니다.');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const optionsResult = parseJobOptions(body.options);
    if (!optionsResult.ok) {
      return apiError(reply, 400, 'VALIDATION_ERROR', optionsResult.message);
    }

    // 모든 청크가 도착했는지 확인
    const total = expectedChunkCount(upload.sizeBytes, upload.chunkSize);
    for (let i = 0; i < total; i++) {
      if (!(await storage.exists(storageKeys.uploadChunk(upload.id, i)))) {
        return apiError(reply, 409, 'INVALID_STATE', `누락된 청크가 있습니다 (index ${i}).`);
      }
    }

    // 원본 조립
    const ext = upload.filename.slice(upload.filename.lastIndexOf('.') + 1).toLowerCase();
    const jobId = newId('job');
    const sourceKey = storageKeys.source(jobId, ext);
    const chunkStream = async function* () {
      for (let i = 0; i < total; i++) {
        yield* await storage.getStream(storageKeys.uploadChunk(upload.id, i));
      }
    };
    await storage.putStream(sourceKey, Readable.from(chunkStream()));

    const { size } = await storage.stat(sourceKey);
    if (size !== upload.sizeBytes) {
      await storage.delete(sourceKey);
      return apiError(
        reply,
        409,
        'INVALID_STATE',
        `업로드된 크기가 선언된 크기와 다릅니다 (${size} != ${upload.sizeBytes}).`,
      );
    }

    const job = await repos.jobs.create({
      id: jobId,
      sessionId: req.sessionId,
      options: optionsResult.options,
      sourceExt: ext,
      expiresAt: new Date(Date.now() + JOB_RETENTION_DAYS * 24 * 3600 * 1000),
    });
    await repos.uploads.setStatus(upload.id, 'completed');

    // 청크는 뒷정리 (실패해도 무방)
    void Promise.all(
      Array.from({ length: total }, (_, i) =>
        storage.delete(storageKeys.uploadChunk(upload.id, i)).catch(() => {}),
      ),
    );

    await queue.enqueue('ingest', { jobId: job.id, revision: 1 });
    return reply.code(201).send({ jobId: job.id, status: job.status });
  });

  // 업로드 취소
  app.delete<{ Params: { id: string } }>('/api/v1/uploads/:id', async (req, reply) => {
    const upload = await repos.uploads.find(req.params.id);
    if (!upload || upload.sessionId !== req.sessionId) {
      return apiError(reply, 404, 'NOT_FOUND', '업로드 세션을 찾을 수 없습니다.');
    }
    await repos.uploads.setStatus(upload.id, 'canceled');
    const total = expectedChunkCount(upload.sizeBytes, upload.chunkSize);
    await Promise.all(
      Array.from({ length: total }, (_, i) =>
        storage.delete(storageKeys.uploadChunk(upload.id, i)).catch(() => {}),
      ),
    );
    return reply.code(204).send();
  });
}
