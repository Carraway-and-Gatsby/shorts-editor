import type { Repos } from '@shorts/db';
import type { BgmTrackDef, PresetDef } from '@shorts/media';
import type { StageQueue } from '@shorts/queue';
import type { ObjectStorage } from '@shorts/storage';
import type { FileTokenSigner } from './lib/signer.js';

export interface AppDeps {
  repos: Repos;
  storage: ObjectStorage;
  queue: StageQueue;
  signer: FileTokenSigner;
  /** 프리셋 카탈로그 (config/presets/*.json) */
  presetCatalog: PresetDef[];
  /** BGM 카탈로그 (assets/bgm/catalog.json) */
  bgmCatalog: BgmTrackDef[];
  checkRedis(): Promise<boolean>;
  checkPostgres(): Promise<boolean>;
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string;
    /** 로그인된 사용자 (익명이면 null) */
    userId: string | null;
  }
}
