import { useEffect, useState } from 'react';
import { listJobs, type JobSummary } from '../api';
import { Panel } from '../ui';

const STATUS_LABELS: Record<string, string> = {
  QUEUED: '대기 중',
  ANALYZING: '분석 중',
  COMPOSING: '구성 중',
  RENDERING: '렌더링 중',
  DONE: '완료',
  FAILED: '실패',
  CANCELED: '취소됨',
};

interface Props {
  onOpen: (jobId: string, status: string) => void;
}

/** 잡 이력 (F-41) */
export function HistoryView({ onOpen }: Props) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);

  useEffect(() => {
    listJobs()
      .then((page) => setJobs(page.jobs))
      .catch(() => setJobs([]));
  }, []);

  if (jobs === null) {
    return <Panel title="내 작업">불러오는 중…</Panel>;
  }
  if (jobs.length === 0) {
    return <Panel title="내 작업">아직 만든 숏폼이 없습니다.</Panel>;
  }

  return (
    <Panel title="내 작업">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {jobs.map((job) => {
          const clickable = job.status === 'DONE' || job.status === 'FAILED' ? job.status === 'DONE' : true;
          return (
            <div
              key={job.jobId}
              onClick={() => clickable && onOpen(job.jobId, job.status)}
              style={{
                display: 'flex',
                gap: '0.75rem',
                alignItems: 'center',
                padding: '0.5rem',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                cursor: clickable ? 'pointer' : 'default',
                opacity: job.status === 'FAILED' ? 0.6 : 1,
              }}
            >
              <img
                src={job.thumbnailUrl}
                alt=""
                style={{ width: 72, height: 40, objectFit: 'cover', borderRadius: 4, background: '#e2e8f0' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.visibility = 'hidden';
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}>
                  {new Date(job.createdAt).toLocaleString('ko-KR')} · {job.preset}
                  {job.duration ? ` · ${job.duration.toFixed(0)}초` : ''}
                </div>
                <div style={{ fontSize: 13, color: job.status === 'FAILED' ? '#dc2626' : '#475569' }}>
                  {STATUS_LABELS[job.status] ?? job.status}
                  {job.status !== 'DONE' && job.status !== 'FAILED' ? ` (${job.progress}%)` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
