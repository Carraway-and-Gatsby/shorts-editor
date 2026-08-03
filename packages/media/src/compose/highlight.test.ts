import { describe, expect, it } from 'vitest';
import { makeAnalysis, makeShot, makeSpeechSegment } from './fixtures.js';
import { resolveTargetDuration, selectHighlights } from './highlight.js';

describe('resolveTargetDuration', () => {
  it('uses the full source for short videos on auto', () => {
    expect(resolveTargetDuration(15, 'auto')).toBe('full');
    expect(resolveTargetDuration(20, 'auto')).toBe('full');
    expect(resolveTargetDuration(21, 'auto')).toBe(60);
  });

  it('uses full source when shorter than an explicit target', () => {
    expect(resolveTargetDuration(25, 30)).toBe('full');
    expect(resolveTargetDuration(45, 30)).toBe(30);
  });
});

describe('selectHighlights', () => {
  it('returns a single full cut for short sources', () => {
    const analysis = makeAnalysis({
      source: { duration: 18, fps: 30, width: 1920, height: 1080, hasAudio: true },
    });
    const result = selectHighlights(analysis, 'auto');
    expect(result.cuts).toEqual([
      { id: 'c1', sourceStart: 0, sourceEnd: 18, transition: 'cut' },
    ]);
  });

  it('selects high-scoring speech units within the target budget', () => {
    // 발화 3개: 두 개는 에너지 높음, 하나는 무음에 가까움
    const analysis = makeAnalysis({
      source: { duration: 120, fps: 30, width: 1920, height: 1080, hasAudio: true },
      shots: [makeShot(0, 120)],
      transcript: {
        language: 'ko',
        segments: [
          makeSpeechSegment(5, 25, '첫 번째 하이라이트 구간입니다 아주 신나는 내용'),
          makeSpeechSegment(50, 70, '두 번째 하이라이트 구간입니다 역시 신나는 내용'),
          makeSpeechSegment(100, 105, '짧고 조용한 마무리'),
        ],
      },
      energy: Array.from({ length: 240 }, (_, i) => {
        const t = i * 0.5;
        const loud = (t >= 5 && t < 25) || (t >= 50 && t < 70);
        return { t, rms: loud ? 0.5 : 0.05 };
      }),
    });
    const result = selectHighlights(analysis, 'auto');

    // 목표 60초 ±10%
    expect(result.duration).toBeGreaterThanOrEqual(40);
    expect(result.duration).toBeLessThanOrEqual(66);
    // 시간 순서 유지 (F-12-R1)
    for (let i = 1; i < result.cuts.length; i++) {
      expect(result.cuts[i].sourceStart).toBeGreaterThanOrEqual(result.cuts[i - 1].sourceEnd);
    }
    // 에너지 높은 두 구간이 포함됨
    const covers = (t: number) =>
      result.cuts.some((c) => c.sourceStart <= t && t <= c.sourceEnd);
    expect(covers(15)).toBe(true);
    expect(covers(60)).toBe(true);
  });

  it('falls back to shot candidates without a transcript (UC-3)', () => {
    const analysis = makeAnalysis({
      source: { duration: 90, fps: 30, width: 1920, height: 1080, hasAudio: false },
      shots: [
        makeShot(0, 30, { motion: 0.9, quality: 0.9 }),
        makeShot(30, 60, { motion: 0.1, darkness: 0.8 }),
        makeShot(60, 90, { motion: 0.8, quality: 0.85 }),
      ],
      transcript: null,
    });
    const result = selectHighlights(analysis, 'auto');
    expect(result.cuts.length).toBeGreaterThan(0);
    expect(result.duration).toBeLessThanOrEqual(66);
    // 어두운 중간 샷보다 모션 높은 샷들이 우선 선택된다
    const covered = result.cuts.reduce((sum, c) => {
      const inDark = Math.max(0, Math.min(c.sourceEnd, 60) - Math.max(c.sourceStart, 30));
      return sum + inDark;
    }, 0);
    const total = result.duration;
    expect(covered / total).toBeLessThan(0.5);
  });

  it('falls back to leading segment when analysis is empty', () => {
    const analysis = makeAnalysis({
      source: { duration: 300, fps: 30, width: 1920, height: 1080, hasAudio: false },
      shots: [],
      transcript: null,
    });
    const result = selectHighlights(analysis, 'auto');
    expect(result.cuts).toEqual([
      { id: 'c1', sourceStart: 0, sourceEnd: 60, transition: 'cut' },
    ]);
  });

  it('merges adjacent selected segments', () => {
    const analysis = makeAnalysis({
      source: { duration: 100, fps: 30, width: 1920, height: 1080, hasAudio: true },
      transcript: {
        language: 'ko',
        segments: [
          makeSpeechSegment(10, 20, '앞 문장 하나입니다 재밌어요'),
          makeSpeechSegment(20.5, 30, '바로 이어지는 문장입니다'),
        ],
      },
      energy: [{ t: 15, rms: 0.5 }],
    });
    const result = selectHighlights(analysis, 'auto');
    // 0.5초 간격 두 발화 단위는 한 컷으로 병합된다
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0].sourceStart).toBeLessThan(10);
    expect(result.cuts[0].sourceEnd).toBeGreaterThan(29);
  });

  it('honors explicit target durations', () => {
    const analysis = makeAnalysis({
      source: { duration: 200, fps: 30, width: 1920, height: 1080, hasAudio: true },
      transcript: {
        language: 'ko',
        segments: [
          makeSpeechSegment(0, 40, '긴 발화 구간 하나'),
          makeSpeechSegment(60, 100, '긴 발화 구간 둘'),
          makeSpeechSegment(120, 160, '긴 발화 구간 셋'),
        ],
      },
    });
    const result = selectHighlights(analysis, 30);
    expect(result.duration).toBeLessThanOrEqual(33);
  });
});
