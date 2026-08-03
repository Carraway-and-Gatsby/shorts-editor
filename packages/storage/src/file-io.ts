import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { ObjectStorage } from './storage.js';

/** 스토리지 오브젝트를 로컬 파일로 내려받는다 (워커의 미디어 처리용). */
export async function downloadToFile(
  storage: ObjectStorage,
  key: string,
  filePath: string,
): Promise<void> {
  const stream = await storage.getStream(key);
  await pipeline(stream, createWriteStream(filePath));
}

/** 로컬 파일을 스토리지에 업로드한다. */
export async function uploadFromFile(
  storage: ObjectStorage,
  key: string,
  filePath: string,
): Promise<void> {
  await storage.putStream(key, createReadStream(filePath));
}
