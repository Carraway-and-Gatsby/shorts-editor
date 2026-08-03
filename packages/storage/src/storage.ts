import type { Readable } from 'node:stream';

/**
 * 오브젝트 스토리지 추상화.
 * MVP는 로컬 파일시스템(LocalFsStorage), 확장 시 S3 호환 구현체로 교체한다.
 * docs/05-architecture.md §5.1 설계 원칙 3 참조.
 */
export interface ObjectStorage {
  put(key: string, data: Buffer | string): Promise<void>;
  putStream(key: string, data: Readable): Promise<void>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** prefix로 시작하는 키 목록 (정렬됨) */
  list(prefix: string): Promise<string[]>;
}

/** 잡 산출물 스토리지 키 규약. docs/07-data-model.md §7.4 참조. */
export const storageKeys = {
  source: (jobId: string, ext: string): string => `jobs/${jobId}/source.${ext}`,
  proxy: (jobId: string): string => `jobs/${jobId}/proxy.mp4`,
  audio: (jobId: string): string => `jobs/${jobId}/audio.wav`,
  analysis: (jobId: string): string => `jobs/${jobId}/analysis.json`,
  thumbnail: (jobId: string): string => `jobs/${jobId}/thumbnail.jpg`,
  output: (jobId: string, revision: number): string => `jobs/${jobId}/output_r${revision}.mp4`,
  outputThumbnail: (jobId: string, revision: number): string =>
    `jobs/${jobId}/output_r${revision}_thumb.jpg`,
} as const;
