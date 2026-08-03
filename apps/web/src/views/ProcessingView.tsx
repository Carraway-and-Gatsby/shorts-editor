import { useEffect, useState } from 'react';
import { watchJob } from '../api';
import { Panel, ProgressBar } from '../ui';

const STAGE_LABELS: Record<string, string> = {
  ingest: '영상 확인 중',
  analyze: '분석 중',
  compose: '편집 구성 중',
  render: '렌더링 중',
};

interface Props {
  jobId: string;
  onDone: () => void;
  onFailed: (message: string) => void;
}

/** 잡 진행률 표시 (F-40, SSE) */
export function ProcessingView({ jobId, onDone, onFailed }: Props) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);

  useEffect(() => {
    const unwatch = watchJob(jobId, {
      onProgress: (e) => {
        setProgress(e.progress);
        setStage(e.stage);
      },
      onDone,
      onFailed: (error) => onFailed(error.message ?? '처리 중 오류가 발생했습니다.'),
      onConnectionError: () =>
        onFailed('서버 연결이 끊어졌습니다. 새로고침 후 다시 시도해 주세요.'),
    });
    return unwatch;
  }, [jobId, onDone, onFailed]);

  return (
    <Panel title="숏폼 생성 중">
      <ProgressBar ratio={progress / 100} />
      <p>
        {progress}% — {(stage && STAGE_LABELS[stage]) ?? '대기 중'}
      </p>
    </Panel>
  );
}
