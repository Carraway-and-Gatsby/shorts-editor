import type { Composition } from './composition.js';

export interface DefaultCompositionInput {
  jobId: string;
  revision: number;
  /** 원본 길이(초) */
  sourceDuration: number;
  /** 원본 fps (모르면 생략) */
  sourceFps?: number;
  /** 목표 길이(초). 'auto'면 60초 상한. */
  targetDuration?: 15 | 30 | 60 | 90 | 'auto';
  preset?: string;
}

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
export const OUTPUT_MAX_FPS = 30;
export const DEFAULT_TARGET_DURATION = 60;

/**
 * 분석 결과 없이 만드는 기본 컴포지션.
 * M1: 하이라이트 선택(F-12) 전이므로 원본 시작부터 목표 길이만큼 단일 컷을 사용하고,
 * 리프레이밍은 pad 모드, 자막/BGM 없음. M2에서 분석 기반 컴포지션으로 대체된다.
 */
export function buildDefaultComposition(input: DefaultCompositionInput): Composition {
  const target =
    input.targetDuration === undefined || input.targetDuration === 'auto'
      ? DEFAULT_TARGET_DURATION
      : input.targetDuration;
  const duration = Math.min(input.sourceDuration, target);
  const fps = Math.min(OUTPUT_MAX_FPS, input.sourceFps ?? OUTPUT_MAX_FPS);

  return {
    version: 1,
    jobId: input.jobId,
    revision: input.revision,
    output: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, fps, duration },
    cuts: [{ id: 'c1', sourceStart: 0, sourceEnd: duration, transition: 'cut' }],
    reframe: { mode: 'pad', keyframes: [] },
    subtitles: { style: input.preset ?? 'clean', blocks: [] },
    audio: { bgm: null, loudnessTarget: -14 },
    style: { preset: input.preset ?? 'clean', titleCard: null, lut: null },
  };
}
