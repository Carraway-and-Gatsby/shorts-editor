/** ffmpeg 명령 인자 빌더 (순수 함수). 실행은 run.ts가 담당한다. */

import type { Cut } from '@shorts/shared';

/** 분석용 프록시: H.264 720p 30fps CRF23 (docs/04-pipeline-spec.md §4.1) */
export function buildProxyArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-y',
    '-i',
    inputPath,
    '-vf',
    'scale=-2:min(720\\,ih)',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

/** 대표 썸네일 1장 추출 */
export function buildThumbnailArgs(
  inputPath: string,
  outputPath: string,
  atSeconds: number,
): string[] {
  return [
    '-y',
    '-ss',
    atSeconds.toFixed(2),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    outputPath,
  ];
}

export interface RenderArgsInput {
  inputPath: string;
  outputPath: string;
  cut: Cut;
  fps: number;
  hasAudio: boolean;
  width: number;
  height: number;
}

/**
 * 9:16 pad 모드 렌더링 (F-13 pad):
 * 배경 = 원본을 캔버스에 꽉 차게 확대·크롭 후 블러, 전경 = 원본을 캔버스 안에 맞춤.
 * 출력 스펙은 F-30: H.264 High, VBR 8~10Mbps, AAC 128k 48kHz, faststart.
 */
export function buildRenderArgs(input: RenderArgsInput): string[] {
  const { width: w, height: h } = input;
  const filter = [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=20[bgb]`,
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs]`,
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,fps=${input.fps},format=yuv420p[v]`,
  ].join(';');

  const args = [
    '-y',
    '-ss',
    input.cut.sourceStart.toFixed(3),
    '-to',
    input.cut.sourceEnd.toFixed(3),
    '-i',
    input.inputPath,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
  ];
  if (input.hasAudio) {
    args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000');
  }
  args.push(
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-preset',
    'medium',
    '-b:v',
    '9M',
    '-maxrate',
    '10M',
    '-bufsize',
    '20M',
    '-movflags',
    '+faststart',
    input.outputPath,
  );
  return args;
}
