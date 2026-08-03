/** 하이라이트 세그먼트 점수화 (F-12, docs/04-pipeline-spec.md §4.3.1) */

import type { AnalysisDoc, Shot } from '@shorts/shared';

export interface ScoringConfig {
  weights: {
    speechDensity: number;
    audioEnergy: number;
    motion: number;
    facePresence: number;
    quality: number;
  };
  penalties: {
    shake: number;
    dark: number;
  };
}

/** config/scoring.yaml과 동일한 기본값 */
export const DEFAULT_SCORING: ScoringConfig = {
  weights: {
    speechDensity: 0.3,
    audioEnergy: 0.2,
    motion: 0.2,
    facePresence: 0.15,
    quality: 0.15,
  },
  penalties: {
    shake: 0.3,
    dark: 0.2,
  },
};

export interface CandidateSegment {
  start: number;
  end: number;
  /** 발화 단위에서 왔는지 (경계가 문장/무음에 스냅되어 있음) */
  fromSpeech: boolean;
}

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** 세그먼트와 겹치는 샷들의 신호를 시간 가중 평균한다. */
export function aggregateShotSignals(
  shots: Shot[],
  start: number,
  end: number,
): { motion: number; shake: number; quality: number; facePresence: number; darkness: number } {
  let total = 0;
  const acc = { motion: 0, shake: 0, quality: 0, facePresence: 0, darkness: 0 };
  for (const shot of shots) {
    const weight = overlap(start, end, shot.start, shot.end);
    if (weight <= 0) {
      continue;
    }
    total += weight;
    acc.motion += shot.signals.motion * weight;
    acc.shake += shot.signals.shake * weight;
    acc.quality += shot.signals.quality * weight;
    acc.facePresence += shot.signals.facePresence * weight;
    acc.darkness += shot.signals.darkness * weight;
  }
  if (total === 0) {
    return { motion: 0, shake: 0, quality: 0.5, facePresence: 0, darkness: 0 };
  }
  return {
    motion: acc.motion / total,
    shake: acc.shake / total,
    quality: acc.quality / total,
    facePresence: acc.facePresence / total,
    darkness: acc.darkness / total,
  };
}

/** 세그먼트 내 발화 시간 비율 */
export function speechDensity(analysis: AnalysisDoc, start: number, end: number): number {
  if (!analysis.transcript || end <= start) {
    return 0;
  }
  let speech = 0;
  for (const segment of analysis.transcript.segments) {
    speech += overlap(start, end, segment.start, segment.end);
  }
  return Math.min(1, speech / (end - start));
}

/** 세그먼트 평균 RMS를 전체 최대 RMS 대비 정규화 */
export function audioEnergy(analysis: AnalysisDoc, start: number, end: number): number {
  const samples = analysis.energy.filter((s) => s.t >= start && s.t < end);
  if (samples.length === 0) {
    return 0;
  }
  const max = Math.max(...analysis.energy.map((s) => s.rms), 1e-9);
  const mean = samples.reduce((sum, s) => sum + s.rms, 0) / samples.length;
  return Math.min(1, mean / max);
}

export function scoreSegment(
  analysis: AnalysisDoc,
  segment: CandidateSegment,
  config: ScoringConfig = DEFAULT_SCORING,
): number {
  const signals = aggregateShotSignals(analysis.shots, segment.start, segment.end);
  const { weights, penalties } = config;
  return (
    weights.speechDensity * speechDensity(analysis, segment.start, segment.end) +
    weights.audioEnergy * audioEnergy(analysis, segment.start, segment.end) +
    weights.motion * signals.motion +
    weights.facePresence * signals.facePresence +
    weights.quality * signals.quality -
    penalties.shake * signals.shake -
    penalties.dark * signals.darkness
  );
}
