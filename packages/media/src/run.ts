import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { buildProbeArgs, parseProbeOutput, type SourceProbe } from './probe.js';

const execFileAsync = promisify(execFile);

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

export class FfmpegError extends Error {
  constructor(
    message: string,
    public readonly stderrTail: string,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

/** 파일을 ffprobe로 검사한다. 미디어가 아니면 null. */
export async function probeFile(inputPath: string): Promise<SourceProbe | null> {
  try {
    const { stdout } = await execFileAsync(FFPROBE, buildProbeArgs(inputPath), {
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseProbeOutput(stdout);
  } catch {
    return null;
  }
}

export interface RunFfmpegOptions {
  /** 처리 대상 총 길이(초). onProgress 계산에 사용. */
  totalDuration?: number;
  /** 0~1 진행률 콜백 (약 2초 간격) */
  onProgress?: (ratio: number) => void;
}

/** ffmpeg를 실행한다. -progress 출력을 파싱해 진행률을 보고한다. */
export function runFfmpeg(args: string[], options: RunFfmpegOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const fullArgs = options.onProgress ? ['-progress', 'pipe:1', '-nostats', ...args] : args;
    const child = spawn(FFMPEG, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderrTail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    const { onProgress, totalDuration } = options;
    if (onProgress && totalDuration) {
      let lastReport = 0;
      let stdoutBuf = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          const match = /^out_time_us=(\d+)/.exec(line.trim());
          if (match) {
            const seconds = Number(match[1]) / 1e6;
            const now = Date.now();
            if (now - lastReport > 2000) {
              lastReport = now;
              onProgress(Math.min(1, seconds / totalDuration));
            }
          }
        }
      });
    } else {
      child.stdout.resume();
    }

    child.on('error', (err) => reject(new FfmpegError(`ffmpeg spawn failed: ${err.message}`, '')));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new FfmpegError(`ffmpeg exited with code ${code}`, stderrTail));
      }
    });
  });
}

/** ffmpeg 사용 가능 여부 (통합 테스트 스킵 판단용) */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync(FFMPEG, ['-version']);
    await execFileAsync(FFPROBE, ['-version']);
    return true;
  } catch {
    return false;
  }
}
