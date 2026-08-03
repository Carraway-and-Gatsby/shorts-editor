import type { Repos } from '@shorts/db';
import type { ObjectStorage } from '@shorts/storage';
import type { BgmTrackDef } from '../compose/bgm.js';
import type { PresetDef } from '../compose/presets.js';
import type { ScoringConfig } from '../compose/scoring.js';

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
  enqueueAnalyze(payload: StagePayload): Promise<void>;
  enqueueRender(payload: StagePayload): Promise<void>;
  /** 임시 작업 디렉터리 루트 (기본: os.tmpdir()) */
  tempRoot?: string;
  /** 하이라이트 점수 가중치 (기본: DEFAULT_SCORING) */
  scoring?: ScoringConfig;
  /** 프리셋 카탈로그 (기본: DEFAULT_PRESETS) */
  presets?: Record<string, PresetDef>;
  /** BGM 카탈로그 (없으면 BGM 미사용) */
  bgmCatalog?: BgmTrackDef[];
  /** BGM 트랙 파일 디렉터리 (렌더 워커용, 기본 ./assets/bgm) */
  bgmDir?: string;
  /** 금칙어 목록 (F-14-R3) */
  bannedWords?: string[];
}
