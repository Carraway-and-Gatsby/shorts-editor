import { useEffect, useState } from 'react';

interface HealthResponse {
  status: 'ok' | 'degraded';
  redis: 'up' | 'down';
  postgres: 'up' | 'down';
}

type ApiState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; health: HealthResponse };

export function App() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' });

  useEffect(() => {
    fetch('/api/v1/healthz')
      .then(async (res) => setApi({ kind: 'ready', health: (await res.json()) as HealthResponse }))
      .catch(() => setApi({ kind: 'error' }));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Shorts Editor</h1>
      <p>짧은 영상을 업로드하면 숏폼 규격(9:16)의 완성본으로 가공해 드립니다.</p>
      <p style={{ color: '#666' }}>업로드 기능은 M1 마일스톤에서 제공됩니다.</p>
      <section style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: 8 }}>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>시스템 상태</h2>
        {api.kind === 'loading' && <p>확인 중…</p>}
        {api.kind === 'error' && <p>API 서버에 연결할 수 없습니다.</p>}
        {api.kind === 'ready' && (
          <ul>
            <li>API: {api.health.status === 'ok' ? '정상' : '점검 필요'}</li>
            <li>Redis: {api.health.redis === 'up' ? '정상' : '연결 안 됨'}</li>
            <li>PostgreSQL: {api.health.postgres === 'up' ? '정상' : '연결 안 됨'}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
