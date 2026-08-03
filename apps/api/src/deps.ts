import type { Repos } from '@shorts/db';
import type { StageQueue } from '@shorts/queue';
import type { ObjectStorage } from '@shorts/storage';
import type { FileTokenSigner } from './lib/signer.js';

export interface AppDeps {
  repos: Repos;
  storage: ObjectStorage;
  queue: StageQueue;
  signer: FileTokenSigner;
  checkRedis(): Promise<boolean>;
  checkPostgres(): Promise<boolean>;
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string;
  }
}
