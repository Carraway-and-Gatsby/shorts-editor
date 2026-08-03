import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFsStorage } from './local-fs.js';
import { storageKeys } from './storage.js';

describe('LocalFsStorage', () => {
  let root: string;
  let storage: LocalFsStorage;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'shorts-storage-'));
    storage = new LocalFsStorage(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round-trips put/get', async () => {
    await storage.put('jobs/job_1/analysis.json', '{"ok":true}');
    const data = await storage.get('jobs/job_1/analysis.json');
    expect(data.toString()).toBe('{"ok":true}');
  });

  it('round-trips stream put/get', async () => {
    await storage.putStream('jobs/job_1/source.mp4', Readable.from([Buffer.from('vidbytes')]));
    const stream = await storage.getStream('jobs/job_1/source.mp4');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).toString()).toBe('vidbytes');
  });

  it('reports size via stat and serves byte ranges', async () => {
    await storage.put('jobs/job_1/source.mp4', '0123456789');
    expect(await storage.stat('jobs/job_1/source.mp4')).toEqual({ size: 10 });
    const stream = await storage.getStream('jobs/job_1/source.mp4', { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).toString()).toBe('2345');
  });

  it('reports existence and deletes', async () => {
    const key = storageKeys.thumbnail('job_1');
    expect(await storage.exists(key)).toBe(false);
    await storage.put(key, 'jpg');
    expect(await storage.exists(key)).toBe(true);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('lists keys under a prefix, files only', async () => {
    await storage.put('jobs/job_1/proxy.mp4', 'a');
    await storage.put('jobs/job_1/output_r1.mp4', 'b');
    await storage.put('jobs/job_2/proxy.mp4', 'c');
    expect(await storage.list('jobs/job_1/')).toEqual([
      'jobs/job_1/output_r1.mp4',
      'jobs/job_1/proxy.mp4',
    ]);
  });

  it('returns an empty list for a missing root', async () => {
    const empty = new LocalFsStorage(path.join(root, 'does-not-exist'));
    expect(await empty.list('jobs/')).toEqual([]);
  });

  it('rejects keys that escape the root', async () => {
    await expect(storage.put('../outside.txt', 'x')).rejects.toThrow(/invalid storage key/);
    await expect(storage.put('jobs/../../outside.txt', 'x')).rejects.toThrow(/invalid storage key/);
    await expect(storage.put('/etc/passwd', 'x')).rejects.toThrow(/invalid storage key/);
  });

  it('builds storage keys per the documented convention', () => {
    expect(storageKeys.source('job_9', 'mov')).toBe('jobs/job_9/source.mov');
    expect(storageKeys.output('job_9', 2)).toBe('jobs/job_9/output_r2.mp4');
    expect(storageKeys.outputThumbnail('job_9', 2)).toBe('jobs/job_9/output_r2_thumb.jpg');
  });
});
