import cookie from '@fastify/cookie';
import { newId } from '@shorts/db';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppDeps } from './deps.js';
import { CHUNK_SIZE } from './lib/upload-rules.js';
import { registerCatalogRoutes } from './routes/catalogs.js';
import { registerCompositionRoutes } from './routes/compositions.js';
import { registerFileRoutes } from './routes/files.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerUploadRoutes } from './routes/uploads.js';

const SESSION_COOKIE = 'sid';
const SESSION_MAX_AGE_SECONDS = 180 * 24 * 3600;

/** 의존성 주입으로 조립되는 API 서버. 테스트에서는 인메모리 구현으로 검증한다. */
export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cookie);

  // 청크 업로드용 바이너리 파서
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: CHUNK_SIZE + 1024 },
    (_req, body, done) => done(null, body),
  );

  // 익명 세션 (MVP: F-42는 익명+세션 쿠키)
  app.decorateRequest('sessionId', '');
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz' || req.url.startsWith('/api/v1/healthz')) {
      return;
    }
    const sid = req.cookies[SESSION_COOKIE];
    if (sid && (await deps.repos.sessions.find(sid))) {
      req.sessionId = sid;
      return;
    }
    const session = await deps.repos.sessions.create(newId('ses'));
    req.sessionId = session.id;
    reply.setCookie(SESSION_COOKIE, session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  });

  // 헬스체크
  const healthHandler = async () => {
    const [redisOk, postgresOk] = await Promise.all([
      deps.checkRedis().catch(() => false),
      deps.checkPostgres().catch(() => false),
    ]);
    const ok = redisOk && postgresOk;
    return {
      statusCode: ok ? 200 : 503,
      body: {
        status: ok ? 'ok' : 'degraded',
        redis: redisOk ? 'up' : 'down',
        postgres: postgresOk ? 'up' : 'down',
      },
    };
  };
  for (const path of ['/healthz', '/api/v1/healthz']) {
    app.get(path, async (_request, reply) => {
      const { statusCode, body } = await healthHandler();
      return reply.code(statusCode).send(body);
    });
  }

  registerUploadRoutes(app, deps);
  registerJobRoutes(app, deps);
  registerCompositionRoutes(app, deps);
  registerCatalogRoutes(app, deps);
  registerFileRoutes(app, deps);

  return app;
}
