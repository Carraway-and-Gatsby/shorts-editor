/** 업로드 사전 검증 규칙 (F-01/F-02, NFR-1). 실제 미디어 검증은 Ingest 단계에서 수행한다. */

export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3; // 2GiB
export const CHUNK_SIZE = 8 * 1024 * 1024; // 8MiB
export const UPLOAD_TTL_HOURS = 24;
export const JOB_RETENTION_DAYS = 7;

export const ALLOWED_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi'] as const;

const ALLOWED_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-msvideo',
  'video/avi',
  // 브라우저가 타입을 모를 때. 확장자 검사가 1차 방어선이며 최종 검증은 ffprobe가 한다.
  'application/octet-stream',
]);

export function fileExtension(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) {
    return null;
  }
  return filename.slice(dot + 1).toLowerCase();
}

export type UploadRequestValidation =
  | { ok: true; ext: string }
  | { ok: false; status: number; code: string; message: string };

export function validateUploadRequest(input: {
  filename?: unknown;
  size?: unknown;
  mimeType?: unknown;
}): UploadRequestValidation {
  const { filename, size, mimeType } = input;
  if (typeof filename !== 'string' || typeof mimeType !== 'string' || typeof size !== 'number') {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'filename, size, mimeType는 필수입니다.',
    };
  }
  if (!Number.isInteger(size) || size <= 0) {
    return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'size가 올바르지 않습니다.' };
  }
  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'FILE_TOO_LARGE',
      message: '최대 2GB까지 업로드할 수 있습니다.',
    };
  }
  const ext = fileExtension(filename);
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      status: 422,
      code: 'INVALID_MEDIA',
      message: `지원하지 않는 파일 형식입니다. 지원: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return {
      ok: false,
      status: 422,
      code: 'INVALID_MEDIA',
      message: '지원하지 않는 미디어 타입입니다.',
    };
  }
  return { ok: true, ext };
}

export function expectedChunkCount(size: number, chunkSize: number): number {
  return Math.ceil(size / chunkSize);
}

/** index번째 청크의 기대 크기 */
export function expectedChunkBytes(index: number, size: number, chunkSize: number): number {
  const total = expectedChunkCount(size, chunkSize);
  if (index < 0 || index >= total) {
    return -1;
  }
  return index === total - 1 ? size - chunkSize * (total - 1) : chunkSize;
}
