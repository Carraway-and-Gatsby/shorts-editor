import type { JobOptions } from '@shorts/db';

const TARGET_DURATIONS = [15, 30, 60, 90] as const;

export type JobOptionsValidation =
  | { ok: true; options: JobOptions }
  | { ok: false; message: string };

/** F-03 생성 옵션 파싱. 미지정 항목은 기본값(auto)으로 채운다. */
export function parseJobOptions(input: unknown): JobOptionsValidation {
  const raw = (input ?? {}) as Record<string, unknown>;

  let targetDuration: JobOptions['targetDuration'] = 'auto';
  if (raw.targetDuration !== undefined && raw.targetDuration !== 'auto') {
    if (!TARGET_DURATIONS.includes(raw.targetDuration as never)) {
      return { ok: false, message: `targetDuration은 ${TARGET_DURATIONS.join('/')} 또는 auto만 가능합니다.` };
    }
    targetDuration = raw.targetDuration as JobOptions['targetDuration'];
  }

  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : fallback;

  const subtitle = raw.subtitle === 'off' ? 'off' : 'on';
  const reframe =
    raw.reframe === 'track' || raw.reframe === 'pad' ? raw.reframe : ('auto' as const);

  return {
    ok: true,
    options: {
      targetDuration,
      preset: str(raw.preset, 'clean'),
      subtitle,
      bgm: str(raw.bgm, 'auto'),
      reframe,
      language: str(raw.language, 'auto'),
    },
  };
}
