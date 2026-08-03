import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  expectedChunkBytes,
  expectedChunkCount,
  fileExtension,
  MAX_UPLOAD_BYTES,
  validateUploadRequest,
} from './upload-rules.js';

describe('validateUploadRequest', () => {
  it('accepts a normal mp4', () => {
    expect(
      validateUploadRequest({ filename: 'clip.mp4', size: 1000, mimeType: 'video/mp4' }),
    ).toEqual({ ok: true, ext: 'mp4' });
  });

  it('accepts octet-stream mime with an allowed extension', () => {
    expect(
      validateUploadRequest({
        filename: 'clip.MOV',
        size: 1000,
        mimeType: 'application/octet-stream',
      }),
    ).toEqual({ ok: true, ext: 'mov' });
  });

  it('rejects missing fields', () => {
    expect(validateUploadRequest({ filename: 'a.mp4' })).toMatchObject({
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects oversized files with 413', () => {
    expect(
      validateUploadRequest({
        filename: 'a.mp4',
        size: MAX_UPLOAD_BYTES + 1,
        mimeType: 'video/mp4',
      }),
    ).toMatchObject({ ok: false, status: 413, code: 'FILE_TOO_LARGE' });
  });

  it('rejects unsupported extensions with 422', () => {
    expect(
      validateUploadRequest({ filename: 'song.m4a', size: 100, mimeType: 'video/mp4' }),
    ).toMatchObject({ ok: false, status: 422, code: 'INVALID_MEDIA' });
  });

  it('rejects unsupported mime types with 422', () => {
    expect(
      validateUploadRequest({ filename: 'a.mp4', size: 100, mimeType: 'audio/mpeg' }),
    ).toMatchObject({ ok: false, status: 422, code: 'INVALID_MEDIA' });
  });
});

describe('chunk math', () => {
  it('computes chunk counts', () => {
    expect(expectedChunkCount(1, CHUNK_SIZE)).toBe(1);
    expect(expectedChunkCount(CHUNK_SIZE, CHUNK_SIZE)).toBe(1);
    expect(expectedChunkCount(CHUNK_SIZE + 1, CHUNK_SIZE)).toBe(2);
  });

  it('computes per-chunk sizes including the last partial chunk', () => {
    const size = CHUNK_SIZE * 2 + 100;
    expect(expectedChunkBytes(0, size, CHUNK_SIZE)).toBe(CHUNK_SIZE);
    expect(expectedChunkBytes(1, size, CHUNK_SIZE)).toBe(CHUNK_SIZE);
    expect(expectedChunkBytes(2, size, CHUNK_SIZE)).toBe(100);
    expect(expectedChunkBytes(3, size, CHUNK_SIZE)).toBe(-1);
    expect(expectedChunkBytes(-1, size, CHUNK_SIZE)).toBe(-1);
  });
});

describe('fileExtension', () => {
  it('extracts lowercase extensions', () => {
    expect(fileExtension('My Video.MP4')).toBe('mp4');
    expect(fileExtension('archive.tar.mkv')).toBe('mkv');
  });

  it('returns null when there is no extension', () => {
    expect(fileExtension('noext')).toBeNull();
    expect(fileExtension('.hidden')).toBeNull();
    expect(fileExtension('trailing.')).toBeNull();
  });
});
