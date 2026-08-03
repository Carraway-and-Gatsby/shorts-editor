export interface ParsedRange {
  start: number;
  end: number;
}

/**
 * HTTP Range 헤더 파싱 (단일 범위만 지원).
 * @returns null = 범위 요청 아님(전체), 'invalid' = 416 응답 대상
 */
export function parseRangeHeader(
  header: string | undefined,
  size: number,
): ParsedRange | null | 'invalid' {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return 'invalid';
  }
  if (match[1] === '') {
    // suffix: 마지막 N바이트
    const suffix = Number(match[2]);
    if (suffix <= 0) {
      return 'invalid';
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Number(match[2]);
  if (start >= size || end < start) {
    return 'invalid';
  }
  return { start, end: Math.min(end, size - 1) };
}
