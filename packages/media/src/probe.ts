/** ffprobe 출력 파싱. docs/04-pipeline-spec.md §4.1 참조. */

export interface SourceProbe {
  /** 초 단위 길이 */
  duration: number;
  /** 회전 적용 후(표시 방향 기준) 크기 */
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** 회전 메타데이터 (도 단위, 0/90/180/270) */
  rotation: number;
}

export function buildProbeArgs(inputPath: string): string[] {
  return [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ];
}

interface FfprobeStream {
  codec_type?: string;
  disposition?: { attached_pic?: number };
  width?: number;
  height?: number;
  duration?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) {
    return null;
  }
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den || !Number.isFinite(num) || !Number.isFinite(den)) {
    return null;
  }
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function parseRotation(stream: FfprobeStream): number {
  const sideData = stream.side_data_list?.find((s) => typeof s.rotation === 'number');
  let rotation = 0;
  if (sideData && typeof sideData.rotation === 'number') {
    rotation = sideData.rotation;
  } else if (stream.tags?.rotate) {
    rotation = Number(stream.tags.rotate) || 0;
  }
  // -90 → 270 형태로 정규화
  return ((rotation % 360) + 360) % 360;
}

/**
 * ffprobe JSON 출력을 파싱한다.
 * @returns 비디오 스트림이 없으면 null (INVALID_MEDIA 처리용)
 */
export function parseProbeOutput(json: string): SourceProbe | null {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(json) as FfprobeOutput;
  } catch {
    return null;
  }

  const streams = parsed.streams ?? [];
  const video = streams.find(
    (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1,
  );
  if (!video || !video.width || !video.height) {
    return null;
  }

  const duration = Number(parsed.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const rotation = parseRotation(video);
  const swapped = rotation === 90 || rotation === 270;
  const fps = parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate) ?? 30;

  return {
    duration,
    width: swapped ? video.height : video.width,
    height: swapped ? video.width : video.height,
    fps,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    rotation,
  };
}
