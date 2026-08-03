import { describe, expect, it } from 'vitest';
import type { Composition } from './composition.js';
import { canTransition, JOB_STAGES, STAGE_PROGRESS_WEIGHTS } from './job.js';
import { MAX_OUTPUT_DURATION_SECONDS, validateComposition } from './validate.js';

function sampleComposition(): Composition {
  return {
    version: 1,
    jobId: 'job_abc123',
    revision: 1,
    output: { width: 1080, height: 1920, fps: 30, duration: 58.7 },
    cuts: [
      { id: 'c1', sourceStart: 12.4, sourceEnd: 31.1, transition: 'cut' },
      { id: 'c2', sourceStart: 45.0, sourceEnd: 70.0, transition: 'cut' },
    ],
    reframe: {
      mode: 'track',
      keyframes: [{ t: 0, cx: 0.42, cy: 0.37, zoom: 1.0 }],
    },
    subtitles: {
      style: 'bold',
      blocks: [{ id: 's1', start: 0.4, end: 1.9, text: '안녕하세요!', words: [] }],
    },
    audio: {
      bgm: { trackId: 'bgm_calm_01', gainDb: -18, duckDb: -24 },
      loudnessTarget: -14,
    },
    style: { preset: 'clean', titleCard: null, lut: null },
  };
}

describe('validateComposition', () => {
  it('accepts a valid composition', () => {
    const result = validateComposition(sampleComposition());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a composition without bgm', () => {
    const composition = sampleComposition();
    composition.audio.bgm = null;
    expect(validateComposition(composition).valid).toBe(true);
  });

  it('rejects a document missing required fields', () => {
    const { cuts: _cuts, ...withoutCuts } = sampleComposition();
    const result = validateComposition(withoutCuts);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects overlapping cuts', () => {
    const composition = sampleComposition();
    composition.cuts = [
      { id: 'c1', sourceStart: 10, sourceEnd: 30, transition: 'cut' },
      { id: 'c2', sourceStart: 25, sourceEnd: 40, transition: 'cut' },
    ];
    const result = validateComposition(composition);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('ascending');
  });

  it('rejects a cut with end before start', () => {
    const composition = sampleComposition();
    composition.cuts = [{ id: 'c1', sourceStart: 30, sourceEnd: 10, transition: 'cut' }];
    const result = validateComposition(composition);
    expect(result.valid).toBe(false);
  });

  it(`rejects total duration over ${MAX_OUTPUT_DURATION_SECONDS}s`, () => {
    const composition = sampleComposition();
    composition.cuts = [{ id: 'c1', sourceStart: 0, sourceEnd: 120, transition: 'cut' }];
    const result = validateComposition(composition);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('exceeds');
  });

  it('rejects subtitle blocks with invalid time range', () => {
    const composition = sampleComposition();
    composition.subtitles.blocks = [{ id: 's1', start: 5, end: 5, text: 'x', words: [] }];
    expect(validateComposition(composition).valid).toBe(false);
  });
});

describe('job state machine', () => {
  it('follows the happy path', () => {
    expect(canTransition('UPLOADING', 'QUEUED')).toBe(true);
    expect(canTransition('QUEUED', 'ANALYZING')).toBe(true);
    expect(canTransition('ANALYZING', 'COMPOSING')).toBe(true);
    expect(canTransition('COMPOSING', 'RENDERING')).toBe(true);
    expect(canTransition('RENDERING', 'DONE')).toBe(true);
  });

  it('allows re-render as the only backward transition', () => {
    expect(canTransition('DONE', 'RENDERING')).toBe(true);
    expect(canTransition('DONE', 'ANALYZING')).toBe(false);
  });

  it('treats FAILED and CANCELED as terminal', () => {
    expect(canTransition('FAILED', 'QUEUED')).toBe(false);
    expect(canTransition('CANCELED', 'QUEUED')).toBe(false);
  });

  it('does not allow skipping stages', () => {
    expect(canTransition('QUEUED', 'RENDERING')).toBe(false);
    expect(canTransition('ANALYZING', 'DONE')).toBe(false);
  });
});

describe('stage progress weights', () => {
  it('covers every stage and sums to 100', () => {
    const total = JOB_STAGES.reduce((sum, stage) => sum + STAGE_PROGRESS_WEIGHTS[stage], 0);
    expect(total).toBe(100);
  });
});
