/**
 * 스타일 프리셋 정의 (F-16).
 * config/presets/*.json이 배포 카탈로그이며, 이 기본값은 설정이 없을 때의 폴백이다.
 * 자막 렌더 스타일(폰트/색/크기)은 ass.ts의 PRESET_STYLES가 담당한다.
 */

export interface PresetDef {
  id: string;
  name?: string;
  description?: string;
  /** BGM 자동 선택 시 우선 무드 (null이면 휴리스틱 사용) */
  bgmMood: string | null;
  /** 첫 1.5초 타이틀 카드 사용 여부 */
  titleCard: boolean;
}

export const DEFAULT_PRESETS: Record<string, PresetDef> = {
  clean: { id: 'clean', bgmMood: 'calm', titleCard: false },
  bold: { id: 'bold', bgmMood: 'upbeat', titleCard: false },
  vlog: { id: 'vlog', bgmMood: 'calm', titleCard: false },
  promo: { id: 'promo', bgmMood: 'energetic', titleCard: true },
};

export function resolvePreset(
  presetId: string,
  presets: Record<string, PresetDef> = DEFAULT_PRESETS,
): PresetDef {
  return presets[presetId] ?? presets.clean ?? DEFAULT_PRESETS.clean;
}
