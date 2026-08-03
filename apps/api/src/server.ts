import Fastify, { type FastifyInstance } from 'fastify';

export interface HealthDeps {
  checkRedis(): Promise<boolean>;
  checkPostgres(): Promise<boolean>;
}

/** 의존성 주입으로 조립되는 API 서버. 테스트에서는 스텁 의존성으로 검증한다. */
export function buildServer(deps: HealthDeps): FastifyInstance {
  const app = Fastify({ logger: true });

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

  // 컨테이너 헬스체크용과 API 경로 양쪽에 노출한다.
  for (const path of ['/healthz', '/api/v1/healthz']) {
    app.get(path, async (_request, reply) => {
      const { statusCode, body } = await healthHandler();
      return reply.code(statusCode).send(body);
    });
  }

  return app;
}
