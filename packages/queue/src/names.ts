import type { JobStage } from '@shorts/shared';

/** 파이프라인 단계별 큐 이름. 워커는 자기 단계의 큐만 소비한다. */
export const QUEUE_NAMES: Record<JobStage, string> = {
  ingest: 'stage-ingest',
  analyze: 'stage-analyze',
  compose: 'stage-compose',
  render: 'stage-render',
};

/**
 * 큐 메시지는 식별자만 담는다. 상세 데이터는 DB/스토리지에서 조회한다.
 * docs/05-architecture.md §5.3 참조.
 */
export interface StageJobPayload {
  jobId: string;
  revision: number;
}
