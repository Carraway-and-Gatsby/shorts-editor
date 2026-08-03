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
import { selectHighlights } from './highlight.js';
import { buildReframe } from './reframe.js';
import type { ScoringConfig } from './scoring.js';
import { buildSubtitles } from './subtitles.js';

export interface BuildCompositionInput {
  jobId: string;
  revision: number;
  analysis: AnalysisDoc;
  options: JobOptions;
  scoring?: ScoringConfig;
}

export function buildCompositionFromAnalysis(input: BuildCompositionInput): Composition {
  const { analysis, options } = input;

  const highlights = selectHighlights(analysis, options.targetDuration, input.scoring);
  const fps = Math.min(OUTPUT_MAX_FPS, analysis.source.fps || OUTPUT_MAX_FPS);
  const reframe = buildReframe(analysis, highlights.cuts, options.reframe, fps);
  const subtitles = buildSubtitles(
    analysis.transcript,
    highlights.cuts,
    options.preset,
    options.subtitle === 'on',
  );

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
    audio: { bgm: null, loudnessTarget: -14 },
    style: { preset: options.preset, titleCard: null, lut: null },
  };

  const validation = validateComposition(composition);
  if (!validation.valid) {
    throw new Error(`generated composition is invalid: ${validation.errors.join('; ')}`);
  }
  return composition;
}
