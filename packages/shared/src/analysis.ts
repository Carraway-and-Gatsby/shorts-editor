/**
 * Analyze 단계 산출물(analysis.json) 타입.
 * Python analyze 워커가 생성하고 Node compose 단계가 소비한다.
 * docs/04-pipeline-spec.md §4.2 참조.
 */

export interface AnalysisSourceInfo {
  duration: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

/** 샷별 신호. 모두 0~1 정규화 값. */
export interface ShotSignals {
  /** 모션 크기 */
  motion: number;
  /** 흔들림 정도 (페널티) */
  shake: number;
  /** 노출·선명도 종합 품질 */
  quality: number;
  /** 얼굴 등장 시간 비율 */
  facePresence: number;
  /** 과암 정도 (페널티) */
  darkness: number;
}

/** 피사체(얼굴) 위치 샘플. 좌표는 프레임 크기 대비 0~1. */
export interface SubjectPoint {
  /** 원본 시간축 기준 시각(초) */
  t: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface Shot {
  start: number;
  end: number;
  signals: ShotSignals;
  subjectTrack: SubjectPoint[];
}

export interface TranscriptWord {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface Transcript {
  language: string;
  segments: TranscriptSegment[];
}

export interface SilenceSpan {
  start: number;
  end: number;
}

/** 0.5초 창 RMS 에너지 샘플 */
export interface EnergySample {
  t: number;
  rms: number;
}

export interface AnalysisDoc {
  version: 1;
  jobId: string;
  source: AnalysisSourceInfo;
  shots: Shot[];
  /** 오디오가 없거나 STT 실패 시 null */
  transcript: Transcript | null;
  silences: SilenceSpan[];
  energy: EnergySample[];
  warnings: string[];
}

/** 최소한의 구조 검증. 상세 스키마 검증은 필요해질 때 추가한다. */
export function isAnalysisDoc(data: unknown): data is AnalysisDoc {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const doc = data as Record<string, unknown>;
  return (
    doc.version === 1 &&
    typeof doc.jobId === 'string' &&
    typeof doc.source === 'object' &&
    doc.source !== null &&
    Array.isArray(doc.shots) &&
    Array.isArray(doc.silences) &&
    Array.isArray(doc.energy) &&
    Array.isArray(doc.warnings) &&
    (doc.transcript === null || typeof doc.transcript === 'object')
  );
}
