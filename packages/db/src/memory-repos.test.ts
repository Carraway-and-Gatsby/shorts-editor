import { describe, expect, it } from 'vitest';
import { createMemoryRepos } from './memory-repos.js';
import type { JobOptions } from './types.js';

const OPTIONS: JobOptions = {
  targetDuration: 'auto',
  preset: 'clean',
  subtitle: 'on',
  bgm: 'auto',
  reframe: 'auto',
  language: 'auto',
};

function futureDate(): Date {
  return new Date(Date.now() + 7 * 24 * 3600 * 1000);
}

describe('memory jobs repo', () => {
  it('creates jobs in QUEUED status', async () => {
    const repos = createMemoryRepos();
    const job = await repos.jobs.create({
      id: 'job_1',
      sessionId: 'ses_1',
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: futureDate(),
    });
    expect(job.status).toBe('QUEUED');
    expect(job.currentRevision).toBe(0);
  });

  it('transitions only from the expected status', async () => {
    const repos = createMemoryRepos();
    await repos.jobs.create({
      id: 'job_1',
      sessionId: 'ses_1',
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: futureDate(),
    });
    expect(await repos.jobs.transition('job_1', 'QUEUED', 'ANALYZING', { stage: 'ingest' })).toBe(
      true,
    );
    // 중복 워커가 같은 전이를 다시 시도하면 실패해야 한다
    expect(await repos.jobs.transition('job_1', 'QUEUED', 'ANALYZING')).toBe(false);
    const job = await repos.jobs.find('job_1');
    expect(job?.status).toBe('ANALYZING');
    expect(job?.stage).toBe('ingest');
  });

  it('does not fail a job that already succeeded', async () => {
    const repos = createMemoryRepos();
    await repos.jobs.create({
      id: 'job_1',
      sessionId: 'ses_1',
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: futureDate(),
    });
    await repos.jobs.transition('job_1', 'QUEUED', 'ANALYZING');
    await repos.jobs.transition('job_1', 'ANALYZING', 'COMPOSING');
    await repos.jobs.transition('job_1', 'COMPOSING', 'RENDERING');
    await repos.jobs.transition('job_1', 'RENDERING', 'DONE');
    await repos.jobs.fail('job_1', 'RENDER_FAILED', 'should not apply');
    expect((await repos.jobs.find('job_1'))?.status).toBe('DONE');
  });

  it('tracks composition revisions and bumps current_revision', async () => {
    const repos = createMemoryRepos();
    await repos.jobs.create({
      id: 'job_1',
      sessionId: 'ses_1',
      options: OPTIONS,
      sourceExt: 'mp4',
      expiresAt: futureDate(),
    });
    const composition = {
      version: 1 as const,
      jobId: 'job_1',
      revision: 1,
      output: { width: 1080, height: 1920, fps: 30, duration: 10 },
      cuts: [{ id: 'c1', sourceStart: 0, sourceEnd: 10, transition: 'cut' as const }],
      reframe: { mode: 'pad' as const, keyframes: [] },
      subtitles: { style: 'clean', blocks: [] },
      audio: { bgm: null, loudnessTarget: -14 },
      style: { preset: 'clean', titleCard: null, lut: null },
    };
    await repos.jobs.insertComposition('job_1', 1, composition, 'auto');
    expect((await repos.jobs.find('job_1'))?.currentRevision).toBe(1);
    expect(await repos.jobs.getComposition('job_1', 1)).toEqual(composition);
    await expect(repos.jobs.insertComposition('job_1', 1, composition, 'auto')).rejects.toThrow();
  });
});
