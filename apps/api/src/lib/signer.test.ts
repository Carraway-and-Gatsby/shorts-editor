import { describe, expect, it } from 'vitest';
import { FileTokenSigner } from './signer.js';

const signer = new FileTokenSigner('test-secret');

describe('FileTokenSigner', () => {
  it('round-trips a valid token', () => {
    const payload = {
      key: 'jobs/job_1/output_r1.mp4',
      exp: Math.floor(Date.now() / 1000) + 3600,
      disposition: 'attachment' as const,
      filename: 'shorts.mp4',
    };
    const token = signer.sign(payload);
    expect(signer.verify(token)).toEqual(payload);
  });

  it('rejects a tampered token', () => {
    const token = signer.sign({
      key: 'jobs/job_1/output_r1.mp4',
      exp: Math.floor(Date.now() / 1000) + 3600,
      disposition: 'inline',
    });
    const tampered = Buffer.from(
      JSON.stringify({ key: 'jobs/job_OTHER/output_r1.mp4', exp: 9999999999, disposition: 'inline' }),
    ).toString('base64url');
    expect(signer.verify(`${tampered}.${token.split('.')[1]}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signer.sign({
      key: 'jobs/job_1/thumbnail.jpg',
      exp: Math.floor(Date.now() / 1000) - 10,
      disposition: 'inline',
    });
    expect(signer.verify(token)).toBeNull();
  });

  it('rejects tokens signed with another secret', () => {
    const other = new FileTokenSigner('other-secret');
    const token = other.sign({
      key: 'jobs/job_1/output_r1.mp4',
      exp: Math.floor(Date.now() / 1000) + 3600,
      disposition: 'inline',
    });
    expect(signer.verify(token)).toBeNull();
  });

  it('rejects garbage tokens', () => {
    expect(signer.verify('')).toBeNull();
    expect(signer.verify('abc')).toBeNull();
    expect(signer.verify('abc.def')).toBeNull();
  });
});
