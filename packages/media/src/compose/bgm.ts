/**
 * BGM 자동 선택 (F-15).
 * 카탈로그(assets/bgm/catalog.json)에서 무드 태그 기반으로 트랙을 고른다.
 */

import type { AnalysisDoc, BgmSettings } from '@shorts/shared';
import type { PresetDef } from './presets.js';

export interface BgmTrackDef {
  id: string;
  name: string;
  moods: string[];
  durationSeconds: number;
  file: string;
  licenseNote: string;
}

/** 음성이 있을 때 BGM 기본 게인 (F-15 규칙 2) */
export const BGM_GAIN_WITH_SPEECH_DB = -18;
/** 음성이 없을 때 BGM 게인 */
export const BGM_GAIN_NO_SPEECH_DB = -8;
/** 발화 구간 덕킹 목표 */
export const BGM_DUCK_DB = -24;

/** 분석 신호 기반 무드 휴리스틱 (프리셋에 무드가 없을 때) */
export function inferMood(analysis: AnalysisDoc): string {
  const totalShotTime = analysis.shots.reduce((s, shot) => s + (shot.end - shot.start), 0);
  const avgMotion =
    totalShotTime > 0
      ? analysis.shots.reduce((s, shot) => s + shot.signals.motion * (shot.end - shot.start), 0) /
        totalShotTime
      : 0;
  const speechTime = (analysis.transcript?.segments ?? []).reduce(
    (s, seg) => s + (seg.end - seg.start),
    0,
  );
  const speechRatio = analysis.source.duration > 0 ? speechTime / analysis.source.duration : 0;

  if (speechRatio > 0.4) {
    return 'calm'; // 발화 위주 → 방해하지 않는 BGM
  }
  return avgMotion > 0.5 ? 'energetic' : 'upbeat';
}

export function selectBgm(
  bgmOption: string,
  preset: PresetDef,
  analysis: AnalysisDoc,
  catalog: BgmTrackDef[],
): BgmSettings | null {
  if (bgmOption === 'off' || catalog.length === 0) {
    return null;
  }

  const gainDb = analysis.source.hasAudio ? BGM_GAIN_WITH_SPEECH_DB : BGM_GAIN_NO_SPEECH_DB;

  if (bgmOption !== 'auto') {
    const track = catalog.find((t) => t.id === bgmOption);
    return track ? { trackId: track.id, gainDb, duckDb: BGM_DUCK_DB } : null;
  }

  const mood = preset.bgmMood ?? inferMood(analysis);
  const track = catalog.find((t) => t.moods.includes(mood)) ?? catalog[0];
  return { trackId: track.id, gainDb, duckDb: BGM_DUCK_DB };
}
