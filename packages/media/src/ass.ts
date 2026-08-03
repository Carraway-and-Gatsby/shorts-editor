/**
 * ASS 자막 파일 생성 (F-14 번인용).
 * 스타일 수치는 1080×1920 캔버스 기준. docs/03-functional-spec.md F-14 참조.
 */

import type { StyleSettings, SubtitleBlock } from '@shorts/shared';

interface AssStyle {
  fontName: string;
  fontSize: number;
  outline: number;
  primaryColour: string;
  outlineColour: string;
  bold: number;
}

/** 프리셋별 자막 스타일 (F-16의 자막 요소) */
const PRESET_STYLES: Record<string, AssStyle> = {
  clean: {
    fontName: 'Noto Sans CJK KR',
    fontSize: 86, // 화면 높이의 ~4.5%
    outline: 5,
    primaryColour: '&H00FFFFFF',
    outlineColour: '&H00000000',
    bold: 1,
  },
  bold: {
    fontName: 'Noto Sans CJK KR',
    fontSize: 100,
    outline: 7,
    primaryColour: '&H0000E5FF', // 노란 계열 (BGR)
    outlineColour: '&H00000000',
    bold: 1,
  },
};

/** h:mm:ss.cc 형식 (ASS 시간 표기) */
export function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  if (cs === 100) {
    return formatAssTime(Math.floor(clamped) + 1);
  }
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** 오버라이드 태그 주입 방지 및 줄바꿈 정리 */
export function escapeAssText(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');
}

export function buildAssDocument(
  blocks: SubtitleBlock[],
  style: StyleSettings | { preset: string },
): string {
  const preset = PRESET_STYLES[style.preset] ?? PRESET_STYLES.clean;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${preset.fontName},${preset.fontSize},${preset.primaryColour},&H000000FF,${preset.outlineColour},&H80000000,${preset.bold},0,0,0,100,100,0,0,1,${preset.outline},0,2,60,60,422,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = blocks
    .map(
      (block) =>
        `Dialogue: 0,${formatAssTime(block.start)},${formatAssTime(block.end)},Default,,0,0,0,,${escapeAssText(block.text)}`,
    )
    .join('\n');
  return header + events + '\n';
}
