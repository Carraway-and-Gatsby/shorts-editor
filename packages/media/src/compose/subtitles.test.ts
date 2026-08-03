import type { Cut, Transcript } from '@shorts/shared';
import { describe, expect, it } from 'vitest';
import { makeSpeechSegment } from './fixtures.js';
import { buildSubtitles, groupWordsIntoBlocks, remapWordsToOutput } from './subtitles.js';

describe('remapWordsToOutput', () => {
  const transcript: Transcript = {
    language: 'ko',
    segments: [
      makeSpeechSegment(10, 12, '안녕하세요 여러분'),
      makeSpeechSegment(50, 52, '중간 인사 입니다'),
      makeSpeechSegment(90, 92, '마지막 인사'),
    ],
  };

  it('maps words inside cuts to the output timeline and drops the rest', () => {
    const cuts: Cut[] = [
      { id: 'c1', sourceStart: 9, sourceEnd: 14, transition: 'cut' },
      { id: 'c2', sourceStart: 89, sourceEnd: 94, transition: 'cut' },
    ];
    const words = remapWordsToOutput(transcript, cuts);
    // 50~52초 발화는 컷에 없으므로 제외 (F-14-R2)
    expect(words.map((w) => w.text)).toEqual(['안녕하세요', '여러분', '마지막', '인사']);
    // 첫 컷: 원본 10초 → 출력 1초
    expect(words[0].start).toBeCloseTo(1, 2);
    // 둘째 컷: 원본 90초 → 출력 5 + 1 = 6초
    expect(words[2].start).toBeCloseTo(6, 2);
  });
});

describe('groupWordsIntoBlocks', () => {
  it('splits blocks at the word/char limits', () => {
    const words = Array.from({ length: 12 }, (_, i) => ({
      start: i * 0.4,
      end: i * 0.4 + 0.35,
      text: `단어${i}`,
    }));
    const blocks = groupWordsIntoBlocks(words, 'clean');
    expect(blocks.length).toBeGreaterThan(2);
    for (const block of blocks) {
      expect(block.words.length).toBeLessThanOrEqual(5);
      expect(block.text.length).toBeLessThanOrEqual(14 + 2);
      expect(block.end - block.start).toBeLessThanOrEqual(3.0 + 1e-9);
    }
  });

  it('does not produce overlapping blocks', () => {
    const words = Array.from({ length: 20 }, (_, i) => ({
      start: i * 0.2,
      end: i * 0.2 + 0.18,
      text: '가',
    }));
    const blocks = groupWordsIntoBlocks(words, 'clean');
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].start).toBeGreaterThanOrEqual(blocks[i - 1].end - 1e-9);
    }
  });

  it('splits on long gaps between words', () => {
    const words = [
      { start: 0, end: 0.5, text: '앞' },
      { start: 5, end: 5.5, text: '뒤' },
    ];
    const blocks = groupWordsIntoBlocks(words, 'clean');
    expect(blocks).toHaveLength(2);
  });
});

describe('buildSubtitles', () => {
  const cuts: Cut[] = [{ id: 'c1', sourceStart: 0, sourceEnd: 10, transition: 'cut' }];

  it('returns empty blocks when disabled or without transcript', () => {
    expect(buildSubtitles(null, cuts, 'clean', true).blocks).toEqual([]);
    const transcript: Transcript = {
      language: 'ko',
      segments: [makeSpeechSegment(1, 3, '자막 내용')],
    };
    expect(buildSubtitles(transcript, cuts, 'clean', false).blocks).toEqual([]);
  });

  it('builds styled blocks when enabled', () => {
    const transcript: Transcript = {
      language: 'ko',
      segments: [makeSpeechSegment(1, 3, '자막 내용 테스트')],
    };
    const result = buildSubtitles(transcript, cuts, 'bold', true);
    expect(result.style).toBe('bold');
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks[0].text).toContain('자막');
  });
});
