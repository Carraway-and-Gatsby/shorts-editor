import type { SourceProbe } from './probe.js';

/** 입력 제한. docs/08-non-functional.md §8.1 참조. */
export const MIN_SOURCE_DURATION = 3;
export const MAX_SOURCE_DURATION = 600;
export const MAX_SOURCE_LONG_EDGE = 3840;
export const MAX_SOURCE_SHORT_EDGE = 2160;

export type SourceValidation =
  | { ok: true }
  | { ok: false; code: 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_MEDIA'; message: string };

export function validateSource(probe: SourceProbe | null): SourceValidation {
  if (!probe) {
    return { ok: false, code: 'INVALID_MEDIA', message: '비디오 스트림을 찾을 수 없습니다.' };
  }
  if (probe.duration < MIN_SOURCE_DURATION) {
    return {
      ok: false,
      code: 'TOO_SHORT',
      message: `영상이 너무 짧습니다. 최소 ${MIN_SOURCE_DURATION}초 이상이어야 합니다.`,
    };
  }
  if (probe.duration > MAX_SOURCE_DURATION) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `영상이 너무 깁니다. 최대 ${MAX_SOURCE_DURATION / 60}분까지 지원합니다.`,
    };
  }
  const longEdge = Math.max(probe.width, probe.height);
  const shortEdge = Math.min(probe.width, probe.height);
  if (longEdge > MAX_SOURCE_LONG_EDGE || shortEdge > MAX_SOURCE_SHORT_EDGE) {
    return {
      ok: false,
      code: 'INVALID_MEDIA',
      message: '최대 4K(3840×2160) 해상도까지 지원합니다.',
    };
  }
  return { ok: true };
}
