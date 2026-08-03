import { describe, expect, it } from 'vitest';
import { buildDefaultComposition } from './default-composition.js';
import { validateComposition } from './validate.js';

describe('buildDefaultComposition', () => {
  it('uses the full source when shorter than the target', () => {
    const c = buildDefaultComposition({ jobId: 'job_1', revision: 1, sourceDuration: 14.5 });
    expect(c.cuts).toEqual([{ id: 'c1', sourceStart: 0, sourceEnd: 14.5, transition: 'cut' }]);
    expect(c.output.duration).toBe(14.5);
  });

  it('caps at 60 seconds by default', () => {
    const c = buildDefaultComposition({ jobId: 'job_1', revision: 1, sourceDuration: 300 });
    expect(c.output.duration).toBe(60);
    expect(c.cuts[0].sourceEnd).toBe(60);
  });

  it('honors an explicit target duration', () => {
    const c = buildDefaultComposition({
      jobId: 'job_1',
      revision: 1,
      sourceDuration: 300,
      targetDuration: 30,
    });
    expect(c.output.duration).toBe(30);
  });

  it('keeps source fps when below 30', () => {
    const c = buildDefaultComposition({
      jobId: 'job_1',
      revision: 1,
      sourceDuration: 10,
      sourceFps: 24,
    });
    expect(c.output.fps).toBe(24);
  });

  it('caps fps at 30', () => {
    const c = buildDefaultComposition({
      jobId: 'job_1',
      revision: 1,
      sourceDuration: 10,
      sourceFps: 60,
    });
    expect(c.output.fps).toBe(30);
  });

  it('produces a composition that passes validation', () => {
    for (const sourceDuration of [3, 20, 59.9, 60, 61, 600]) {
      const c = buildDefaultComposition({ jobId: 'job_1', revision: 1, sourceDuration });
      const result = validateComposition(c);
      expect(result.errors).toEqual([]);
    }
  });
});
