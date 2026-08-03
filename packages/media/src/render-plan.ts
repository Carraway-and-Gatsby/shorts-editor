/**
 * 렌더링 계획 빌더 (순수 함수).
 * 컷별 중간 파일 → concat → 최종 패스(자막 번인 + 라우드니스)의
 * ffmpeg 인자와 필터 그래프를 생성한다. docs/04-pipeline-spec.md §4.4 참조.
 */

import type { Composition, Cut, ReframeKeyframe } from '@shorts/shared';

const VIDEO_ENCODE_ARGS = [
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
];
const AUDIO_ENCODE_ARGS = ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000'];

/** 렌더 시 컷당 크롭 키프레임 상한 (표현식 크기 제한) */
const MAX_RENDER_KEYFRAMES = 120;

export interface SourceDimensions {
  width: number;
  height: number;
}

/** 9:16 크롭 윈도우 크기 (원본 안에 완전히 들어가는 최대 크기, 짝수 정렬) */
export function cropWindow(source: SourceDimensions): { w: number; h: number } {
  const targetAspect = 9 / 16;
  let w = source.width;
  let h = Math.round(w / targetAspect);
  if (h > source.height) {
    h = source.height;
    w = Math.round(h * targetAspect);
  }
  w -= w % 2;
  h -= h % 2;
  return { w, h };
}

/** 키프레임 값의 구간별 선형 보간 ffmpeg 표현식 (중첩 if) */
export function piecewiseLinearExpr(points: Array<{ t: number; v: number }>): string {
  if (points.length === 0) {
    return '0';
  }
  if (points.length === 1) {
    return String(round2(points[0].v));
  }
  const build = (index: number): string => {
    if (index === points.length - 1) {
      return String(round2(points[index].v));
    }
    const a = points[index];
    const b = points[index + 1];
    const dt = b.t - a.t;
    const lerp =
      dt <= 0
        ? String(round2(a.v))
        : `(${round2(a.v)}+(t-${round2(a.t)})*${round2((b.v - a.v) / dt)})`;
    return `if(lt(t,${round2(b.t)}),${lerp},${build(index + 1)})`;
  };
  return build(0);
}

/** 컷 구간에 해당하는 키프레임을 컷 상대 시간으로 변환 (렌더 상한 다운샘플 포함) */
export function keyframesForCut(
  keyframes: ReframeKeyframe[],
  cutOutputStart: number,
  cutDuration: number,
): ReframeKeyframe[] {
  const inCut = keyframes
    .filter((k) => k.t >= cutOutputStart - 1e-6 && k.t <= cutOutputStart + cutDuration + 1e-6)
    .map((k) => ({ ...k, t: Math.max(0, k.t - cutOutputStart) }));
  if (inCut.length <= MAX_RENDER_KEYFRAMES) {
    return inCut;
  }
  const step = Math.ceil(inCut.length / MAX_RENDER_KEYFRAMES);
  return inCut.filter((_, i) => i % step === 0 || i === inCut.length - 1);
}

export interface CutFilterInput {
  composition: Composition;
  cut: Cut;
  cutOutputStart: number;
  source: SourceDimensions;
}

/** 컷 하나의 비디오 필터 그래프 (모드별 9:16 변환 + fps + 픽셀 포맷) */
export function buildCutFilter(input: CutFilterInput): string {
  const { composition, cut, source } = input;
  const { width: outW, height: outH, fps } = composition.output;
  const tail = `fps=${fps},format=yuv420p[v]`;

  switch (composition.reframe.mode) {
    case 'none':
      return `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},${tail}`;
    case 'pad':
      return [
        `[0:v]split=2[bg][fg]`,
        `[bg]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},gblur=sigma=20[bgb]`,
        `[fg]scale=${outW}:${outH}:force_original_aspect_ratio=decrease[fgs]`,
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${tail}`,
      ].join(';');
    case 'track': {
      const { w: cw, h: ch } = cropWindow(source);
      const keyframes = keyframesForCut(
        composition.reframe.keyframes,
        input.cutOutputStart,
        cut.sourceEnd - cut.sourceStart,
      );
      const xPoints = keyframes.map((k) => ({
        t: k.t,
        v: clamp(k.cx * source.width - cw / 2, 0, source.width - cw),
      }));
      const yPoints = keyframes.map((k) => ({
        t: k.t,
        v: clamp(k.cy * source.height - ch / 2, 0, source.height - ch),
      }));
      const xExpr = piecewiseLinearExpr(xPoints);
      const yExpr = piecewiseLinearExpr(yPoints);
      return `[0:v]crop=${cw}:${ch}:x='${xExpr}':y='${yExpr}',scale=${outW}:${outH},${tail}`;
    }
  }
}

export interface CutRenderArgsInput extends CutFilterInput {
  inputPath: string;
  filterScriptPath: string;
  outputPath: string;
  hasAudio: boolean;
}

/** 컷 하나를 중간 파일로 렌더링하는 인자 (필터는 스크립트 파일로 전달) */
export function buildCutRenderArgs(input: CutRenderArgsInput): string[] {
  const args = [
    '-y',
    '-ss',
    input.cut.sourceStart.toFixed(3),
    '-to',
    input.cut.sourceEnd.toFixed(3),
    '-i',
    input.inputPath,
    '-filter_complex_script',
    input.filterScriptPath,
    '-map',
    '[v]',
  ];
  if (input.hasAudio) {
    args.push('-map', '0:a:0', ...AUDIO_ENCODE_ARGS);
  }
  args.push(...VIDEO_ENCODE_ARGS, input.outputPath);
  return args;
}

/** concat demuxer 목록 파일 내용 */
export function buildConcatList(paths: string[]): string {
  return paths.map((p) => `file '${p}'`).join('\n') + '\n';
}

export function buildConcatArgs(listPath: string, outputPath: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath];
}

export interface FinalPassBgm {
  /** BGM 트랙 파일 경로 */
  path: string;
  gainDb: number;
}

export interface FinalPassInput {
  inputPath: string;
  outputPath: string;
  /** 자막 번인용 ASS 파일 경로 (없으면 비디오는 복사) */
  assPath: string | null;
  hasAudio: boolean;
  loudnessTarget: number;
  /** BGM 믹싱 (F-15). null이면 원본 오디오만. */
  bgm?: FinalPassBgm | null;
  /** 출력 길이(초) — BGM 트림/페이드 계산용 */
  outputDuration: number;
}

/** BGM 체인: 게인 → 길이 맞춤(루프+트림) → 페이드인 0.5s / 페이드아웃 1.5s (F-15 규칙 3) */
function bgmChain(bgm: FinalPassBgm, duration: number): string {
  const fadeOutStart = Math.max(0, duration - 1.5);
  return (
    `[1:a]volume=${bgm.gainDb}dB,atrim=0:${duration.toFixed(3)},` +
    `afade=t=in:d=0.5,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=1.5[bgm]`
  );
}

/**
 * 최종 패스: 자막 번인(있을 때만 비디오 재인코딩) + BGM 믹싱(사이드체인 덕킹) +
 * 라우드니스 노멀라이즈(-14 LUFS) + faststart.
 */
export function buildFinalPassArgs(input: FinalPassInput): string[] {
  const loudnorm = `loudnorm=I=${input.loudnessTarget}:TP=-1.5:LRA=11`;
  const args = ['-y', '-i', input.inputPath];
  if (input.bgm) {
    // BGM 입력만 무한 루프로 열고(atrim이 출력 길이로 자른다) 메인 입력은 그대로 둔다
    args.push('-stream_loop', '-1', '-i', input.bgm.path);
  }

  const filters: string[] = [];
  let audioMap: string | null = null;

  if (input.bgm && input.hasAudio) {
    // 원본 음성 + BGM: 음성을 사이드체인으로 BGM을 덕킹(발화 중 감쇠) 후 믹스
    filters.push(
      '[0:a]asplit=2[voice][sc]',
      bgmChain(input.bgm, input.outputDuration),
      '[bgm][sc]sidechaincompress=threshold=0.03:ratio=8:attack=100:release=800[duck]',
      `[voice][duck]amix=inputs=2:duration=first:normalize=0,${loudnorm}[aout]`,
    );
    audioMap = '[aout]';
  } else if (input.bgm) {
    filters.push(`${bgmChain(input.bgm, input.outputDuration)};[bgm]${loudnorm}[aout]`);
    audioMap = '[aout]';
  } else if (input.hasAudio) {
    filters.push(`[0:a]${loudnorm}[aout]`);
    audioMap = '[aout]';
  }

  if (input.assPath) {
    filters.push(`[0:v]subtitles=${input.assPath}[vout]`);
  }

  if (filters.length > 0) {
    args.push('-filter_complex', filters.join(';'));
  }

  if (input.assPath) {
    args.push('-map', '[vout]', ...VIDEO_ENCODE_ARGS);
  } else {
    args.push('-map', '0:v', '-c:v', 'copy');
  }
  if (audioMap) {
    args.push('-map', audioMap, ...AUDIO_ENCODE_ARGS);
  }
  args.push('-movflags', '+faststart', input.outputPath);
  return args;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
