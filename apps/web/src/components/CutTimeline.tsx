import { useRef } from 'react';
import type { Cut } from '../api';
import { formatSeconds } from '../ui';

interface Props {
  sourceDuration: number;
  cuts: Cut[];
  speech: Array<{ start: number; end: number }>;
  onChange: (cuts: Cut[]) => void;
}

const MIN_CUT_SECONDS = 0.5;
const MAX_TOTAL_SECONDS = 90;

/** 컷 범위 보정 타임라인 (F-21): 경계 드래그, 컷 추가/삭제 */
export function CutTimeline({ sourceDuration, cuts, speech, onChange }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  const toPercent = (t: number) => `${(t / sourceDuration) * 100}%`;
  const total = cuts.reduce((s, c) => s + (c.sourceEnd - c.sourceStart), 0);

  const startDrag = (cutIndex: number, edge: 'start' | 'end') => (down: React.PointerEvent) => {
    down.preventDefault();
    down.stopPropagation();
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const rect = bar.getBoundingClientRect();
    const secondsPerPx = sourceDuration / rect.width;
    const original = cuts[cutIndex];
    const originX = down.clientX;

    const onMove = (move: PointerEvent) => {
      const delta = (move.clientX - originX) * secondsPerPx;
      const next = cuts.map((c) => ({ ...c }));
      const cut = next[cutIndex];
      if (edge === 'start') {
        const min = cutIndex > 0 ? next[cutIndex - 1].sourceEnd : 0;
        cut.sourceStart = clamp(original.sourceStart + delta, min, cut.sourceEnd - MIN_CUT_SECONDS);
      } else {
        const max = cutIndex < next.length - 1 ? next[cutIndex + 1].sourceStart : sourceDuration;
        cut.sourceEnd = clamp(original.sourceEnd + delta, cut.sourceStart + MIN_CUT_SECONDS, max);
      }
      cut.sourceStart = round1(cut.sourceStart);
      cut.sourceEnd = round1(cut.sourceEnd);
      onChange(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const removeCut = (index: number) => {
    if (cuts.length > 1) {
      onChange(cuts.filter((_, i) => i !== index));
    }
  };

  const addCut = () => {
    // 가장 큰 빈 구간에 3초 컷 추가
    const gaps: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const cut of cuts) {
      if (cut.sourceStart - cursor > 1) {
        gaps.push({ start: cursor, end: cut.sourceStart });
      }
      cursor = cut.sourceEnd;
    }
    if (sourceDuration - cursor > 1) {
      gaps.push({ start: cursor, end: sourceDuration });
    }
    if (gaps.length === 0) {
      return;
    }
    const biggest = gaps.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    const length = Math.min(3, biggest.end - biggest.start - 0.2);
    const newCut: Cut = {
      id: `c${Date.now() % 100000}`,
      sourceStart: round1(biggest.start + 0.1),
      sourceEnd: round1(biggest.start + 0.1 + length),
      transition: 'cut',
    };
    onChange(
      [...cuts, newCut].sort((a, b) => a.sourceStart - b.sourceStart),
    );
  };

  return (
    <div>
      <div
        ref={barRef}
        style={{
          position: 'relative',
          height: 56,
          background: '#f1f5f9',
          borderRadius: 8,
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        {/* 발화 구간 표시 */}
        {speech.map((s, i) => (
          <div
            key={`speech-${i}`}
            title="발화 구간"
            style={{
              position: 'absolute',
              bottom: 0,
              height: 8,
              left: toPercent(s.start),
              width: toPercent(s.end - s.start),
              background: '#86efac',
            }}
          />
        ))}
        {/* 컷 블록 */}
        {cuts.map((cut, i) => (
          <div
            key={cut.id}
            style={{
              position: 'absolute',
              top: 6,
              height: 36,
              left: toPercent(cut.sourceStart),
              width: toPercent(cut.sourceEnd - cut.sourceStart),
              background: '#3b82f6cc',
              borderRadius: 6,
              color: '#fff',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
            }}
          >
            <div
              onPointerDown={startDrag(i, 'start')}
              style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 10, cursor: 'ew-resize', background: '#1d4ed8', borderRadius: '6px 0 0 6px' }}
            />
            {formatSeconds(cut.sourceStart)}–{formatSeconds(cut.sourceEnd)}
            <div
              onPointerDown={startDrag(i, 'end')}
              style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 10, cursor: 'ew-resize', background: '#1d4ed8', borderRadius: '0 6px 6px 0' }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ color: total > MAX_TOTAL_SECONDS ? '#dc2626' : '#334155' }}>
          총 {total.toFixed(1)}초 {total > MAX_TOTAL_SECONDS ? '(최대 90초 초과!)' : ''}
        </span>
        <button onClick={addCut}>+ 컷 추가</button>
        {cuts.map((cut, i) => (
          <button key={cut.id} onClick={() => removeCut(i)} disabled={cuts.length === 1}>
            {i + 1}번 컷 삭제
          </button>
        ))}
      </div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
