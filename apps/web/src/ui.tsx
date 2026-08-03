/** 공용 소형 컴포넌트 */

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{ marginTop: '1.5rem', padding: '1.25rem', border: '1px solid #ddd', borderRadius: 12 }}
    >
      <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>{title}</h2>
      {children}
    </section>
  );
}

export function ProgressBar({ ratio }: { ratio: number }) {
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

export function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '0.55rem 1.1rem',
        background: disabled ? '#94a3b8' : '#2563eb',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        cursor: disabled ? 'default' : 'pointer',
        fontSize: '0.95rem',
      }}
    >
      {children}
    </button>
  );
}

export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
