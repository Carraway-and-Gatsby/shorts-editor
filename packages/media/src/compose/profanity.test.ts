import { describe, expect, it } from 'vitest';
import { maskProfanity, maskSubtitleBlocks, parseBannedWords } from './profanity.js';

const WORDS = ['시발', 'fuck'];

describe('maskProfanity', () => {
  it('masks korean words as substrings', () => {
    expect(maskProfanity('아 시발 진짜', WORDS)).toBe('아 시* 진짜');
    expect(maskProfanity('시발같은', WORDS)).toBe('시*같은');
  });

  it('masks latin words at word boundaries only, case-insensitive', () => {
    expect(maskProfanity('what the Fuck man', WORDS)).toBe('what the F*** man');
    expect(maskProfanity('fucktastic', WORDS)).toBe('fucktastic');
  });

  it('leaves clean text untouched', () => {
    expect(maskProfanity('안녕하세요 좋은 영상입니다', WORDS)).toBe('안녕하세요 좋은 영상입니다');
  });
});

describe('maskSubtitleBlocks', () => {
  it('masks block and word texts', () => {
    const blocks = [
      {
        id: 's1',
        start: 0,
        end: 1,
        text: '아 시발 진짜',
        words: [{ start: 0, end: 0.5, text: '시발' }],
      },
    ];
    const masked = maskSubtitleBlocks(blocks, WORDS);
    expect(masked[0].text).toBe('아 시* 진짜');
    expect(masked[0].words[0].text).toBe('시*');
  });

  it('is a no-op with an empty wordlist', () => {
    const blocks = [{ id: 's1', start: 0, end: 1, text: '시발', words: [] }];
    expect(maskSubtitleBlocks(blocks, [])).toBe(blocks);
  });
});

describe('parseBannedWords', () => {
  it('parses the config format', () => {
    expect(parseBannedWords('{"words":["a","b",""]}')).toEqual(['a', 'b']);
    expect(parseBannedWords('not json')).toEqual([]);
    expect(parseBannedWords('{}')).toEqual([]);
  });
});
