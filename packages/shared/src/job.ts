/** 잡 상태 머신 정의. docs/07-data-model.md §7.3 참조. */

export const JOB_STATUSES = [
  'UPLOADING',
  'QUEUED',
  'ANALYZING',
  'COMPOSING',
  'RENDERING',
  'DONE',
  'FAILED',
  'CANCELED',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STAGES = ['ingest', 'analyze', 'compose', 'render'] as const;

export type JobStage = (typeof JOB_STAGES)[number];

/** 전체 진행률 계산용 단계별 가중치(%). docs/04-pipeline-spec.md §4.5 참조. */
export const STAGE_PROGRESS_WEIGHTS: Record<JobStage, number> = {
  ingest: 10,
  analyze: 35,
  compose: 5,
  render: 50,
};

export const TERMINAL_STATUSES: readonly JobStatus[] = ['FAILED', 'CANCELED'];

/**
 * 허용되는 상태 전이. DONE → RENDERING은 재렌더링(F-24)의 유일한 역방향 전이다.
 * FAILED/CANCELED는 종료 상태이며 재시도는 새 잡으로 생성한다.
 */
export const JOB_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  UPLOADING: ['QUEUED', 'FAILED', 'CANCELED'],
  QUEUED: ['ANALYZING', 'FAILED', 'CANCELED'],
  ANALYZING: ['COMPOSING', 'FAILED', 'CANCELED'],
  COMPOSING: ['RENDERING', 'FAILED', 'CANCELED'],
  RENDERING: ['DONE', 'FAILED', 'CANCELED'],
  DONE: ['RENDERING'],
  FAILED: [],
  CANCELED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}
