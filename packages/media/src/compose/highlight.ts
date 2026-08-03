/**
 * 하이라이트 추출 (F-12, docs/03-functional-spec.md).
 * 발화 단위(있으면) 또는 샷을 후보 세그먼트로 삼아 점수 상위를
 * 시간 순서를 유지한 채 목표 길이 ±10%로 채운다.
 */

import type { AnalysisDoc, Cut } from '@shorts/shared';
import { scoreSegment, type CandidateSegment, type ScoringConfig } from './scoring.js';

/** 문장 경계 스냅 허용 오차 (F-12-R3) */
const SNAP_PADDING = 0.15;
/** 이 간격 미만으로 인접한 채택 세그먼트는 병합 (F-12 규칙 3) */
const MERGE_GAP = 1.5;
/** 후보 최소 길이 */
const MIN_SEGMENT = 1.5;
/** 발화 단위를 나누는 무음 기준 */
const SPEECH_GAP = 0.8;

export interface HighlightResult {
  cuts: Cut[];
  /** 출력 총 길이(초) */
  duration: number;
}

/** 발화 세그먼트를 무음/간격 기준으로 발화 단위(문장 묶음)로 그룹화한다. */
export function buildSpeechCandidates(analysis: AnalysisDoc): CandidateSegment[] {
  const transcript = analysis.transcript;
  if (!transcript || transcript.segments.length === 0) {
    return [];
  }
  const candidates: CandidateSegment[] = [];
  let current: { start: number; end: number } | null = null;
  for (const segment of transcript.segments) {
    if (current && segment.start - current.end < SPEECH_GAP) {
      current.end = segment.end;
    } else {
      if (current) {
        candidates.push({ ...current, fromSpeech: true });
      }
      current = { start: segment.start, end: segment.end };
    }
  }
  if (current) {
    candidates.push({ ...current, fromSpeech: true });
  }
  // 문장 중간에서 자르지 않도록 경계에 여유를 두고 원본 범위로 클램프
  return candidates.map((c) => ({
    start: Math.max(0, c.start - SNAP_PADDING),
    end: Math.min(analysis.source.duration, c.end + SNAP_PADDING),
    fromSpeech: true,
  }));
}

/** 발화가 없을 때의 후보: 샷 경계 (긴 샷은 분할) */
export function buildShotCandidates(analysis: AnalysisDoc, targetSeconds: number): CandidateSegment[] {
  const maxLen = Math.max(MIN_SEGMENT * 2, targetSeconds / 3);
  const candidates: CandidateSegment[] = [];
  for (const shot of analysis.shots) {
    let start = shot.start;
    while (shot.end - start > maxLen * 1.5) {
      candidates.push({ start, end: start + maxLen, fromSpeech: false });
      start += maxLen;
    }
    if (shot.end - start >= MIN_SEGMENT) {
      candidates.push({ start, end: shot.end, fromSpeech: false });
    }
  }
  return candidates;
}

/**
 * 목표 길이 결정 (F-12 규칙 1):
 * auto → 원본 ≤20초는 전체, 그 외 60초.
 */
export function resolveTargetDuration(
  sourceDuration: number,
  targetDuration: 15 | 30 | 60 | 90 | 'auto',
): number | 'full' {
  if (targetDuration === 'auto') {
    return sourceDuration <= 20 ? 'full' : 60;
  }
  return sourceDuration <= targetDuration ? 'full' : targetDuration;
}

export function selectHighlights(
  analysis: AnalysisDoc,
  targetDuration: 15 | 30 | 60 | 90 | 'auto',
  config?: ScoringConfig,
): HighlightResult {
  const sourceDuration = analysis.source.duration;
  const target = resolveTargetDuration(sourceDuration, targetDuration);
  if (target === 'full') {
    return {
      cuts: [{ id: 'c1', sourceStart: 0, sourceEnd: sourceDuration, transition: 'cut' }],
      duration: sourceDuration,
    };
  }

  let candidates = buildSpeechCandidates(analysis);
  if (candidates.length === 0) {
    candidates = buildShotCandidates(analysis, target);
  }
  if (candidates.length === 0) {
    // 분석이 비어 있으면 시작부터 목표 길이 (기본 컴포지션과 동일한 동작)
    const end = Math.min(sourceDuration, target);
    return {
      cuts: [{ id: 'c1', sourceStart: 0, sourceEnd: end, transition: 'cut' }],
      duration: end,
    };
  }

  const scored = candidates
    .filter((c) => c.end - c.start >= MIN_SEGMENT)
    .map((segment) => ({ segment, score: scoreSegment(analysis, segment, config) }))
    .sort((a, b) => b.score - a.score);

  // 점수 순 그리디 채택 (목표의 110%까지)
  const budget = target * 1.1;
  const chosen: CandidateSegment[] = [];
  const taken = new Set<CandidateSegment>();
  let total = 0;
  for (const { segment } of scored) {
    const len = segment.end - segment.start;
    if (total + len <= budget) {
      chosen.push(segment);
      taken.add(segment);
      total += len;
    }
  }
  if (chosen.length === 0 && scored.length > 0) {
    // 모든 후보가 예산보다 큼 → 최고 점수 후보를 잘라서 사용
    const best = scored[0].segment;
    taken.add(best);
    chosen.push({ ...best, end: Math.min(best.end, best.start + target) });
    total = chosen[0].end - chosen[0].start;
  }

  // 목표 미달이면 남은 후보를 잘라서 채운다 (F-12-R2: ±10%)
  if (total < target * 0.9) {
    const overlapsChosen = (segment: CandidateSegment) =>
      chosen.some(
        (c) => Math.min(c.end, segment.end) - Math.max(c.start, segment.start) > 0,
      );
    for (const { segment } of scored) {
      if (total >= target * 0.9) {
        break;
      }
      const remaining = target - total;
      if (remaining < MIN_SEGMENT) {
        break;
      }
      if (taken.has(segment) || overlapsChosen(segment)) {
        continue;
      }
      const len = Math.min(segment.end - segment.start, remaining);
      if (len < MIN_SEGMENT) {
        continue;
      }
      taken.add(segment);
      chosen.push({ ...segment, end: segment.start + len });
      total += len;
    }
  }

  // 시간 순 정렬 후 인접 병합 (F-12-R1)
  chosen.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const segment of chosen) {
    const last = merged[merged.length - 1];
    if (last && segment.start - last.end < MERGE_GAP) {
      last.end = Math.max(last.end, segment.end);
    } else {
      merged.push({ start: segment.start, end: segment.end });
    }
  }

  // 목표 초과분은 마지막 세그먼트부터 트리밍 (F-12-R2: ±10%)
  let duration = merged.reduce((sum, s) => sum + s.end - s.start, 0);
  while (duration > target * 1.1 && merged.length > 0) {
    const last = merged[merged.length - 1];
    const excess = duration - target;
    const lastLen = last.end - last.start;
    if (lastLen - excess >= MIN_SEGMENT) {
      last.end -= excess;
      duration -= excess;
    } else {
      merged.pop();
      duration -= lastLen;
    }
  }

  const cuts: Cut[] = merged.map((s, i) => ({
    id: `c${i + 1}`,
    sourceStart: round3(s.start),
    sourceEnd: round3(s.end),
    transition: 'cut',
  }));
  return { cuts, duration: round3(duration) };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
