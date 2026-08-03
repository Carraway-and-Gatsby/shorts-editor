import type { Composition, Transcript } from '@shorts/shared';
import { describe, expect, it } from 'vitest';
import { applyCompositionPatch } from './edit.js';
import { makeAnalysis, makeSpeechSegment } from './fixtures.js';

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
      { analysis: null },
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
      { analysis: makeAnalysis({ transcript }) },
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
      { analysis: null },
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
        { analysis: null },
      ).ok,
    ).toBe(false);
    expect(applyCompositionPatch(baseComposition(), { cuts: [] }, { analysis: null }).ok).toBe(false);
    expect(
      applyCompositionPatch(baseComposition(), { cuts: [{ sourceStart: 'x' }] }, { analysis: null }).ok,
    ).toBe(false);
    expect(
      applyCompositionPatch(baseComposition(), { subtitles: { blocks: [{ id: 's1' }] } }, { analysis: null }).ok,
    ).toBe(false);
  });

  it('keeps existing blocks when cuts change without a transcript', () => {
    const result = applyCompositionPatch(
      baseComposition(),
      { cuts: [{ id: 'c1', sourceStart: 10, sourceEnd: 25, transition: 'cut' }] },
      { analysis: null },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.composition.subtitles.blocks).toHaveLength(2);
      expect(result.composition.output.duration).toBe(15);
    }
  });
});

describe('applyCompositionPatch — style swap (F-23)', () => {
  const CATALOG = [
    {
      id: 'bgm_calm_01',
      name: 'Calm',
      moods: ['calm'],
      durationSeconds: 24,
      file: 'a.m4a',
      licenseNote: 'CC0',
    },
    {
      id: 'bgm_energetic_01',
      name: 'Energetic',
      moods: ['energetic'],
      durationSeconds: 24,
      file: 'b.m4a',
      licenseNote: 'CC0',
    },
  ];

  it('swaps the preset and re-evaluates the title card', () => {
    const analysis = makeAnalysis({
      transcript: { language: 'ko', segments: [makeSpeechSegment(0, 3, '제품 소개 영상입니다')] },
    });
    const result = applyCompositionPatch(
      baseComposition(),
      { style: { preset: 'promo' } },
      { analysis },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.composition.style.preset).toBe('promo');
      expect(result.composition.subtitles.style).toBe('promo');
      // promo는 타이틀 카드 사용 → STT 첫 문장 파생
      expect(result.composition.style.titleCard).toContain('제품 소개');
    }
    // clean으로 되돌리면 타이틀 카드 제거
    if (result.ok) {
      const back = applyCompositionPatch(
        result.composition,
        { style: { preset: 'clean' } },
        { analysis },
      );
      expect(back.ok).toBe(true);
      if (back.ok) {
        expect(back.composition.style.titleCard).toBeNull();
      }
    }
  });

  it('rejects unknown presets', () => {
    const result = applyCompositionPatch(
      baseComposition(),
      { style: { preset: 'nonexistent' } },
      { analysis: null },
    );
    expect(result.ok).toBe(false);
  });

  it('swaps bgm on/off/track', () => {
    const off = applyCompositionPatch(
      baseComposition(),
      { audio: { bgm: 'off' } },
      { analysis: null, bgmCatalog: CATALOG, hasAudio: true },
    );
    expect(off.ok && off.composition.audio.bgm === null).toBe(true);

    const explicit = applyCompositionPatch(
      baseComposition(),
      { audio: { bgm: 'bgm_energetic_01' } },
      { analysis: null, bgmCatalog: CATALOG, hasAudio: true },
    );
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.composition.audio.bgm?.trackId).toBe('bgm_energetic_01');
      expect(explicit.composition.audio.bgm?.gainDb).toBe(-18);
    }

    const auto = applyCompositionPatch(
      baseComposition(),
      { audio: { bgm: 'auto' } },
      { analysis: null, bgmCatalog: CATALOG, hasAudio: false },
    );
    expect(auto.ok).toBe(true);
    if (auto.ok) {
      // clean 프리셋 무드 calm → calm 트랙, 무음이므로 -8dB
      expect(auto.composition.audio.bgm?.trackId).toBe('bgm_calm_01');
      expect(auto.composition.audio.bgm?.gainDb).toBe(-8);
    }

    const unknown = applyCompositionPatch(
      baseComposition(),
      { audio: { bgm: 'bgm_missing' } },
      { analysis: null, bgmCatalog: CATALOG },
    );
    expect(unknown.ok).toBe(false);
  });
});
