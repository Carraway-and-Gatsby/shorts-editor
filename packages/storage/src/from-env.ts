import { LocalFsStorage } from './local-fs.js';
import { S3Storage } from './s3.js';
import type { ObjectStorage } from './storage.js';

/**
 * 환경 변수로 스토리지 드라이버를 선택한다 (docs/05-architecture.md 설계 원칙 3).
 * - STORAGE_DRIVER=local (기본): STORAGE_ROOT 로컬 디렉터리
 * - STORAGE_DRIVER=s3: S3_BUCKET (+ S3_ENDPOINT/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)
 */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const driver = env.STORAGE_DRIVER ?? 'local';
  if (driver === 's3') {
    const bucket = env.S3_BUCKET;
    if (!bucket) {
      throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    }
    return new S3Storage({
      bucket,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  if (driver !== 'local') {
    throw new Error(`unknown STORAGE_DRIVER: ${driver}`);
  }
  return new LocalFsStorage(env.STORAGE_ROOT ?? './storage-data');
}
