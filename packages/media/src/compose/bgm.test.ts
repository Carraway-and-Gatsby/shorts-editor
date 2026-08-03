import { describe, expect, it } from 'vitest';
import { inferMood, selectBgm, type BgmTrackDef } from './bgm.js';
import { DEFAULT_PRESETS } from './presets.js';
import { makeAnalysis, makeShot, makeSpeechSegment } from './fixtures.js';

const CATALOG: BgmTrackDef[] = [
  { id: 'bgm_calm_01', name: 'Calm', moods: ['calm'], durationSeconds: 24, file: 'a.m4a', licenseNote: 'CC0' },
  { id: 'bgm_upbeat_01', name: 'Upbeat', moods: ['upbeat'], durationSeconds: 24, file: 'b.m4a', licenseNote: 'CC0' },
  { id: 'bgm_energetic_01', name: 'Energetic', moods: ['energetic', 'promo'], durationSeconds: 24, file: 'c.m4a', licenseNote: 'CC0' },
];

describe('selectBgm', () => {
  it('returns null when off or catalog empty', () => {
    const analysis = makeAnalysis();
    expect(selectBgm('off', DEFAULT_PRESETS.clean, analysis, CATALOG)).toBeNull();
    expect(selectBgm('auto', DEFAULT_PRESETS.clean, analysis, [])).toBeNull();
  });

  it('uses the preset mood on auto', () => {
    const analysis = makeAnalysis();
    expect(selectBgm('auto', DEFAULT_PRESETS.promo, analysis, CATALOG)?.trackId).toBe(
      'bgm_energetic_01',
    );
    expect(selectBgm('auto', DEFAULT_PRESETS.vlog, analysis, CATALOG)?.trackId).toBe('bgm_calm_01');
  });

  it('honors an explicit track id and rejects unknown ids', () => {
    const analysis = makeAnalysis();
    expect(selectBgm('bgm_upbeat_01', DEFAULT_PRESETS.clean, analysis, CATALOG)?.trackId).toBe(
      'bgm_upbeat_01',
    );
    expect(selectBgm('bgm_nonexistent', DEFAULT_PRESETS.clean, analysis, CATALOG)).toBeNull();
  });

  it('sets gain by audio presence (F-15)', () => {
    const withAudio = makeAnalysis();
    const silent = makeAnalysis({
      source: { duration: 60, fps: 30, width: 1920, height: 1080, hasAudio: false },
    });
    expect(selectBgm('auto', DEFAULT_PRESETS.clean, withAudio, CATALOG)?.gainDb).toBe(-18);
    expect(selectBgm('auto', DEFAULT_PRESETS.clean, silent, CATALOG)?.gainDb).toBe(-8);
  });
});

describe('inferMood', () => {
  it('prefers calm for speech-heavy videos', () => {
    const analysis = makeAnalysis({
      transcript: {
        language: 'ko',
        segments: [makeSpeechSegment(0, 80, '아주 긴 발화가 대부분을 차지하는 영상입니다')],
      },
    });
    expect(inferMood(analysis)).toBe('calm');
  });

  it('prefers energetic for high-motion silent videos', () => {
    const analysis = makeAnalysis({
      shots: [makeShot(0, 120, { motion: 0.8 })],
      transcript: null,
    });
    expect(inferMood(analysis)).toBe('energetic');
  });
});
