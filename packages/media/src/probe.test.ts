import { describe, expect, it } from 'vitest';
import { parseProbeOutput } from './probe.js';
import { validateSource } from './validate-source.js';

function probeJson(overrides: {
  duration?: string;
  streams?: unknown[];
}): string {
  return JSON.stringify({
    format: { duration: overrides.duration ?? '10.5' },
    streams: overrides.streams ?? [
      { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1' },
      { codec_type: 'audio' },
    ],
  });
}

describe('parseProbeOutput', () => {
  it('parses a standard landscape video with audio', () => {
    const probe = parseProbeOutput(probeJson({}));
    expect(probe).toEqual({
      duration: 10.5,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      rotation: 0,
    });
  });

  it('returns null when there is no video stream', () => {
    expect(parseProbeOutput(probeJson({ streams: [{ codec_type: 'audio' }] }))).toBeNull();
  });

  it('ignores attached_pic streams (cover art)', () => {
    const json = probeJson({
      streams: [
        { codec_type: 'video', width: 600, height: 600, disposition: { attached_pic: 1 } },
        { codec_type: 'audio' },
      ],
    });
    expect(parseProbeOutput(json)).toBeNull();
  });

  it('swaps dimensions for 90-degree rotation metadata', () => {
    const json = probeJson({
      streams: [
        {
          codec_type: 'video',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30000/1001',
          side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
        },
      ],
    });
    const probe = parseProbeOutput(json);
    expect(probe?.width).toBe(1080);
    expect(probe?.height).toBe(1920);
    expect(probe?.rotation).toBe(270);
    expect(probe?.hasAudio).toBe(false);
    expect(probe?.fps).toBeCloseTo(29.97, 2);
  });

  it('falls back to legacy rotate tag', () => {
    const json = probeJson({
      streams: [
        { codec_type: 'video', width: 1280, height: 720, tags: { rotate: '90' } },
      ],
    });
    const probe = parseProbeOutput(json);
    expect(probe?.width).toBe(720);
    expect(probe?.height).toBe(1280);
  });

  it('returns null for invalid json or zero duration', () => {
    expect(parseProbeOutput('not json')).toBeNull();
    expect(parseProbeOutput(probeJson({ duration: '0' }))).toBeNull();
  });
});

describe('validateSource', () => {
  const base = { width: 1920, height: 1080, fps: 30, hasAudio: true, rotation: 0 };

  it('accepts a normal source', () => {
    expect(validateSource({ ...base, duration: 60 })).toEqual({ ok: true });
  });

  it('rejects null probe as INVALID_MEDIA', () => {
    expect(validateSource(null)).toMatchObject({ ok: false, code: 'INVALID_MEDIA' });
  });

  it('rejects sources shorter than 3s', () => {
    expect(validateSource({ ...base, duration: 2.9 })).toMatchObject({
      ok: false,
      code: 'TOO_SHORT',
    });
  });

  it('rejects sources longer than 10 minutes', () => {
    expect(validateSource({ ...base, duration: 601 })).toMatchObject({
      ok: false,
      code: 'TOO_LONG',
    });
  });

  it('accepts 4K but rejects above', () => {
    expect(validateSource({ ...base, duration: 60, width: 3840, height: 2160 })).toEqual({
      ok: true,
    });
    expect(
      validateSource({ ...base, duration: 60, width: 4096, height: 2160 }),
    ).toMatchObject({ ok: false, code: 'INVALID_MEDIA' });
  });
});
