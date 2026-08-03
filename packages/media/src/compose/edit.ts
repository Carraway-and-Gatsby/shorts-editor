/**
 * 컴포지션 보정 (F-21/F-22).
 * PATCH 페이로드를 현재 컴포지션에 병합하고 의미 규칙을 검증한다.
 * 컷이 바뀌면 자막을 분석 transcript로부터 자동 리매핑한다 (F-21 규칙).
 */

import {
  validateComposition,
  type Composition,
  type Cut,
  type SubtitleBlock,
  type Transcript,
} from '@shorts/shared';
import { buildSubtitles } from './subtitles.js';

export interface CompositionPatchInput {
  cuts?: unknown;
  subtitles?: { blocks?: unknown };
}

export interface SubtitleCorrection {
  blockId: string;
  originalText: string;
  correctedText: string;
}

export type ApplyPatchResult =
  | { ok: true; composition: Composition; corrections: SubtitleCorrection[] }
  | { ok: false; errors: string[] };

function parseCuts(input: unknown): Cut[] | { error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: 'cuts는 비어 있지 않은 배열이어야 합니다.' };
  }
  const cuts: Cut[] = [];
  for (const [i, raw] of input.entries()) {
    const cut = raw as Record<string, unknown>;
    if (typeof cut.sourceStart !== 'number' || typeof cut.sourceEnd !== 'number') {
      return { error: `cuts[${i}]: sourceStart/sourceEnd는 숫자여야 합니다.` };
    }
    cuts.push({
      id: typeof cut.id === 'string' && cut.id ? cut.id : `c${i + 1}`,
      sourceStart: cut.sourceStart,
      sourceEnd: cut.sourceEnd,
      transition: cut.transition === 'crossfade' ? 'crossfade' : 'cut',
    });
  }
  return cuts;
}

function parseBlocks(input: unknown): SubtitleBlock[] | { error: string } {
  if (!Array.isArray(input)) {
    return { error: 'subtitles.blocks는 배열이어야 합니다.' };
  }
  const blocks: SubtitleBlock[] = [];
  for (const [i, raw] of input.entries()) {
    const block = raw as Record<string, unknown>;
    if (
      typeof block.id !== 'string' ||
      typeof block.start !== 'number' ||
      typeof block.end !== 'number' ||
      typeof block.text !== 'string'
    ) {
      return { error: `subtitles.blocks[${i}]: id/start/end/text가 필요합니다.` };
    }
    if (block.text.length > 200) {
      return { error: `subtitles.blocks[${i}]: 텍스트는 200자 이하여야 합니다.` };
    }
    blocks.push({
      id: block.id,
      start: block.start,
      end: block.end,
      text: block.text,
      words: Array.isArray(block.words) ? (block.words as SubtitleBlock['words']) : [],
    });
  }
  return blocks;
}

/**
 * @param base 현재 컴포지션 (드래프트 또는 최신 리비전)
 * @param transcript 분석 transcript (컷 변경 시 자막 리매핑용; 없으면 기존 블록 유지)
 */
export function applyCompositionPatch(
  base: Composition,
  patch: CompositionPatchInput,
  transcript: Transcript | null,
): ApplyPatchResult {
  let cuts = base.cuts;
  let blocks = base.subtitles.blocks;
  const corrections: SubtitleCorrection[] = [];

  if (patch.cuts !== undefined) {
    const parsed = parseCuts(patch.cuts);
    if ('error' in parsed) {
      return { ok: false, errors: [parsed.error] };
    }
    cuts = parsed;
    // 컷이 바뀌면 출력 시간축이 달라지므로 자막을 재계산한다 (F-21)
    if (transcript) {
      blocks = buildSubtitles(transcript, cuts, base.subtitles.style, true).blocks;
    }
  }

  if (patch.subtitles?.blocks !== undefined) {
    const parsed = parseBlocks(patch.subtitles.blocks);
    if ('error' in parsed) {
      return { ok: false, errors: [parsed.error] };
    }
    // 텍스트 교정 수집 (F-22: STT 원문 대비)
    const baseById = new Map(blocks.map((b) => [b.id, b]));
    for (const block of parsed) {
      const original = baseById.get(block.id);
      if (original && original.text !== block.text) {
        corrections.push({
          blockId: block.id,
          originalText: original.text,
          correctedText: block.text,
        });
      }
    }
    blocks = parsed;
  }

  const duration = cuts.reduce((sum, c) => sum + (c.sourceEnd - c.sourceStart), 0);
  const composition: Composition = {
    ...base,
    cuts,
    output: { ...base.output, duration: Math.round(duration * 1000) / 1000 },
    subtitles: { ...base.subtitles, blocks },
  };

  const validation = validateComposition(composition);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, composition, corrections };
}
