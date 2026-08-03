import type { Repos } from '@shorts/db';
import type { ObjectStorage } from '@shorts/storage';

export interface StagePayload {
  jobId: string;
  revision: number;
}

/**
 * 파이프라인 처리 함수의 의존성.
 * 큐 구현에 직접 의존하지 않도록 다음 단계 enqueue는 함수로 주입받는다.
 */
export interface PipelineDeps {
  repos: Repos;
  storage: ObjectStorage;
  enqueueRender(payload: StagePayload): Promise<void>;
  /** 임시 작업 디렉터리 루트 (기본: os.tmpdir()) */
  tempRoot?: string;
}
