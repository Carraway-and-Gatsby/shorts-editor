import type { FastifyReply } from 'fastify';

/** 오류 응답 형식. docs/06-api-spec.md §6.1 참조. */
export function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}
