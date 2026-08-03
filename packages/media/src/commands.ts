/** ffmpeg 명령 인자 빌더 (순수 함수). 실행은 run.ts가 담당한다. */

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

/** STT/에너지 분석용 오디오 추출: 16kHz mono WAV (docs/04-pipeline-spec.md §4.1) */
export function buildAudioExtractArgs(inputPath: string, outputPath: string): string[] {
  return ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath];
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

