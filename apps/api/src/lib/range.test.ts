import { describe, expect, it } from 'vitest';
import { parseRangeHeader } from './range.js';

describe('parseRangeHeader', () => {
  it('returns null without a header', () => {
    expect(parseRangeHeader(undefined, 100)).toBeNull();
  });

  it('parses start-end ranges', () => {
    expect(parseRangeHeader('bytes=0-49', 100)).toEqual({ start: 0, end: 49 });
    expect(parseRangeHeader('bytes=50-', 100)).toEqual({ start: 50, end: 99 });
  });

  it('clamps end to the file size', () => {
    expect(parseRangeHeader('bytes=10-9999', 100)).toEqual({ start: 10, end: 99 });
  });

  it('parses suffix ranges', () => {
    expect(parseRangeHeader('bytes=-30', 100)).toEqual({ start: 70, end: 99 });
    expect(parseRangeHeader('bytes=-200', 100)).toEqual({ start: 0, end: 99 });
  });

  it('flags invalid ranges', () => {
    expect(parseRangeHeader('bytes=100-', 100)).toBe('invalid');
    expect(parseRangeHeader('bytes=5-2', 100)).toBe('invalid');
    expect(parseRangeHeader('bytes=-0', 100)).toBe('invalid');
    expect(parseRangeHeader('bytes=', 100)).toBe('invalid');
    expect(parseRangeHeader('items=0-5', 100)).toBe('invalid');
  });
});
