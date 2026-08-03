/** 컴포즈 테스트용 AnalysisDoc 픽스처 빌더 */

import type { AnalysisDoc, Shot, TranscriptSegment } from '@shorts/shared';

export function makeShot(
  start: number,
  end: number,
  overrides: Partial<Shot['signals']> = {},
  subjectTrack: Shot['subjectTrack'] = [],
): Shot {
  return {
    start,
    end,
    signals: {
      motion: 0.3,
      shake: 0.1,
      quality: 0.8,
      facePresence: 0,
      darkness: 0.1,
      ...overrides,
    },
    subjectTrack,
  };
}

export function makeSpeechSegment(start: number, end: number, text: string): TranscriptSegment {
  const words = text.split(' ');
  const step = (end - start) / words.length;
  return {
    start,
    end,
    text,
    words: words.map((w, i) => ({
      start: Math.round((start + i * step) * 1000) / 1000,
      end: Math.round((start + (i + 1) * step) * 1000) / 1000,
      text: w,
    })),
  };
}

export function makeAnalysis(overrides: Partial<AnalysisDoc> = {}): AnalysisDoc {
  return {
    version: 1,
    jobId: 'job_test',
    source: { duration: 120, fps: 30, width: 1920, height: 1080, hasAudio: true },
    shots: [makeShot(0, 120)],
    transcript: null,
    silences: [],
    energy: [],
    warnings: [],
    ...overrides,
  };
}
