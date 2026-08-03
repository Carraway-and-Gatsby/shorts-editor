import { createReadStream, createWriteStream, type Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ByteRange, ObjectStorage } from './storage.js';

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** 로컬 파일시스템 기반 스토리지. 키는 루트 디렉터리 하위 상대 경로로 매핑된다. */
export class LocalFsStorage implements ObjectStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** 키를 루트 내부 절대 경로로 변환한다. 루트 밖으로 나가는 키는 거부한다. */
  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key) || key.split('/').includes('..')) {
      throw new Error(`invalid storage key: ${key}`);
    }
    const resolved = path.resolve(this.root, key);
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return resolved;
  }

  async put(key: string, data: Buffer | string): Promise<void> {
    const filePath = this.resolve(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async putStream(key: string, data: Readable): Promise<void> {
    const filePath = this.resolve(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(data, createWriteStream(filePath));
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async getStream(key: string, range?: ByteRange): Promise<Readable> {
    const filePath = this.resolve(key);
    await fs.access(filePath);
    return createReadStream(filePath, range ? { start: range.start, end: range.end } : {});
  }

  async stat(key: string): Promise<{ size: number }> {
    const info = await fs.stat(this.resolve(key));
    return { size: info.size };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(this.root, { recursive: true, withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path
          .relative(this.root, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join('/'),
      )
      .filter((key) => key.startsWith(prefix))
      .sort();
  }
}
