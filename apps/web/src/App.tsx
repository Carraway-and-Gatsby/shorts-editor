import { useCallback, useEffect, useRef, useState } from 'react';
import {
  completeUpload,
  createUpload,
  getDownloadUrl,
  uploadChunks,
  watchJob,
  type JobProgressEvent,
} from './api';

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; ratio: number }
  | { kind: 'processing'; jobId: string; progress: number; stage: string | null }
  | { kind: 'done'; jobId: string; url: string }
  | { kind: 'error'; message: string };

const STAGE_LABELS: Record<string, string> = {
  ingest: '영상 확인 중',
  analyze: '분석 중',
  compose: '편집 구성 중',
  render: '렌더링 중',
};

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const unwatchRef = useRef<(() => void) | null>(null);

  useEffect(() => () => unwatchRef.current?.(), []);

  const startProcessing = useCallback((jobId: string) => {
    setPhase({ kind: 'processing', jobId, progress: 0, stage: null });
    unwatchRef.current = watchJob(jobId, {
      onProgress: (event: JobProgressEvent) => {
        setPhase({ kind: 'processing', jobId, progress: event.progress, stage: event.stage });
      },
      onDone: () => {
        void getDownloadUrl(jobId)
          .then((url) => setPhase({ kind: 'done', jobId, url }))
          .catch((err: Error) => setPhase({ kind: 'error', message: err.message }));
      },
      onFailed: (error) => {
        setPhase({
          kind: 'error',
          message: error.message ?? '처리 중 오류가 발생했습니다.',
        });
      },
      onConnectionError: () => {
        setPhase({ kind: 'error', message: '서버 연결이 끊어졌습니다. 새로고침 후 다시 시도해 주세요.' });
      },
    });
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      try {
        setPhase({ kind: 'uploading', ratio: 0 });
        const session = await createUpload(file);
        await uploadChunks(file, session, (ratio) => setPhase({ kind: 'uploading', ratio }));
        const { jobId } = await completeUpload(session.uploadId);
        startProcessing(jobId);
      } catch (err) {
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    },
    [startProcessing],
  );

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '3rem auto',
        padding: '0 1rem',
      }}
    >
      <h1>Shorts Editor</h1>
      <p>짧은 영상을 업로드하면 숏폼 규격(9:16, 1080×1920)의 완성본으로 가공해 드립니다.</p>

      {phase.kind === 'idle' && <UploadBox onFile={handleFile} />}

      {phase.kind === 'uploading' && (
        <Panel title="업로드 중">
          <ProgressBar ratio={phase.ratio} />
          <p>{Math.round(phase.ratio * 100)}%</p>
        </Panel>
      )}

      {phase.kind === 'processing' && (
        <Panel title="숏폼 생성 중">
          <ProgressBar ratio={phase.progress / 100} />
          <p>
            {phase.progress}% — {(phase.stage && STAGE_LABELS[phase.stage]) ?? '대기 중'}
          </p>
        </Panel>
      )}

      {phase.kind === 'done' && (
        <Panel title="완성!">
          <video
            src={phase.url}
            controls
            playsInline
            style={{ width: '100%', maxWidth: 320, aspectRatio: '9 / 16', background: '#000', borderRadius: 8 }}
          />
          <p>
            <a
              href={phase.url}
              download
              style={{
                display: 'inline-block',
                padding: '0.6rem 1.2rem',
                background: '#2563eb',
                color: '#fff',
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              MP4 다운로드
            </a>
          </p>
          <p>
            <button onClick={() => setPhase({ kind: 'idle' })}>다른 영상 만들기</button>
          </p>
        </Panel>
      )}

      {phase.kind === 'error' && (
        <Panel title="오류">
          <p style={{ color: '#dc2626' }}>{phase.message}</p>
          <button onClick={() => setPhase({ kind: 'idle' })}>다시 시도</button>
        </Panel>
      )}
    </main>
  );
}

function UploadBox({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) {
          onFile(file);
        }
      }}
      onClick={() => inputRef.current?.click()}
      style={{
        marginTop: '2rem',
        padding: '3rem 1rem',
        border: `2px dashed ${dragOver ? '#2563eb' : '#bbb'}`,
        borderRadius: 12,
        textAlign: 'center',
        cursor: 'pointer',
        background: dragOver ? '#eff6ff' : '#fafafa',
      }}
    >
      <p style={{ fontSize: '1.1rem', margin: 0 }}>영상 파일을 끌어다 놓거나 클릭해서 선택</p>
      <p style={{ color: '#666' }}>MP4 · MOV · WebM · MKV · AVI, 최대 2GB, 3초~10분</p>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mp4,.mov,.webm,.mkv,.avi"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onFile(file);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: '2rem', padding: '1.5rem', border: '1px solid #ddd', borderRadius: 12 }}>
      <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>{title}</h2>
      {children}
    </section>
  );
}

function ProgressBar({ ratio }: { ratio: number }) {
  return (
    <div style={{ height: 10, background: '#eee', borderRadius: 5, overflow: 'hidden' }}>
      <div
        style={{
          width: `${Math.min(100, Math.max(0, ratio * 100))}%`,
          height: '100%',
          background: '#2563eb',
          transition: 'width 0.3s',
        }}
      />
    </div>
  );
}
