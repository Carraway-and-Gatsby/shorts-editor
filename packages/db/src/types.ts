import type { Composition, JobStage, JobStatus } from '@shorts/shared';

export interface SessionRow {
  id: string;
  /** 로그인된 계정 (익명이면 null) */
  userId: string | null;
  createdAt: Date;
}

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
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
  /** 금칙어 마스킹 (F-14-R3, 기본 off) */
  profanityMask?: 'on' | 'off';
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
  /** 계정 귀속 (익명 잡은 null) */
  userId: string | null;
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
  /** 세션을 계정에 연결 (null이면 로그아웃) */
  attachUser(id: string, userId: string | null): Promise<void>;
}

export interface UsersRepo {
  create(input: { id: string; email: string; passwordHash: string }): Promise<UserRow>;
  findByEmail(email: string): Promise<UserRow | null>;
  findById(id: string): Promise<UserRow | null>;
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
  userId?: string | null;
  options: JobOptions;
  sourceExt: string;
  expiresAt: Date;
}

/** 이력 조회 주체: 로그인 시 계정 전체, 익명이면 현재 세션 */
export interface JobOwner {
  sessionId: string;
  userId: string | null;
}

export interface JobListPage {
  jobs: JobRow[];
  nextCursor: string | null;
}

export interface SttCorrectionInput {
  jobId: string;
  blockId: string;
  originalText: string;
  correctedText: string;
}

export interface JobsRepo {
  create(input: CreateJobInput): Promise<JobRow>;
  find(id: string): Promise<JobRow | null>;
  /** 소유자의 잡 목록 (최신순, 커서 페이지네이션) */
  listByOwner(owner: JobOwner, limit: number, cursor?: string): Promise<JobListPage>;
  /** 익명 이력 병합 (F-42): 세션의 무소속 잡을 계정에 귀속시킨다 */
  mergeSessionToUser(sessionId: string, userId: string): Promise<number>;
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
  /** 삭제되지 않은 출력물 목록 (리비전 내림차순) */
  listOutputs(jobId: string): Promise<OutputRow[]>;
  markOutputDeleted(jobId: string, revision: number): Promise<void>;
  /** 보정용 드래프트 컴포지션 (F-21/F-22). 재렌더링 시 리비전으로 확정된다. */
  getDraft(jobId: string): Promise<Composition | null>;
  setDraft(jobId: string, composition: Composition): Promise<void>;
  clearDraft(jobId: string): Promise<void>;
  /** 보관 기한이 지났고 아직 정리되지 않은 잡 (정리 배치용) */
  listExpired(now: Date, limit: number): Promise<JobRow[]>;
  markCleaned(jobId: string): Promise<void>;
}

export interface CorrectionsRepo {
  insert(input: SttCorrectionInput): Promise<void>;
}

export interface Repos {
  sessions: SessionsRepo;
  users: UsersRepo;
  uploads: UploadsRepo;
  jobs: JobsRepo;
  corrections: CorrectionsRepo;
}
