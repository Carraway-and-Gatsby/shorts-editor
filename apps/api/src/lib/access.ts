import type { JobRow } from '@shorts/db';

/**
 * 잡 접근 권한 (F-42): 같은 세션이거나, 로그인된 계정에 귀속된 잡이면 접근 가능.
 */
export function canAccessJob(
  job: JobRow,
  viewer: { sessionId: string; userId: string | null },
): boolean {
  if (job.sessionId === viewer.sessionId) {
    return true;
  }
  return job.userId !== null && job.userId === viewer.userId;
}
