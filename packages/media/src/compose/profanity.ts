/**
 * 금칙어 마스킹 (F-14-R3). 기본 off, 옵션으로 활성화.
 * 한글은 부분 문자열, 라틴 문자는 단어 경계 기준으로 매칭한다.
 */

import type { SubtitleBlock } from '@shorts/shared';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskWord(word: string): string {
  // 1글자 금칙어는 첫 글자를 남기면 원문이 그대로 노출되므로 전체를 가린다
  if (word.length <= 1) {
    return '*';
  }
  return word[0] + '*'.repeat(word.length - 1);
}

export function maskProfanity(text: string, bannedWords: string[]): string {
  let masked = text;
  for (const word of bannedWords) {
    if (!word) {
      continue;
    }
    const isLatin = /^[a-zA-Z]+$/.test(word);
    const pattern = isLatin
      ? new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi')
      : new RegExp(escapeRegExp(word), 'g');
    masked = masked.replace(pattern, (match) => maskWord(match));
  }
  return masked;
}

export function maskSubtitleBlocks(
  blocks: SubtitleBlock[],
  bannedWords: string[],
): SubtitleBlock[] {
  if (bannedWords.length === 0) {
    return blocks;
  }
  return blocks.map((block) => ({
    ...block,
    text: maskProfanity(block.text, bannedWords),
    words: block.words.map((w) => ({ ...w, text: maskProfanity(w.text, bannedWords) })),
  }));
}

/** config/banned-words.json 형식 로더 (파일 읽기는 호출부 책임) */
export function parseBannedWords(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as { words?: unknown };
    if (Array.isArray(parsed.words)) {
      return parsed.words.filter((w): w is string => typeof w === 'string' && w.length > 0);
    }
  } catch {
    // fall through
  }
  return [];
}
