import { newId } from '@shorts/db';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { apiError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * 계정 (F-42): 이메일+비밀번호 가입/로그인.
 * 가입·로그인 시 현재 익명 세션의 잡이 계정으로 병합된다.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { repos } = deps;

  async function bindSession(sessionId: string, userId: string): Promise<number> {
    await repos.sessions.attachUser(sessionId, userId);
    return repos.jobs.mergeSessionToUser(sessionId, userId);
  }

  app.post('/api/v1/auth/signup', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!EMAIL_PATTERN.test(email)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', '올바른 이메일을 입력해 주세요.');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return apiError(
        reply,
        400,
        'VALIDATION_ERROR',
        `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`,
      );
    }
    if (await repos.users.findByEmail(email)) {
      return apiError(reply, 409, 'INVALID_STATE', '이미 가입된 이메일입니다.');
    }
    const user = await repos.users.create({
      id: newId('usr'),
      email,
      passwordHash: await hashPassword(password),
    });
    const merged = await bindSession(req.sessionId, user.id);
    return reply.code(201).send({ user: { email: user.email }, mergedJobs: merged });
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = email ? await repos.users.findByEmail(email) : null;
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return apiError(reply, 401, 'UNAUTHORIZED', '이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    const merged = await bindSession(req.sessionId, user.id);
    return reply.send({ user: { email: user.email }, mergedJobs: merged });
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    await repos.sessions.attachUser(req.sessionId, null);
    return reply.code(204).send();
  });

  app.get('/api/v1/auth/me', async (req, reply) => {
    if (!req.userId) {
      return reply.send({ user: null });
    }
    const user = await repos.users.findById(req.userId);
    return reply.send({ user: user ? { email: user.email } : null });
  });
}
