/** 프리셋/BGM 카탈로그 파일 로더 (부팅 시 1회 사용) */

import fs from 'node:fs';
import path from 'node:path';
import type { BgmTrackDef } from './compose/bgm.js';
import { DEFAULT_PRESETS, type PresetDef } from './compose/presets.js';

/** config/presets/*.json 로드. 디렉터리가 없으면 기본 프리셋 반환. */
export function loadPresetCatalog(dir: string): PresetDef[] {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    const presets: PresetDef[] = [];
    for (const file of files) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as PresetDef;
      if (typeof raw.id === 'string' && raw.id) {
        presets.push({ ...raw, bgmMood: raw.bgmMood ?? null, titleCard: raw.titleCard === true });
      }
    }
    return presets.length > 0 ? presets : Object.values(DEFAULT_PRESETS);
  } catch {
    return Object.values(DEFAULT_PRESETS);
  }
}

export function presetsById(catalog: PresetDef[]): Record<string, PresetDef> {
  return Object.fromEntries(catalog.map((p) => [p.id, p]));
}

/** assets/bgm/catalog.json 로드. 없으면 빈 카탈로그(BGM 미사용). */
export function loadBgmCatalog(file: string): BgmTrackDef[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { tracks?: BgmTrackDef[] };
    return (raw.tracks ?? []).filter((t) => typeof t.id === 'string' && t.id);
  } catch {
    return [];
  }
}
