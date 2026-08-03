import { useCallback, useEffect, useState } from 'react';
import { getMe, logout, type UserInfo } from './api';
import { Panel } from './ui';
import { AuthView } from './views/AuthView';
import { HistoryView } from './views/HistoryView';
import { ProcessingView } from './views/ProcessingView';
import { ResultView } from './views/ResultView';
import { UploadView } from './views/UploadView';

type View =
  | { name: 'home' }
  | { name: 'history' }
  | { name: 'auth' }
  | { name: 'processing'; jobId: string }
  | { name: 'result'; jobId: string }
  | { name: 'error'; message: string };

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    getMe()
      .then((r) => setUser(r.user))
      .catch(() => {});
  }, []);

  const showError = useCallback((message: string) => setView({ name: 'error', message }), []);

  const handleLogout = async () => {
    await logout().catch(() => {});
    setUser(null);
    setView({ name: 'home' });
  };

  const navButton = (label: string, target: View, active: boolean) => (
    <button
      onClick={() => setView(target)}
      style={{
        padding: '0.4rem 0.9rem',
        borderRadius: 8,
        border: '1px solid #cbd5e1',
        background: active ? '#e0e7ff' : '#fff',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '2.5rem auto',
        padding: '0 1rem 4rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}>Shorts Editor</h1>
        <nav style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {navButton('새로 만들기', { name: 'home' }, view.name === 'home')}
          {navButton('내 작업', { name: 'history' }, view.name === 'history')}
          {user ? (
            <span style={{ fontSize: 13, color: '#475569' }}>
              {user.email}{' '}
              <button onClick={() => void handleLogout()} style={{ marginLeft: 4 }}>
                로그아웃
              </button>
            </span>
          ) : (
            navButton('로그인', { name: 'auth' }, view.name === 'auth')
          )}
        </nav>
      </header>
      <p style={{ color: '#475569' }}>
        짧은 영상을 업로드하면 하이라이트 컷·자막·BGM이 입혀진 숏폼(9:16)으로 만들어 드립니다.
      </p>

      {view.name === 'home' && (
        <UploadView
          onJobCreated={(jobId) => setView({ name: 'processing', jobId })}
          onError={showError}
        />
      )}

      {view.name === 'auth' && (
        <AuthView
          onAuthed={() => {
            getMe()
              .then((r) => setUser(r.user))
              .catch(() => {});
            setView({ name: 'history' });
          }}
        />
      )}

      {view.name === 'history' && (
        <HistoryView
          onOpen={(jobId, status) =>
            setView(status === 'DONE' ? { name: 'result', jobId } : { name: 'processing', jobId })
          }
        />
      )}

      {view.name === 'processing' && (
        <ProcessingView
          jobId={view.jobId}
          onDone={() => setView({ name: 'result', jobId: view.jobId })}
          onFailed={showError}
        />
      )}

      {view.name === 'result' && (
        <ResultView
          jobId={view.jobId}
          onRerender={() => setView({ name: 'processing', jobId: view.jobId })}
          onError={showError}
        />
      )}

      {view.name === 'error' && (
        <Panel title="오류">
          <p style={{ color: '#dc2626' }}>{view.message}</p>
          <button onClick={() => setView({ name: 'home' })}>처음으로</button>
        </Panel>
      )}
    </main>
  );
}
