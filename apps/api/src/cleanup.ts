import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from './deps.js';

const BATCH_LIMIT = 100;

/** 정리 대상에서 제외할 키인지 (썸네일은 이력 표시용으로 보존, docs/07-data-model.md §7.5) */
export function isPreservedKey(key: string): boolean {
  return key.endsWith('/thumbnail.jpg') || key.endsWith('_thumb.jpg');
}

/**
 * 보관 정책 배치 (F-41):
 * 보관 기한(expires_at)이 지난 잡의 파일(원본/프록시/분석/출력물)을 삭제하고
 * 메타데이터와 썸네일은 유지한다.
 */
export async function runCleanup(
  deps: Pick<AppDeps, 'repos' | 'storage'>,
  logger?: FastifyBaseLogger,
  now: Date = new Date(),
): Promise<{ cleanedJobs: number; deletedFiles: number }> {
  const expired = await deps.repos.jobs.listExpired(now, BATCH_LIMIT);
  let deletedFiles = 0;

  for (const job of expired) {
    const keys = await deps.storage.list(`jobs/${job.id}/`);
    for (const key of keys) {
      if (isPreservedKey(key)) {
        continue;
      }
      await deps.storage.delete(key).catch(() => {});
      deletedFiles++;
    }
    for (const output of await deps.repos.jobs.listOutputs(job.id)) {
      await deps.repos.jobs.markOutputDeleted(output.jobId, output.revision);
    }
    await deps.repos.jobs.markCleaned(job.id);
    logger?.info({ jobId: job.id }, 'cleaned expired job artifacts');
  }

  return { cleanedJobs: expired.length, deletedFiles };
}

/** 일 단위 정리 배치 시작. intervalHours 0이면 비활성화. */
export function scheduleCleanup(
  deps: Pick<AppDeps, 'repos' | 'storage'>,
  intervalHours: number,
  logger?: FastifyBaseLogger,
): NodeJS.Timeout | null {
  if (intervalHours <= 0) {
    return null;
  }
  const run = () =>
    runCleanup(deps, logger).catch((err) => {
      logger?.error({ err }, 'cleanup batch failed');
    });
  void run();
  const timer = setInterval(run, intervalHours * 3600 * 1000);
  timer.unref();
  return timer;
}
