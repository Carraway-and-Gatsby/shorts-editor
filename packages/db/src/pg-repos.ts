import type { Composition, JobStage, JobStatus } from '@shorts/shared';
import type pg from 'pg';
import type {
  CreateJobInput,
  JobListPage,
  JobOwner,
  JobRow,
  OutputRow,
  Repos,
  SessionRow,
  SourceMeta,
  SttCorrectionInput,
  UploadRow,
  UploadStatus,
  UserRow,
} from './types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapUpload(row: any): UploadRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes),
    mimeType: row.mime_type,
    chunkSize: row.chunk_size,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function mapUser(row: any): UserRow {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function mapJob(row: any): JobRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id ?? null,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    options: row.options,
    sourceExt: row.source_ext,
    sourceMeta: row.source_meta,
    currentRevision: row.current_revision,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function mapOutput(row: any): OutputRow {
  return {
    jobId: row.job_id,
    revision: row.revision,
    storageKey: row.storage_key,
    thumbnailKey: row.thumbnail_key,
    duration: row.duration,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    createdAt: row.created_at,
  };
}

/** PostgreSQL 기반 리포지토리 구현 */
export function createPgRepos(pool: pg.Pool): Repos {
  return {
    sessions: {
      async find(id: string): Promise<SessionRow | null> {
        const { rows } = await pool.query(
          'UPDATE sessions SET last_seen_at = now() WHERE id = $1 RETURNING id, user_id, created_at',
          [id],
        );
        return rows[0]
          ? { id: rows[0].id, userId: rows[0].user_id ?? null, createdAt: rows[0].created_at }
          : null;
      },
      async create(id: string): Promise<SessionRow> {
        const { rows } = await pool.query(
          'INSERT INTO sessions (id) VALUES ($1) RETURNING id, user_id, created_at',
          [id],
        );
        return { id: rows[0].id, userId: null, createdAt: rows[0].created_at };
      },
      async attachUser(id: string, userId: string | null): Promise<void> {
        await pool.query('UPDATE sessions SET user_id = $2, last_seen_at = now() WHERE id = $1', [
          id,
          userId,
        ]);
      },
    },

    users: {
      async create(input): Promise<UserRow> {
        const { rows } = await pool.query(
          'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
          [input.id, input.email, input.passwordHash],
        );
        return mapUser(rows[0]);
      },
      async findByEmail(email: string): Promise<UserRow | null> {
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        return rows[0] ? mapUser(rows[0]) : null;
      },
      async findById(id: string): Promise<UserRow | null> {
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return rows[0] ? mapUser(rows[0]) : null;
      },
    },

    uploads: {
      async create(input): Promise<UploadRow> {
        const { rows } = await pool.query(
          `INSERT INTO upload_sessions (id, session_id, filename, size_bytes, mime_type, chunk_size, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            input.id,
            input.sessionId,
            input.filename,
            input.sizeBytes,
            input.mimeType,
            input.chunkSize,
            input.expiresAt,
          ],
        );
        return mapUpload(rows[0]);
      },
      async find(id: string): Promise<UploadRow | null> {
        const { rows } = await pool.query('SELECT * FROM upload_sessions WHERE id = $1', [id]);
        return rows[0] ? mapUpload(rows[0]) : null;
      },
      async setStatus(id: string, status: UploadStatus): Promise<void> {
        await pool.query('UPDATE upload_sessions SET status = $2 WHERE id = $1', [id, status]);
      },
    },

    jobs: {
      async create(input: CreateJobInput): Promise<JobRow> {
        const { rows } = await pool.query(
          `INSERT INTO jobs (id, session_id, user_id, status, options, source_ext, expires_at)
           VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6) RETURNING *`,
          [
            input.id,
            input.sessionId,
            input.userId ?? null,
            JSON.stringify(input.options),
            input.sourceExt,
            input.expiresAt,
          ],
        );
        return mapJob(rows[0]);
      },
      async find(id: string): Promise<JobRow | null> {
        const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
        return rows[0] ? mapJob(rows[0]) : null;
      },
      async listByOwner(owner: JobOwner, limit: number, cursor?: string): Promise<JobListPage> {
        // 로그인 시 계정 전체 + 현재 세션의 익명 잡, 익명이면 현재 세션만
        const ownerClause = owner.userId
          ? '(session_id = $1 OR user_id = $2)'
          : 'session_id = $1';
        const params: unknown[] = owner.userId ? [owner.sessionId, owner.userId] : [owner.sessionId];
        params.push(limit + 1);
        const limitIndex = params.length;
        let cursorClause = '';
        if (cursor) {
          params.push(cursor);
          cursorClause = `AND (created_at, id) < (SELECT created_at, id FROM jobs WHERE id = $${params.length})`;
        }
        const { rows } = await pool.query(
          `SELECT * FROM jobs WHERE ${ownerClause} ${cursorClause}
           ORDER BY created_at DESC, id DESC LIMIT $${limitIndex}`,
          params,
        );
        const jobs = rows.map(mapJob);
        const hasMore = jobs.length > limit;
        return {
          jobs: hasMore ? jobs.slice(0, limit) : jobs,
          nextCursor: hasMore ? jobs[limit - 1].id : null,
        };
      },
      async mergeSessionToUser(sessionId: string, userId: string): Promise<number> {
        const { rowCount } = await pool.query(
          'UPDATE jobs SET user_id = $2, updated_at = now() WHERE session_id = $1 AND user_id IS NULL',
          [sessionId, userId],
        );
        return rowCount ?? 0;
      },
      async transition(
        id: string,
        from: JobStatus,
        to: JobStatus,
        patch?: { stage?: JobStage | null; progress?: number },
      ): Promise<boolean> {
        const { rowCount } = await pool.query(
          `UPDATE jobs SET status = $3,
                 stage = CASE WHEN $4::boolean THEN $5 ELSE stage END,
                 progress = COALESCE($6, progress),
                 updated_at = now()
           WHERE id = $1 AND status = $2`,
          [id, from, to, patch?.stage !== undefined, patch?.stage ?? null, patch?.progress ?? null],
        );
        return (rowCount ?? 0) > 0;
      },
      async setProgress(id: string, stage: JobStage, progress: number): Promise<void> {
        await pool.query(
          'UPDATE jobs SET stage = $2, progress = $3, updated_at = now() WHERE id = $1',
          [id, stage, progress],
        );
      },
      async setSourceMeta(id: string, meta: SourceMeta): Promise<void> {
        await pool.query('UPDATE jobs SET source_meta = $2, updated_at = now() WHERE id = $1', [
          id,
          JSON.stringify(meta),
        ]);
      },
      async fail(id: string, code: string, message: string, internal?: unknown): Promise<void> {
        await pool.query(
          `UPDATE jobs SET status = 'FAILED', error_code = $2, error_message = $3,
                 internal_error = $4, updated_at = now()
           WHERE id = $1 AND status NOT IN ('DONE', 'FAILED', 'CANCELED')`,
          [id, code, message, internal === undefined ? null : JSON.stringify(internal)],
        );
      },
      async insertComposition(
        jobId: string,
        revision: number,
        composition: Composition,
        createdBy: 'auto' | 'user',
      ): Promise<void> {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO composition_revisions (job_id, revision, composition, created_by)
             VALUES ($1, $2, $3, $4)`,
            [jobId, revision, JSON.stringify(composition), createdBy],
          );
          await client.query(
            'UPDATE jobs SET current_revision = GREATEST(current_revision, $2), updated_at = now() WHERE id = $1',
            [jobId, revision],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      async getComposition(jobId: string, revision: number): Promise<Composition | null> {
        const { rows } = await pool.query(
          'SELECT composition FROM composition_revisions WHERE job_id = $1 AND revision = $2',
          [jobId, revision],
        );
        return rows[0]?.composition ?? null;
      },
      async insertOutput(output: OutputRow): Promise<void> {
        await pool.query(
          `INSERT INTO outputs (job_id, revision, storage_key, thumbnail_key, duration, width, height, size_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (job_id, revision) DO UPDATE SET
             storage_key = EXCLUDED.storage_key,
             thumbnail_key = EXCLUDED.thumbnail_key,
             duration = EXCLUDED.duration,
             width = EXCLUDED.width,
             height = EXCLUDED.height,
             size_bytes = EXCLUDED.size_bytes`,
          [
            output.jobId,
            output.revision,
            output.storageKey,
            output.thumbnailKey,
            output.duration,
            output.width,
            output.height,
            output.sizeBytes,
          ],
        );
      },
      async getOutput(jobId: string, revision: number): Promise<OutputRow | null> {
        const { rows } = await pool.query(
          'SELECT * FROM outputs WHERE job_id = $1 AND revision = $2 AND deleted_at IS NULL',
          [jobId, revision],
        );
        return rows[0] ? mapOutput(rows[0]) : null;
      },
      async listOutputs(jobId: string): Promise<OutputRow[]> {
        const { rows } = await pool.query(
          'SELECT * FROM outputs WHERE job_id = $1 AND deleted_at IS NULL ORDER BY revision DESC',
          [jobId],
        );
        return rows.map(mapOutput);
      },
      async markOutputDeleted(jobId: string, revision: number): Promise<void> {
        await pool.query(
          'UPDATE outputs SET deleted_at = now() WHERE job_id = $1 AND revision = $2',
          [jobId, revision],
        );
      },
      async getDraft(jobId: string): Promise<Composition | null> {
        const { rows } = await pool.query('SELECT draft_composition FROM jobs WHERE id = $1', [
          jobId,
        ]);
        return rows[0]?.draft_composition ?? null;
      },
      async setDraft(jobId: string, composition: Composition): Promise<void> {
        await pool.query(
          'UPDATE jobs SET draft_composition = $2, updated_at = now() WHERE id = $1',
          [jobId, JSON.stringify(composition)],
        );
      },
      async clearDraft(jobId: string): Promise<void> {
        await pool.query(
          'UPDATE jobs SET draft_composition = NULL, updated_at = now() WHERE id = $1',
          [jobId],
        );
      },
      async listExpired(now: Date, limit: number): Promise<JobRow[]> {
        const { rows } = await pool.query(
          'SELECT * FROM jobs WHERE expires_at < $1 AND cleaned_at IS NULL LIMIT $2',
          [now, limit],
        );
        return rows.map(mapJob);
      },
      async markCleaned(jobId: string): Promise<void> {
        await pool.query('UPDATE jobs SET cleaned_at = now() WHERE id = $1', [jobId]);
      },
    },

    corrections: {
      async insert(input: SttCorrectionInput): Promise<void> {
        await pool.query(
          `INSERT INTO stt_corrections (job_id, block_id, original_text, corrected_text)
           VALUES ($1, $2, $3, $4)`,
          [input.jobId, input.blockId, input.originalText, input.correctedText],
        );
      },
    },
  };
}
