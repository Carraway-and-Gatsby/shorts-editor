import { canTransition, TERMINAL_STATUSES, type Composition, type JobStage, type JobStatus } from '@shorts/shared';
import type {
  CreateJobInput,
  JobRow,
  OutputRow,
  Repos,
  SessionRow,
  SourceMeta,
  UploadRow,
  UploadStatus,
} from './types.js';

/**
 * 인메모리 리포지토리. 단위 테스트와 파이프라인 통합 테스트에서 PostgreSQL 대체용.
 * PG 구현과 동일한 의미론(낙관적 전이, 종료 상태 보호)을 유지해야 한다.
 */
export function createMemoryRepos(): Repos & {
  dump(): { jobs: Map<string, JobRow> };
} {
  const sessions = new Map<string, SessionRow>();
  const uploads = new Map<string, UploadRow>();
  const jobs = new Map<string, JobRow>();
  const compositions = new Map<string, Composition>();
  const compositionMeta = new Map<string, 'auto' | 'user'>();
  const outputs = new Map<string, OutputRow>();

  const compKey = (jobId: string, revision: number) => `${jobId}:${revision}`;

  return {
    sessions: {
      async find(id: string): Promise<SessionRow | null> {
        return sessions.get(id) ?? null;
      },
      async create(id: string): Promise<SessionRow> {
        const row: SessionRow = { id, createdAt: new Date() };
        sessions.set(id, row);
        return row;
      },
    },

    uploads: {
      async create(input): Promise<UploadRow> {
        const row: UploadRow = { ...input, status: 'active', createdAt: new Date() };
        uploads.set(input.id, row);
        return row;
      },
      async find(id: string): Promise<UploadRow | null> {
        return uploads.get(id) ?? null;
      },
      async setStatus(id: string, status: UploadStatus): Promise<void> {
        const row = uploads.get(id);
        if (row) {
          uploads.set(id, { ...row, status });
        }
      },
    },

    jobs: {
      async create(input: CreateJobInput): Promise<JobRow> {
        const now = new Date();
        const row: JobRow = {
          id: input.id,
          sessionId: input.sessionId,
          status: 'QUEUED',
          stage: null,
          progress: 0,
          options: input.options,
          sourceExt: input.sourceExt,
          sourceMeta: null,
          currentRevision: 0,
          errorCode: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          expiresAt: input.expiresAt,
        };
        jobs.set(input.id, row);
        return row;
      },
      async find(id: string): Promise<JobRow | null> {
        return jobs.get(id) ?? null;
      },
      async transition(
        id: string,
        from: JobStatus,
        to: JobStatus,
        patch?: { stage?: JobStage | null; progress?: number },
      ): Promise<boolean> {
        const row = jobs.get(id);
        if (!row || row.status !== from) {
          return false;
        }
        jobs.set(id, {
          ...row,
          status: to,
          stage: patch?.stage !== undefined ? patch.stage : row.stage,
          progress: patch?.progress ?? row.progress,
          updatedAt: new Date(),
        });
        return true;
      },
      async setProgress(id: string, stage: JobStage, progress: number): Promise<void> {
        const row = jobs.get(id);
        if (row) {
          jobs.set(id, { ...row, stage, progress, updatedAt: new Date() });
        }
      },
      async setSourceMeta(id: string, meta: SourceMeta): Promise<void> {
        const row = jobs.get(id);
        if (row) {
          jobs.set(id, { ...row, sourceMeta: meta, updatedAt: new Date() });
        }
      },
      async fail(id: string, code: string, message: string): Promise<void> {
        const row = jobs.get(id);
        if (!row || row.status === 'DONE' || TERMINAL_STATUSES.includes(row.status)) {
          return;
        }
        jobs.set(id, {
          ...row,
          status: 'FAILED',
          errorCode: code,
          errorMessage: message,
          updatedAt: new Date(),
        });
      },
      async insertComposition(
        jobId: string,
        revision: number,
        composition: Composition,
        createdBy: 'auto' | 'user',
      ): Promise<void> {
        if (compositions.has(compKey(jobId, revision))) {
          throw new Error(`composition revision already exists: ${jobId} r${revision}`);
        }
        compositions.set(compKey(jobId, revision), composition);
        compositionMeta.set(compKey(jobId, revision), createdBy);
        const row = jobs.get(jobId);
        if (row) {
          jobs.set(jobId, {
            ...row,
            currentRevision: Math.max(row.currentRevision, revision),
            updatedAt: new Date(),
          });
        }
      },
      async getComposition(jobId: string, revision: number): Promise<Composition | null> {
        return compositions.get(compKey(jobId, revision)) ?? null;
      },
      async insertOutput(output: OutputRow): Promise<void> {
        outputs.set(compKey(output.jobId, output.revision), output);
      },
      async getOutput(jobId: string, revision: number): Promise<OutputRow | null> {
        return outputs.get(compKey(jobId, revision)) ?? null;
      },
    },

    dump() {
      return { jobs };
    },
  };
}

export { canTransition };
