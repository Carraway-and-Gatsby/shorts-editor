import type { Composition, JobStage, JobStatus } from '@shorts/shared';

export interface SessionRow {
  id: string;
  createdAt: Date;
}

export type UploadStatus = 'active' | 'completed' | 'canceled';

export interface UploadRow {
  id: string;
  sessionId: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  chunkSize: number;
  status: UploadStatus;
  createdAt: Date;
  expiresAt: Date;
}

/** F-03 생성 옵션 (기본값 채워진 형태로 저장) */
export interface JobOptions {
  targetDuration: 15 | 30 | 60 | 90 | 'auto';
  preset: string;
  subtitle: 'on' | 'off';
  bgm: 'auto' | 'off' | string;
  reframe: 'track' | 'pad' | 'auto';
  language: string;
}

/** Ingest 단계에서 기록하는 원본 메타데이터 (표시 방향 기준) */
export interface SourceMeta {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  rotation: number;
}

export interface JobRow {
  id: string;
  sessionId: string;
  status: JobStatus;
  stage: JobStage | null;
  progress: number;
  options: JobOptions;
  sourceExt: string;
  sourceMeta: SourceMeta | null;
  currentRevision: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface OutputRow {
  jobId: string;
  revision: number;
  storageKey: string;
  thumbnailKey: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  createdAt: Date;
}

export interface SessionsRepo {
  /** id의 세션이 있으면 갱신, 없으면 null */
  find(id: string): Promise<SessionRow | null>;
  create(id: string): Promise<SessionRow>;
}

export interface UploadsRepo {
  create(input: {
    id: string;
    sessionId: string;
    filename: string;
    sizeBytes: number;
    mimeType: string;
    chunkSize: number;
    expiresAt: Date;
  }): Promise<UploadRow>;
  find(id: string): Promise<UploadRow | null>;
  setStatus(id: string, status: UploadStatus): Promise<void>;
}

export interface CreateJobInput {
  id: string;
  sessionId: string;
  options: JobOptions;
  sourceExt: string;
  expiresAt: Date;
}

export interface JobsRepo {
  create(input: CreateJobInput): Promise<JobRow>;
  find(id: string): Promise<JobRow | null>;
  /**
   * 낙관적 상태 전이. 현재 상태가 from일 때만 to로 바꾼다.
   * @returns 전이 성공 여부
   */
  transition(
    id: string,
    from: JobStatus,
    to: JobStatus,
    patch?: { stage?: JobStage | null; progress?: number },
  ): Promise<boolean>;
  setProgress(id: string, stage: JobStage, progress: number): Promise<void>;
  setSourceMeta(id: string, meta: SourceMeta): Promise<void>;
  fail(id: string, code: string, message: string, internal?: unknown): Promise<void>;
  insertComposition(
    jobId: string,
    revision: number,
    composition: Composition,
    createdBy: 'auto' | 'user',
  ): Promise<void>;
  getComposition(jobId: string, revision: number): Promise<Composition | null>;
  insertOutput(output: OutputRow): Promise<void>;
  getOutput(jobId: string, revision: number): Promise<OutputRow | null>;
}

export interface Repos {
  sessions: SessionsRepo;
  uploads: UploadsRepo;
  jobs: JobsRepo;
}
