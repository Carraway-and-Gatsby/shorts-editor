/** 컴포지션 타입 정의. docs/04-pipeline-spec.md §4.3.3의 JSON 스키마와 짝을 이룬다. */

export interface CompositionOutput {
  width: number;
  height: number;
  fps: number;
  /** 출력 총 길이(초) */
  duration: number;
}

export type TransitionType = 'cut' | 'crossfade';

export interface Cut {
  id: string;
  /** 원본 시간축 기준 시작(초) */
  sourceStart: number;
  /** 원본 시간축 기준 끝(초) */
  sourceEnd: number;
  transition: TransitionType;
}

export type ReframeMode = 'track' | 'pad' | 'none';

export interface ReframeKeyframe {
  /** 출력 시간축 기준 시각(초) */
  t: number;
  /** 크롭 중심 x (프레임 폭 대비 0~1) */
  cx: number;
  /** 크롭 중심 y (프레임 높이 대비 0~1) */
  cy: number;
  zoom: number;
}

export interface Reframe {
  mode: ReframeMode;
  keyframes: ReframeKeyframe[];
}

export interface SubtitleWord {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleBlock {
  id: string;
  /** 출력 시간축 기준(초) */
  start: number;
  end: number;
  text: string;
  words: SubtitleWord[];
}

export interface Subtitles {
  style: string;
  blocks: SubtitleBlock[];
}

export interface BgmSettings {
  trackId: string;
  gainDb: number;
  duckDb: number;
}

export interface AudioSettings {
  bgm: BgmSettings | null;
  /** LUFS 목표값 (예: -14) */
  loudnessTarget: number;
}

export interface StyleSettings {
  preset: string;
  titleCard: string | null;
  lut: string | null;
}

export interface Composition {
  version: 1;
  jobId: string;
  revision: number;
  output: CompositionOutput;
  cuts: Cut[];
  reframe: Reframe;
  subtitles: Subtitles;
  audio: AudioSettings;
  style: StyleSettings;
}
