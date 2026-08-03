/**
 * Compose 단계의 핵심: 분석 결과 + 생성 옵션 → 컴포지션 (docs/04-pipeline-spec.md §4.3).
 */

import type { JobOptions } from '@shorts/db';
import {
  OUTPUT_HEIGHT,
  OUTPUT_MAX_FPS,
  OUTPUT_WIDTH,
  validateComposition,
  type AnalysisDoc,
  type Composition,
} from '@shorts/shared';
import { selectBgm, type BgmTrackDef } from './bgm.js';
import { selectHighlights } from './highlight.js';
import { resolvePreset, type PresetDef } from './presets.js';
import { buildReframe } from './reframe.js';
import type { ScoringConfig } from './scoring.js';
import { buildSubtitles } from './subtitles.js';

const TITLE_CARD_MAX_CHARS = 24;

export interface BuildCompositionInput {
  jobId: string;
  revision: number;
  analysis: AnalysisDoc;
  options: JobOptions;
  scoring?: ScoringConfig;
  presets?: Record<string, PresetDef>;
  bgmCatalog?: BgmTrackDef[];
}

/** 타이틀 카드 문구 (F-16): STT 첫 문장을 잘라 사용 */
function titleCardText(analysis: AnalysisDoc): string | null {
  const first = analysis.transcript?.segments[0]?.text?.trim();
  if (!first) {
    return null;
  }
  return first.length > TITLE_CARD_MAX_CHARS ? `${first.slice(0, TITLE_CARD_MAX_CHARS)}…` : first;
}

export function buildCompositionFromAnalysis(input: BuildCompositionInput): Composition {
  const { analysis, options } = input;
  const preset = resolvePreset(options.preset, input.presets);

  const highlights = selectHighlights(analysis, options.targetDuration, input.scoring);
  const fps = Math.min(OUTPUT_MAX_FPS, analysis.source.fps || OUTPUT_MAX_FPS);
  const reframe = buildReframe(analysis, highlights.cuts, options.reframe, fps);
  const subtitles = buildSubtitles(
    analysis.transcript,
    highlights.cuts,
    options.preset,
    options.subtitle === 'on',
  );
  const bgm = selectBgm(options.bgm, preset, analysis, input.bgmCatalog ?? []);

  const composition: Composition = {
    version: 1,
    jobId: input.jobId,
    revision: input.revision,
    output: {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      fps,
      duration: highlights.duration,
    },
    cuts: highlights.cuts,
    reframe,
    subtitles,
    audio: { bgm, loudnessTarget: -14 },
    style: {
      preset: options.preset,
      titleCard: preset.titleCard ? titleCardText(analysis) : null,
      lut: null,
    },
  };

  const validation = validateComposition(composition);
  if (!validation.valid) {
    throw new Error(`generated composition is invalid: ${validation.errors.join('; ')}`);
  }
  return composition;
}
