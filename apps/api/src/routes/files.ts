import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { apiError } from '../lib/errors.js';
import { parseRangeHeader } from '../lib/range.js';

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** 서명 토큰 기반 파일 서빙. Range 요청을 지원해 <video> 탐색이 가능하다. */
export function registerFileRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Querystring: { token?: string } }>('/api/v1/files', async (req, reply) => {
    const token = req.query.token;
    const payload = token ? deps.signer.verify(token) : null;
    if (!payload) {
      return apiError(reply, 404, 'NOT_FOUND', '유효하지 않거나 만료된 링크입니다.');
    }
    if (!(await deps.storage.exists(payload.key))) {
      return apiError(reply, 404, 'NOT_FOUND', '파일이 존재하지 않습니다.');
    }

    const { size } = await deps.storage.stat(payload.key);
    const range = parseRangeHeader(req.headers.range, size);
    if (range === 'invalid') {
      return reply.code(416).header('content-range', `bytes */${size}`).send();
    }

    reply.header('accept-ranges', 'bytes');
    reply.header('content-type', contentTypeFor(payload.key));
    if (payload.disposition === 'attachment') {
      const filename = payload.filename ?? payload.key.split('/').pop() ?? 'download';
      reply.header('content-disposition', `attachment; filename="${filename}"`);
    }

    if (range) {
      const stream = await deps.storage.getStream(payload.key, range);
      return reply
        .code(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${size}`)
        .header('content-length', range.end - range.start + 1)
        .send(stream);
    }
    const stream = await deps.storage.getStream(payload.key);
    return reply.code(200).header('content-length', size).send(stream);
  });
}
