/**
 * 리프레이밍 모드 결정과 피사체 추적 경로 계산 (F-13).
 * 크롭 키프레임은 출력 시간축 기준으로 기록된다.
 */

import type { AnalysisDoc, Cut, Reframe, ReframeKeyframe } from '@shorts/shared';

/** 키프레임 샘플링 간격(초) */
const KEYFRAME_INTERVAL = 0.5;
/** 스무딩 이동평균 창 (샘플 수) */
const SMOOTH_WINDOW = 5;
/** 프레임당 최대 이동량 (프레임 폭 비율, F-13-R2) */
const MAX_DELTA_PER_FRAME = 0.015;
/** 피사체 소실 후 중앙 복귀 시작까지 유지 시간(초) */
const HOLD_SECONDS = 3;
/** track 모드 채택 기준: 얼굴 등장 시간 비율 */
const TRACK_FACE_THRESHOLD = 0.6;

export type ReframeChoice = 'track' | 'pad' | 'none';

/** 모드 결정 (F-13 규칙 1) */
export function decideReframeMode(
  analysis: AnalysisDoc,
  cuts: Cut[],
  requested: 'track' | 'pad' | 'auto',
): ReframeChoice {
  const { width, height } = analysis.source;
  const aspect = width / height;
  if (Math.abs(aspect - 9 / 16) / (9 / 16) < 0.05) {
    return 'none';
  }
  if (requested !== 'auto') {
    return requested;
  }
  // 선택된 컷 구간의 시간 가중 얼굴 등장 비율
  let weighted = 0;
  let total = 0;
  for (const cut of cuts) {
    for (const shot of analysis.shots) {
      const overlap = Math.max(
        0,
        Math.min(cut.sourceEnd, shot.end) - Math.max(cut.sourceStart, shot.start),
      );
      if (overlap > 0) {
        weighted += shot.signals.facePresence * overlap;
        total += overlap;
      }
    }
  }
  const facePresence = total > 0 ? weighted / total : 0;
  return facePresence >= TRACK_FACE_THRESHOLD ? 'track' : 'pad';
}

interface SubjectSample {
  /** 원본 시간축 */
  t: number;
  cx: number;
  cy: number;
}

function collectSubjectSamples(analysis: AnalysisDoc): SubjectSample[] {
  const samples: SubjectSample[] = [];
  for (const shot of analysis.shots) {
    for (const point of shot.subjectTrack) {
      samples.push({ t: point.t, cx: point.cx, cy: point.cy });
    }
  }
  return samples.sort((a, b) => a.t - b.t);
}

/** 원본 시각 t의 피사체 중심 (없으면 null) */
function subjectAt(samples: SubjectSample[], t: number, tolerance: number): SubjectSample | null {
  let best: SubjectSample | null = null;
  let bestDist = tolerance;
  for (const sample of samples) {
    const dist = Math.abs(sample.t - t);
    if (dist <= bestDist) {
      best = sample;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * track 모드의 크롭 키프레임 경로 계산.
 * - KEYFRAME_INTERVAL 간격 샘플링, 이동평균 스무딩
 * - 프레임당 이동량 클램프 (F-13-R2)
 * - 피사체 소실 시 마지막 위치 유지 → 3초 후 중앙으로 서서히 복귀
 * - 자막·UI 안전영역을 고려해 세로는 중앙~상단 유지 (F-13-R3)
 */
export function buildTrackKeyframes(
  analysis: AnalysisDoc,
  cuts: Cut[],
  fps: number,
): ReframeKeyframe[] {
  const samples = collectSubjectSamples(analysis);
  const keyframes: ReframeKeyframe[] = [];
  let outputOffset = 0;
  let lastCx = 0.5;
  let lastCy = 0.45;
  let missingSince: number | null = null;

  const maxDeltaPerKeyframe = MAX_DELTA_PER_FRAME * fps * KEYFRAME_INTERVAL;

  for (const cut of cuts) {
    const cutLen = cut.sourceEnd - cut.sourceStart;
    const raw: Array<{ tOut: number; cx: number | null; cy: number | null }> = [];
    for (let offset = 0; offset <= cutLen + 1e-6; offset += KEYFRAME_INTERVAL) {
      const tSource = Math.min(cut.sourceStart + offset, cut.sourceEnd);
      const subject = subjectAt(samples, tSource, KEYFRAME_INTERVAL);
      raw.push({
        tOut: outputOffset + Math.min(offset, cutLen),
        cx: subject?.cx ?? null,
        cy: subject?.cy ?? null,
      });
    }

    // 결측 채움 (유지 → 중앙 복귀) 후 스무딩
    const filled = raw.map((point) => {
      if (point.cx !== null && point.cy !== null) {
        missingSince = null;
        lastCx = point.cx;
        lastCy = point.cy;
        return { tOut: point.tOut, cx: point.cx, cy: point.cy };
      }
      missingSince ??= point.tOut;
      const missingFor = point.tOut - missingSince;
      if (missingFor <= HOLD_SECONDS) {
        return { tOut: point.tOut, cx: lastCx, cy: lastCy };
      }
      const recovery = Math.min(1, (missingFor - HOLD_SECONDS) / 2);
      return {
        tOut: point.tOut,
        cx: lastCx + (0.5 - lastCx) * recovery,
        cy: lastCy + (0.45 - lastCy) * recovery,
      };
    });

    const smoothed = filled.map((point, i) => {
      const from = Math.max(0, i - Math.floor(SMOOTH_WINDOW / 2));
      const to = Math.min(filled.length, i + Math.ceil(SMOOTH_WINDOW / 2));
      const window = filled.slice(from, to);
      return {
        tOut: point.tOut,
        cx: window.reduce((s, p) => s + p.cx, 0) / window.length,
        cy: window.reduce((s, p) => s + p.cy, 0) / window.length,
      };
    });

    // 컷 내부에서는 이동량 클램프, 컷 경계에서는 점프 허용 (F-13 규칙 2)
    let prev: { cx: number; cy: number } | null = null;
    for (const point of smoothed) {
      let { cx, cy } = point;
      if (prev) {
        cx = prev.cx + clamp(cx - prev.cx, -maxDeltaPerKeyframe, maxDeltaPerKeyframe);
        cy = prev.cy + clamp(cy - prev.cy, -maxDeltaPerKeyframe, maxDeltaPerKeyframe);
      }
      // 세로는 피사체를 중앙~상단에 두도록 상향 바이어스 (F-13-R3)
      cy = clamp(cy, 0.25, 0.6);
      cx = clamp(cx, 0, 1);
      keyframes.push({ t: round3(point.tOut), cx: round3(cx), cy: round3(cy), zoom: 1 });
      prev = { cx, cy };
    }
    outputOffset += cutLen;
  }
  return keyframes;
}

export function buildReframe(
  analysis: AnalysisDoc,
  cuts: Cut[],
  requested: 'track' | 'pad' | 'auto',
  fps: number,
): Reframe {
  const mode = decideReframeMode(analysis, cuts, requested);
  if (mode !== 'track') {
    return { mode, keyframes: [] };
  }
  return { mode: 'track', keyframes: buildTrackKeyframes(analysis, cuts, fps) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
