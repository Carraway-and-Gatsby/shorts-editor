import { JOB_STAGES } from '@shorts/shared';
import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from './names.js';

describe('QUEUE_NAMES', () => {
  it('defines a queue for every pipeline stage', () => {
    for (const stage of JOB_STAGES) {
      expect(QUEUE_NAMES[stage]).toMatch(/^stage-/);
    }
  });

  it('uses unique queue names', () => {
    const names = Object.values(QUEUE_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });
});
