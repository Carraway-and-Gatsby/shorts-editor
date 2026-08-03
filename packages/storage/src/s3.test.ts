/**
 * S3 드라이버 통합 테스트.
 * S3 호환 엔드포인트(S3_TEST_ENDPOINT — MinIO/moto 등)가 있을 때만 실행된다.
 * 로컬: `pip install 'moto[server]' && python -m moto.server -p 9001` 후
 *       S3_TEST_ENDPOINT=http://127.0.0.1:9001 pnpm --filter @shorts/storage test
 */
import { Readable } from 'node:stream';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { S3Storage } from './s3.js';

const ENDPOINT = process.env.S3_TEST_ENDPOINT;
const BUCKET = `shorts-test-${Date.now()}`;

describe.skipIf(!ENDPOINT)('S3Storage (integration)', () => {
  let storage: S3Storage;

  beforeAll(async () => {
    const client = new S3Client({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'testing', secretAccessKey: 'testing' },
    });
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
    storage = new S3Storage({
      bucket: BUCKET,
      endpoint: ENDPOINT,
      accessKeyId: 'testing',
      secretAccessKey: 'testing',
    });
  });

  it('round-trips put/get and stat', async () => {
    await storage.put('jobs/job_1/analysis.json', '{"ok":true}');
    expect((await storage.get('jobs/job_1/analysis.json')).toString()).toBe('{"ok":true}');
    expect(await storage.stat('jobs/job_1/analysis.json')).toEqual({ size: 11 });
  });

  it('round-trips streams with range support', async () => {
    await storage.putStream('jobs/job_1/source.mp4', Readable.from([Buffer.from('0123456789')]));
    const stream = await storage.getStream('jobs/job_1/source.mp4', { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).toString()).toBe('2345');
  });

  it('exists, delete, and list by prefix', async () => {
    await storage.put('jobs/job_2/proxy.mp4', 'a');
    await storage.put('jobs/job_2/output_r1.mp4', 'b');
    await storage.put('jobs/job_3/proxy.mp4', 'c');

    expect(await storage.exists('jobs/job_2/proxy.mp4')).toBe(true);
    expect(await storage.exists('jobs/nope')).toBe(false);
    expect(await storage.list('jobs/job_2/')).toEqual([
      'jobs/job_2/output_r1.mp4',
      'jobs/job_2/proxy.mp4',
    ]);

    await storage.delete('jobs/job_2/proxy.mp4');
    expect(await storage.exists('jobs/job_2/proxy.mp4')).toBe(false);
  });
});
