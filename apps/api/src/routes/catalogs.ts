import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';

/** 프리셋/BGM 카탈로그 (docs/06-api-spec.md §6.6) */
export function registerCatalogRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/presets', async (_req, reply) => {
    return reply.send(
      deps.presetCatalog.map((p) => ({
        id: p.id,
        name: p.name ?? p.id,
        description: p.description ?? '',
        titleCard: p.titleCard,
      })),
    );
  });

  app.get<{ Querystring: { mood?: string } }>('/api/v1/bgm-tracks', async (req, reply) => {
    const mood = req.query.mood;
    const tracks = deps.bgmCatalog.filter((t) => !mood || t.moods.includes(mood));
    return reply.send(
      tracks.map((t) => ({
        id: t.id,
        name: t.name,
        moods: t.moods,
        durationSeconds: t.durationSeconds,
      })),
    );
  });
}
