import type { Composition, Transcript } from '@shorts/shared';
import { describe, expect, it } from 'vitest';
import { applyCompositionPatch } from './edit.js';
import { makeSpeechSegment } from './fixtures.js';

function baseComposition(): Composition {
  return {
    version: 1,
    jobId: 'job_1',
    revision: 1,
    output: { width: 1080, height: 1920, fps: 30, duration: 20 },
    cuts: [{ id: 'c1', sourceStart: 10, sourceEnd: 30, transition: 'cut' }],
    reframe: { mode: 'pad', keyframes: [] },
    subtitles: {
      style: 'clean',
      blocks: [
        { id: 's1', start: 1, end: 2.5, text: '원본 자막', words: [] },
        { id: 's2', start: 3, end: 4.5, text: '두 번째 자막', words: [] },
      ],
    },
    audio: { bgm: null, loudnessTarget: -14 },
    style: { preset: 'clean', titleCard: null, lut: null },
  };
}

describe('applyCompositionPatch', () => {
  it('replaces subtitle text and records corrections', () => {
    const result = applyCompositionPatch(
      baseComposition(),
      {
        subtitles: {
          blocks: [
            { id: 's1', start: 1, end: 2.5, text: '수정된 자막', words: [] },
            { id: 's2', start: 3, end: 4.5, text: '두 번째 자막', words: [] },
          ],
        },
      },
      null,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.composition.subtitles.blocks[0].text).toBe('수정된 자막');
      expect(result.corrections).toEqual([
        { blockId: 's1', originalText: '원본 자막', correctedText: '수정된 자막' },
      ]);
    }
  });

  it('updates cuts, recomputes duration, and remaps subtitles from transcript', () => {
    const transcript: Transcript = {
      language: 'ko',
      segments: [makeSpeechSegment(41, 43, '뒤쪽 구간 자막')],
    };
    const result = applyCompositionPatch(
      baseComposition(),
      { cuts: [{ id: 'c1', sourceStart: 40, sourceEnd: 50, transition: 'cut' }] },
      transcript,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.composition.output.duration).toBe(10);
      // 원본 41~43초 발화 → 출력 1~3초로 리매핑
      expect(result.composition.subtitles.blocks.length).toBeGreaterThan(0);
      expect(result.composition.subtitles.blocks[0].start).toBeCloseTo(1, 1);
    }
  });

  it('rejects cuts exceeding the 90s cap', () => {
    const result = applyCompositionPatch(
      baseComposition(),
      { cuts: [{ id: 'c1', sourceStart: 0, sourceEnd: 120, transition: 'cut' }] },
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('exceeds');
    }
  });

  it('rejects overlapping cuts and malformed payloads', () => {
    expect(
      applyCompositionPatch(
        baseComposition(),
        {
          cuts: [
            { id: 'c1', sourceStart: 0, sourceEnd: 20, transition: 'cut' },
            { id: 'c2', sourceStart: 10, sourceEnd: 25, transition: 'cut' },
          ],
        },
        null,
      ).ok,
    ).toBe(false);
    expect(applyCompositionPatch(baseComposition(), { cuts: [] }, null).ok).toBe(false);
    expect(
      applyCompositionPatch(baseComposition(), { cuts: [{ sourceStart: 'x' }] }, null).ok,
    ).toBe(false);
    expect(
      applyCompositionPatch(baseComposition(), { subtitles: { blocks: [{ id: 's1' }] } }, null).ok,
    ).toBe(false);
  });

  it('keeps existing blocks when cuts change without a transcript', () => {
    const result = applyCompositionPatch(
      baseComposition(),
      { cuts: [{ id: 'c1', sourceStart: 10, sourceEnd: 25, transition: 'cut' }] },
      null,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.composition.subtitles.blocks).toHaveLength(2);
      expect(result.composition.output.duration).toBe(15);
    }
  });
});
