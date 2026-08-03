import type { SubtitleBlock } from '../api';
import { formatSeconds } from '../ui';

interface Props {
  blocks: SubtitleBlock[];
  onChange: (blocks: SubtitleBlock[]) => void;
}

/** 자막 편집 (F-22): 텍스트 수정, 삭제, 표시 시간 ±0.5초 이동 */
export function SubtitleEditor({ blocks, onChange }: Props) {
  if (blocks.length === 0) {
    return <p style={{ color: '#64748b' }}>자막이 없습니다.</p>;
  }

  const update = (index: number, patch: Partial<SubtitleBlock>) => {
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const shift = (index: number, delta: number) => {
    const block = blocks[index];
    const start = Math.max(0, round1(block.start + delta));
    const end = round1(block.end + delta);
    if (end > start) {
      update(index, { start, end });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {blocks.map((block, i) => (
        <div key={block.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ minWidth: 96, fontVariantNumeric: 'tabular-nums', color: '#475569', fontSize: 13 }}>
            {formatSeconds(block.start)}–{formatSeconds(block.end)}
          </span>
          <button title="0.5초 앞으로" onClick={() => shift(i, -0.5)}>
            ◀
          </button>
          <button title="0.5초 뒤로" onClick={() => shift(i, 0.5)}>
            ▶
          </button>
          <input
            value={block.text}
            onChange={(e) => update(i, { text: e.target.value })}
            style={{ flex: 1, padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
          />
          <button title="블록 삭제" onClick={() => onChange(blocks.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
