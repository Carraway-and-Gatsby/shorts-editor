import { useState } from 'react';
import { login, signup } from '../api';
import { Panel, PrimaryButton } from '../ui';

interface Props {
  onAuthed: () => void;
}

/** 로그인/가입 (F-42). 가입·로그인 시 현재 세션의 작업이 계정으로 병합된다. */
export function AuthView({ onAuthed }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    try {
      setBusy(true);
      setError(null);
      await (mode === 'login' ? login(email, password) : signup(email, password));
      onAuthed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '0.5rem',
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    boxSizing: 'border-box' as const,
  };

  return (
    <Panel title={mode === 'login' ? '로그인' : '가입하기'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: 360 }}>
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="비밀번호 (8자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          style={inputStyle}
        />
        {error && <p style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <PrimaryButton onClick={() => void submit()} disabled={busy}>
            {mode === 'login' ? '로그인' : '가입'}
          </PrimaryButton>
          <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? '계정이 없나요? 가입하기' : '이미 계정이 있나요? 로그인'}
          </button>
        </div>
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>
          {mode === 'signup'
            ? '가입하면 이 브라우저에서 만든 작업이 계정으로 옮겨지고, 다른 기기에서도 이어서 쓸 수 있습니다.'
            : '로그인하면 이 브라우저의 작업이 계정 이력에 병합됩니다.'}
        </p>
      </div>
    </Panel>
  );
}
