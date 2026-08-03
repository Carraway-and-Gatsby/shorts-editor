import type { Cut } from '@shorts/shared';
import { describe, expect, it } from 'vitest';
import { makeAnalysis, makeShot } from './fixtures.js';
import { buildTrackKeyframes, decideReframeMode } from './reframe.js';

const CUTS: Cut[] = [{ id: 'c1', sourceStart: 0, sourceEnd: 20, transition: 'cut' }];

describe('decideReframeMode', () => {
  it('returns none for already-vertical sources', () => {
    const analysis = makeAnalysis({
      source: { duration: 30, fps: 30, width: 1080, height: 1920, hasAudio: true },
    });
    expect(decideReframeMode(analysis, CUTS, 'auto')).toBe('none');
  });

  it('honors an explicit request', () => {
    const analysis = makeAnalysis();
    expect(decideReframeMode(analysis, CUTS, 'pad')).toBe('pad');
    expect(decideReframeMode(analysis, CUTS, 'track')).toBe('track');
  });

  it('picks track when faces are present most of the time', () => {
    const analysis = makeAnalysis({
      shots: [makeShot(0, 120, { facePresence: 0.9 })],
    });
    expect(decideReframeMode(analysis, CUTS, 'auto')).toBe('track');
  });

  it('picks pad when faces are rare', () => {
    const analysis = makeAnalysis({
      shots: [makeShot(0, 120, { facePresence: 0.2 })],
    });
    expect(decideReframeMode(analysis, CUTS, 'auto')).toBe('pad');
  });
});

describe('buildTrackKeyframes', () => {
  it('follows a stable subject', () => {
    const track = Array.from({ length: 41 }, (_, i) => ({
      t: i * 0.5,
      cx: 0.3,
      cy: 0.4,
      w: 0.2,
      h: 0.3,
    }));
    const analysis = makeAnalysis({
      shots: [makeShot(0, 20, { facePresence: 1 }, track)],
    });
    const keyframes = buildTrackKeyframes(analysis, CUTS, 30);
    expect(keyframes.length).toBeGreaterThan(30);
    // 스무딩 후에도 피사체 위치 근처를 유지
    for (const kf of keyframes.slice(5)) {
      expect(kf.cx).toBeCloseTo(0.3, 1);
    }
    // 출력 시간축 오름차순
    for (let i = 1; i < keyframes.length; i++) {
      expect(keyframes[i].t).toBeGreaterThan(keyframes[i - 1].t);
    }
  });

  it('clamps sudden jumps (F-13-R2)', () => {
    // 10초 지점에서 피사체가 0.2 → 0.8로 순간 이동
    const track = Array.from({ length: 41 }, (_, i) => ({
      t: i * 0.5,
      cx: i * 0.5 < 10 ? 0.2 : 0.8,
      cy: 0.4,
      w: 0.2,
      h: 0.3,
    }));
    const analysis = makeAnalysis({
      shots: [makeShot(0, 20, { facePresence: 1 }, track)],
    });
    const keyframes = buildTrackKeyframes(analysis, CUTS, 30);
    // 프레임당 1.5% → 0.5초 키프레임 간 최대 이동 0.225
    for (let i = 1; i < keyframes.length; i++) {
      expect(Math.abs(keyframes[i].cx - keyframes[i - 1].cx)).toBeLessThanOrEqual(0.226);
    }
  });

  it('holds then recenters when the subject disappears', () => {
    // 앞 5초만 피사체 존재
    const track = Array.from({ length: 11 }, (_, i) => ({
      t: i * 0.5,
      cx: 0.2,
      cy: 0.4,
      w: 0.2,
      h: 0.3,
    }));
    const analysis = makeAnalysis({
      shots: [makeShot(0, 20, { facePresence: 0.25 }, track)],
    });
    const keyframes = buildTrackKeyframes(analysis, CUTS, 30);
    const late = keyframes[keyframes.length - 1];
    // 소실 3초 유지 후 중앙 복귀
    expect(late.cx).toBeGreaterThan(0.4);
  });

  it('keeps the vertical position in the safe band (F-13-R3)', () => {
    const track = [{ t: 0, cx: 0.5, cy: 0.95, w: 0.2, h: 0.3 }];
    const analysis = makeAnalysis({ shots: [makeShot(0, 20, { facePresence: 1 }, track)] });
    const keyframes = buildTrackKeyframes(analysis, CUTS, 30);
    for (const kf of keyframes) {
      expect(kf.cy).toBeGreaterThanOrEqual(0.25);
      expect(kf.cy).toBeLessThanOrEqual(0.6);
    }
  });
});
