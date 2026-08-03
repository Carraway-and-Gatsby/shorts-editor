/**
 * 컴포지션 보정 (F-21/F-22).
 * PATCH 페이로드를 현재 컴포지션에 병합하고 의미 규칙을 검증한다.
 * 컷이 바뀌면 자막을 분석 transcript로부터 자동 리매핑한다 (F-21 규칙).
 */

import {
  validateComposition,
  type AnalysisDoc,
  type Composition,
  type Cut,
  type SubtitleBlock,
} from '@shorts/shared';
import { selectBgm, type BgmTrackDef } from './bgm.js';
import { DEFAULT_PRESETS, resolvePreset, type PresetDef } from './presets.js';
import { buildSubtitles } from './subtitles.js';
import { titleCardText } from './compose.js';

export interface CompositionPatchInput {
  cuts?: unknown;
  subtitles?: { blocks?: unknown };
  /** F-23: 스타일 개별 교체 */
  style?: { preset?: unknown };
  audio?: { bgm?: unknown };
}

export interface PatchContext {
  /** 분석 결과 (자막 리매핑·BGM 자동 선택·타이틀 카드용; 없으면 제한 동작) */
  analysis: AnalysisDoc | null;
  presets?: Record<string, PresetDef>;
  bgmCatalog?: BgmTrackDef[];
  /** 원본 오디오 유무 (BGM 게인 결정; analysis 없을 때 사용) */
  hasAudio?: boolean;
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

/** BGM 자동 선택용 최소 분석 문서 (분석이 만료·삭제된 경우) */
function fallbackAnalysis(base: Composition, hasAudio: boolean): AnalysisDoc {
  return {
    version: 1,
    jobId: base.jobId,
    source: {
      duration: base.output.duration,
      fps: base.output.fps,
      width: base.output.width,
      height: base.output.height,
      hasAudio,
    },
    shots: [],
    transcript: null,
    silences: [],
    energy: [],
    warnings: [],
  };
}

/**
 * @param base 현재 컴포지션 (드래프트 또는 최신 리비전)
 * @param context 분석 결과·카탈로그 (자막 리매핑, F-23 스타일 교체용)
 */
export function applyCompositionPatch(
  base: Composition,
  patch: CompositionPatchInput,
  context: PatchContext,
): ApplyPatchResult {
  const transcript = context.analysis?.transcript ?? null;
  let cuts = base.cuts;
  let blocks = base.subtitles.blocks;
  let style = base.style;
  let subtitleStyle = base.subtitles.style;
  let bgm = base.audio.bgm;
  const corrections: SubtitleCorrection[] = [];

  if (patch.cuts !== undefined) {
    const parsed = parseCuts(patch.cuts);
    if ('error' in parsed) {
      return { ok: false, errors: [parsed.error] };
    }
    cuts = parsed;
    // 컷이 바뀌면 출력 시간축이 달라지므로 자막을 재계산한다 (F-21)
    if (transcript) {
      blocks = buildSubtitles(transcript, cuts, subtitleStyle, true).blocks;
    }
  }

  // F-23: 프리셋 교체 (자막 스타일 + 타이틀 카드 재평가)
  if (patch.style?.preset !== undefined) {
    const presetId = patch.style.preset;
    if (typeof presetId !== 'string' || !presetId) {
      return { ok: false, errors: ['style.preset은 문자열이어야 합니다.'] };
    }
    const presets = context.presets ?? DEFAULT_PRESETS;
    if (!presets[presetId]) {
      return { ok: false, errors: [`알 수 없는 프리셋: ${presetId}`] };
    }
    const presetDef = resolvePreset(presetId, presets);
    style = {
      ...style,
      preset: presetId,
      titleCard: presetDef.titleCard
        ? (style.titleCard ?? (context.analysis ? titleCardText(context.analysis) : null))
        : null,
    };
    subtitleStyle = presetId;
  }

  // F-23: BGM 교체 ('off' | 'auto' | 트랙 ID)
  if (patch.audio?.bgm !== undefined) {
    const bgmOption = patch.audio.bgm;
    if (typeof bgmOption !== 'string' || !bgmOption) {
      return { ok: false, errors: ['audio.bgm은 문자열이어야 합니다.'] };
    }
    const hasAudio = context.analysis?.source.hasAudio ?? context.hasAudio ?? true;
    const analysis = context.analysis ?? fallbackAnalysis(base, hasAudio);
    const presetDef = resolvePreset(style.preset, context.presets);
    bgm = selectBgm(bgmOption, presetDef, analysis, context.bgmCatalog ?? []);
    if (bgmOption !== 'off' && bgmOption !== 'auto' && bgm === null) {
      return { ok: false, errors: [`알 수 없는 BGM 트랙: ${bgmOption}`] };
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
    subtitles: { style: subtitleStyle, blocks },
    audio: { ...base.audio, bgm },
    style,
  };

  const validation = validateComposition(composition);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, composition, corrections };
}
