/**
 * 자동 자막 블록 생성 (F-14).
 * STT 단어 타임스탬프를 컷 편집 후의 출력 시간축으로 리매핑하고
 * 숏폼 스타일 블록(1~5단어, 0.5~3.0초)으로 그룹화한다.
 */

import type { Cut, SubtitleBlock, Transcript, TranscriptWord } from '@shorts/shared';

const MAX_WORDS_PER_BLOCK = 5;
const MAX_CHARS_PER_BLOCK = 14;
const MIN_BLOCK_SECONDS = 0.5;
const MAX_BLOCK_SECONDS = 3.0;

interface MappedWord {
  /** 출력 시간축 */
  start: number;
  end: number;
  text: string;
}

/**
 * 컷에 포함된 단어만 출력 시간축으로 리매핑한다 (F-14-R2).
 * 컷 경계에 걸친 단어는 절반 이상 포함될 때만 채택한다.
 */
export function remapWordsToOutput(transcript: Transcript, cuts: Cut[]): MappedWord[] {
  const words: TranscriptWord[] = transcript.segments.flatMap((s) => s.words);
  const mapped: MappedWord[] = [];
  let outputOffset = 0;
  for (const cut of cuts) {
    const cutLen = cut.sourceEnd - cut.sourceStart;
    for (const word of words) {
      const mid = (word.start + word.end) / 2;
      if (mid < cut.sourceStart || mid >= cut.sourceEnd) {
        continue;
      }
      const start = Math.max(word.start, cut.sourceStart) - cut.sourceStart + outputOffset;
      const end = Math.min(word.end, cut.sourceEnd) - cut.sourceStart + outputOffset;
      if (end > start && word.text.trim().length > 0) {
        mapped.push({ start: round3(start), end: round3(end), text: word.text.trim() });
      }
    }
    outputOffset += cutLen;
  }
  return mapped.sort((a, b) => a.start - b.start);
}

/** 단어들을 숏폼 스타일 블록으로 그룹화한다. */
export function groupWordsIntoBlocks(words: MappedWord[], _style: string): SubtitleBlock[] {
  const blocks: SubtitleBlock[] = [];
  let current: MappedWord[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const start = current[0].start;
    let end = Math.max(current[current.length - 1].end, start + MIN_BLOCK_SECONDS);
    end = Math.min(end, start + MAX_BLOCK_SECONDS);
    blocks.push({
      id: `s${blocks.length + 1}`,
      start: round3(start),
      end: round3(end),
      text: current.map((w) => w.text).join(' '),
      words: current.map((w) => ({ start: w.start, end: w.end, text: w.text })),
    });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0) {
      const chars = current.reduce((n, w) => n + w.text.length, 0) + current.length - 1;
      const blockStart = current[0].start;
      const wouldExceed =
        current.length >= MAX_WORDS_PER_BLOCK ||
        chars + 1 + word.text.length > MAX_CHARS_PER_BLOCK ||
        word.end - blockStart > MAX_BLOCK_SECONDS ||
        word.start - current[current.length - 1].end > 1.0;
      if (wouldExceed) {
        flush();
      }
    }
    current.push(word);
  }
  flush();

  // 겹침 제거: 다음 블록 시작보다 늦게 끝나지 않도록
  for (let i = 0; i < blocks.length - 1; i++) {
    if (blocks[i].end > blocks[i + 1].start) {
      blocks[i] = { ...blocks[i], end: round3(blocks[i + 1].start) };
    }
  }
  return blocks.filter((b) => b.end > b.start);
}

export function buildSubtitles(
  transcript: Transcript | null,
  cuts: Cut[],
  style: string,
  enabled: boolean,
): { style: string; blocks: SubtitleBlock[] } {
  if (!enabled || !transcript) {
    return { style, blocks: [] };
  }
  const words = remapWordsToOutput(transcript, cuts);
  return { style, blocks: groupWordsIntoBlocks(words, style) };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
