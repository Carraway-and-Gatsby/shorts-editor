import type { Composition } from '@shorts/shared';
import { describe, expect, it } from 'vitest';
import { buildAssDocument, escapeAssText, formatAssTime } from './ass.js';
import {
  buildConcatList,
  buildCutFilter,
  buildFinalPassArgs,
  cropWindow,
  keyframesForCut,
  piecewiseLinearExpr,
} from './render-plan.js';

function makeComposition(overrides: Partial<Composition> = {}): Composition {
  return {
    version: 1,
    jobId: 'job_1',
    revision: 1,
    output: { width: 1080, height: 1920, fps: 30, duration: 10 },
    cuts: [{ id: 'c1', sourceStart: 0, sourceEnd: 10, transition: 'cut' }],
    reframe: { mode: 'pad', keyframes: [] },
    subtitles: { style: 'clean', blocks: [] },
    audio: { bgm: null, loudnessTarget: -14 },
    style: { preset: 'clean', titleCard: null, lut: null },
    ...overrides,
  };
}

describe('cropWindow', () => {
  it('computes a 9:16 window inside a landscape source', () => {
    const { w, h } = cropWindow({ width: 1920, height: 1080 });
    expect(h).toBe(1080);
    expect(w).toBe(608);
    expect(w % 2).toBe(0);
    expect(w / h).toBeCloseTo(9 / 16, 2);
  });

  it('handles narrow sources', () => {
    const { w, h } = cropWindow({ width: 500, height: 1980 });
    expect(w).toBe(500);
    expect(h).toBeLessThanOrEqual(1980);
  });
});

describe('piecewiseLinearExpr', () => {
  it('returns a constant for a single point', () => {
    expect(piecewiseLinearExpr([{ t: 0, v: 42 }])).toBe('42');
  });

  it('builds nested lerp expressions', () => {
    const expr = piecewiseLinearExpr([
      { t: 0, v: 0 },
      { t: 2, v: 100 },
      { t: 4, v: 100 },
    ]);
    expect(expr).toContain('if(lt(t,2)');
    expect(expr).toContain('if(lt(t,4)');
    expect(expr).toContain('(0+(t-0)*50)');
  });
});

describe('keyframesForCut', () => {
  it('shifts keyframes to cut-relative time', () => {
    const keyframes = [
      { t: 10, cx: 0.5, cy: 0.4, zoom: 1 },
      { t: 11, cx: 0.6, cy: 0.4, zoom: 1 },
      { t: 30, cx: 0.9, cy: 0.4, zoom: 1 },
    ];
    const result = keyframesForCut(keyframes, 10, 5);
    expect(result).toHaveLength(2);
    expect(result[0].t).toBe(0);
    expect(result[1].t).toBe(1);
  });

  it('downsamples long keyframe lists', () => {
    const keyframes = Array.from({ length: 500 }, (_, i) => ({
      t: i * 0.5,
      cx: 0.5,
      cy: 0.4,
      zoom: 1,
    }));
    const result = keyframesForCut(keyframes, 0, 250);
    expect(result.length).toBeLessThanOrEqual(130);
  });
});

describe('buildCutFilter', () => {
  const source = { width: 1920, height: 1080 };

  it('builds a blur-pad graph in pad mode', () => {
    const filter = buildCutFilter({
      composition: makeComposition(),
      cut: { id: 'c1', sourceStart: 0, sourceEnd: 10, transition: 'cut' },
      cutOutputStart: 0,
      source,
    });
    expect(filter).toContain('gblur');
    expect(filter).toContain('overlay');
    expect(filter).toContain('fps=30');
  });

  it('builds a dynamic crop in track mode', () => {
    const composition = makeComposition({
      reframe: {
        mode: 'track',
        keyframes: [
          { t: 0, cx: 0.3, cy: 0.4, zoom: 1 },
          { t: 5, cx: 0.7, cy: 0.4, zoom: 1 },
        ],
      },
    });
    const filter = buildCutFilter({
      composition,
      cut: composition.cuts[0],
      cutOutputStart: 0,
      source,
    });
    expect(filter).toContain('crop=608:1080');
    expect(filter).toContain("x='");
    expect(filter).toContain('if(lt(t,5)');
    expect(filter).toContain('scale=1080:1920');
  });

  it('scales directly in none mode', () => {
    const composition = makeComposition({ reframe: { mode: 'none', keyframes: [] } });
    const filter = buildCutFilter({
      composition,
      cut: composition.cuts[0],
      cutOutputStart: 0,
      source: { width: 1080, height: 1920 },
    });
    expect(filter).toContain('scale=1080:1920');
    expect(filter).not.toContain('gblur');
  });
});

describe('buildFinalPassArgs', () => {
  it('copies video when there are no subtitles', () => {
    const args = buildFinalPassArgs({
      inputPath: 'in.mp4',
      outputPath: 'out.mp4',
      assPath: null,
      hasAudio: true,
      loudnessTarget: -14,
      outputDuration: 30,
    });
    expect(args).toContain('copy');
    expect(args.join(' ')).toContain('loudnorm=I=-14');
    expect(args.join(' ')).toContain('+faststart');
  });

  it('burns subtitles when an ass file is given', () => {
    const args = buildFinalPassArgs({
      inputPath: 'in.mp4',
      outputPath: 'out.mp4',
      assPath: '/tmp/subs.ass',
      hasAudio: false,
      loudnessTarget: -14,
      outputDuration: 30,
    });
    expect(args.join(' ')).toContain('subtitles=/tmp/subs.ass');
    expect(args.join(' ')).not.toContain('loudnorm');
  });

  it('mixes bgm with sidechain ducking when the source has audio', () => {
    const args = buildFinalPassArgs({
      inputPath: 'in.mp4',
      outputPath: 'out.mp4',
      assPath: null,
      hasAudio: true,
      loudnessTarget: -14,
      bgm: { path: '/bgm/calm.m4a', gainDb: -18 },
      outputDuration: 30,
    });
    const joined = args.join(' ');
    expect(joined).toContain('-stream_loop -1');
    expect(joined).toContain('/bgm/calm.m4a');
    expect(joined).toContain('volume=-18dB');
    expect(joined).toContain('sidechaincompress');
    expect(joined).toContain('amix=inputs=2');
    expect(joined).toContain('afade=t=out:st=28.500');
    expect(joined).toContain('loudnorm=I=-14');
  });

  it('uses bgm alone for silent sources', () => {
    const args = buildFinalPassArgs({
      inputPath: 'in.mp4',
      outputPath: 'out.mp4',
      assPath: null,
      hasAudio: false,
      loudnessTarget: -14,
      bgm: { path: '/bgm/calm.m4a', gainDb: -8 },
      outputDuration: 10,
    });
    const joined = args.join(' ');
    expect(joined).toContain('volume=-8dB');
    expect(joined).not.toContain('sidechaincompress');
    expect(joined).toContain('atrim=0:10.000');
    expect(joined).toContain('loudnorm');
  });
});

describe('concat list', () => {
  it('lists files in order', () => {
    expect(buildConcatList(['/a/cut_0.mp4', '/a/cut_1.mp4'])).toBe(
      "file '/a/cut_0.mp4'\nfile '/a/cut_1.mp4'\n",
    );
  });
});

describe('ass generation', () => {
  it('formats times as h:mm:ss.cc', () => {
    expect(formatAssTime(0)).toBe('0:00:00.00');
    expect(formatAssTime(61.5)).toBe('0:01:01.50');
    expect(formatAssTime(3661.239)).toBe('1:01:01.24');
    expect(formatAssTime(1.999)).toBe('0:00:02.00');
  });

  it('escapes override braces and newlines', () => {
    expect(escapeAssText('안녕 {\\b1}세상\n다음줄')).toBe('안녕 \\b1세상\\N다음줄');
  });

  it('builds a document with dialogues and korean font', () => {
    const doc = buildAssDocument(
      [
        { id: 's1', start: 0.4, end: 1.9, text: '안녕하세요!', words: [] },
        { id: 's2', start: 2.0, end: 3.5, text: '숏폼 에디터입니다', words: [] },
      ],
      { preset: 'clean' },
    );
    expect(doc).toContain('PlayResX: 1080');
    expect(doc).toContain('Noto Sans CJK KR');
    expect(doc).toContain('Dialogue: 0,0:00:00.40,0:00:01.90,Default,,0,0,0,,안녕하세요!');
    expect(doc.split('Dialogue:').length - 1).toBe(2);
  });

  it('adds a title card event when the style has one', () => {
    const doc = buildAssDocument([], { preset: 'promo', titleCard: '제품 소개 영상' });
    expect(doc).toContain('Style: TitleCard');
    expect(doc).toContain('TitleCard,,0,0,0,,제품 소개 영상');
  });

  it('renders styles for all four presets', () => {
    for (const preset of ['clean', 'bold', 'vlog', 'promo']) {
      const doc = buildAssDocument(
        [{ id: 's1', start: 0, end: 1, text: 'x', words: [] }],
        { preset },
      );
      expect(doc).toContain('Style: Default');
    }
  });
});
