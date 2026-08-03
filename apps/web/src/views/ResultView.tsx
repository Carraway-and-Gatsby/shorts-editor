import { useCallback, useEffect, useState } from 'react';
import {
  getBgmTracks,
  getComposition,
  getDownloadUrl,
  getPresets,
  getRevisions,
  patchComposition,
  startRender,
  type BgmTrackInfo,
  type CompositionView,
  type Cut,
  type PresetInfo,
  type RevisionInfo,
  type SubtitleBlock,
} from '../api';
import { CutTimeline } from '../components/CutTimeline';
import { SubtitleEditor } from '../components/SubtitleEditor';
import { Panel, PrimaryButton } from '../ui';

interface Props {
  jobId: string;
  onRerender: () => void;
  onError: (message: string) => void;
}

/** 결과 미리보기 + 보정 (F-20, F-21, F-22, F-24) */
export function ResultView({ jobId, onRerender, onError }: Props) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [view, setView] = useState<CompositionView | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [blocks, setBlocks] = useState<SubtitleBlock[]>([]);
  const [revisions, setRevisions] = useState<RevisionInfo[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [bgmTracks, setBgmTracks] = useState<BgmTrackInfo[]>([]);
  const [presetChoice, setPresetChoice] = useState('clean');
  const [bgmChoice, setBgmChoice] = useState('auto');

  const load = useCallback(async () => {
    try {
      const [url, composition, revisionList] = await Promise.all([
        getDownloadUrl(jobId),
        getComposition(jobId),
        getRevisions(jobId),
      ]);
      setVideoUrl(url);
      setView(composition);
      setCuts(composition.composition.cuts);
      setBlocks(composition.composition.subtitles.blocks);
      setPresetChoice(composition.composition.style.preset);
      setBgmChoice(composition.composition.audio.bgm?.trackId ?? 'off');
      setRevisions(revisionList);
      setSelectedRevision(revisionList[0]?.revision ?? null);
      setDirty(composition.hasDraft);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [jobId, onError]);

  useEffect(() => {
    void load();
    getPresets().then(setPresets).catch(() => {});
    getBgmTracks().then(setBgmTracks).catch(() => {});
  }, [load]);

  const applyStyle = async () => {
    try {
      setBusy(true);
      const updated = await patchComposition(jobId, {
        style: { preset: presetChoice },
        audio: { bgm: bgmChoice },
      });
      setView(updated);
      setBlocks(updated.composition.subtitles.blocks);
      setBgmChoice(updated.composition.audio.bgm?.trackId ?? 'off');
      setDirty(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectRevision = async (revision: number) => {
    try {
      setSelectedRevision(revision);
      setVideoUrl(await getDownloadUrl(jobId, revision));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const applyCuts = async () => {
    try {
      setBusy(true);
      const updated = await patchComposition(jobId, { cuts });
      setView(updated);
      setCuts(updated.composition.cuts);
      setBlocks(updated.composition.subtitles.blocks);
      setDirty(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applySubtitles = async () => {
    try {
      setBusy(true);
      const updated = await patchComposition(jobId, { subtitles: { blocks } });
      setView(updated);
      setBlocks(updated.composition.subtitles.blocks);
      setDirty(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rerender = async () => {
    try {
      setBusy(true);
      await startRender(jobId);
      onRerender();
    } catch (err) {
      setBusy(false);
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!view) {
    return <Panel title="결과 불러오는 중">잠시만요…</Panel>;
  }

  return (
    <>
      <Panel title="완성본 미리보기">
        {revisions.length > 1 && (
          <p>
            리비전:{' '}
            {revisions.map((r) => (
              <button
                key={r.revision}
                onClick={() => void selectRevision(r.revision)}
                style={{
                  marginRight: 6,
                  fontWeight: selectedRevision === r.revision ? 700 : 400,
                }}
              >
                r{r.revision}
              </button>
            ))}
          </p>
        )}
        {videoUrl && (
          <video
            key={videoUrl}
            src={videoUrl}
            controls
            playsInline
            style={{ width: '100%', maxWidth: 320, aspectRatio: '9 / 16', background: '#000', borderRadius: 8 }}
          />
        )}
        <p>
          {videoUrl && (
            <a
              href={videoUrl}
              download
              style={{
                display: 'inline-block',
                padding: '0.55rem 1.1rem',
                background: '#0f766e',
                color: '#fff',
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              MP4 다운로드
            </a>
          )}
        </p>
      </Panel>

      {view.analysisSummary && (
        <Panel title="컷 보정">
          <CutTimeline
            sourceDuration={view.analysisSummary.sourceDuration}
            cuts={cuts}
            speech={view.analysisSummary.speech}
            onChange={setCuts}
          />
          <p style={{ marginBottom: 0 }}>
            <PrimaryButton onClick={() => void applyCuts()} disabled={busy}>
              컷 적용 (자막 자동 재계산)
            </PrimaryButton>
          </p>
        </Panel>
      )}

      <Panel title="자막 편집">
        <SubtitleEditor blocks={blocks} onChange={setBlocks} />
        {blocks.length > 0 && (
          <p style={{ marginBottom: 0 }}>
            <PrimaryButton onClick={() => void applySubtitles()} disabled={busy}>
              자막 적용
            </PrimaryButton>
          </p>
        )}
      </Panel>

      <Panel title="스타일 교체">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            프리셋{' '}
            <select value={presetChoice} onChange={(e) => setPresetChoice(e.target.value)}>
              {(presets.length > 0 ? presets : [{ id: presetChoice, name: presetChoice } as PresetInfo]).map(
                (p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            BGM{' '}
            <select value={bgmChoice} onChange={(e) => setBgmChoice(e.target.value)}>
              <option value="off">사용 안 함</option>
              <option value="auto">자동 선택</option>
              {bgmTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <PrimaryButton onClick={() => void applyStyle()} disabled={busy}>
            스타일 적용
          </PrimaryButton>
        </div>
      </Panel>

      <Panel title="다시 만들기">
        <p style={{ color: '#64748b' }}>
          {dirty
            ? '보정 사항이 저장되어 있습니다. 다시 만들기를 누르면 새 리비전으로 렌더링됩니다.'
            : '보정 없이 다시 만들면 동일한 편집으로 새 리비전이 생성됩니다.'}
        </p>
        <PrimaryButton onClick={() => void rerender()} disabled={busy}>
          다시 만들기 (재렌더링)
        </PrimaryButton>
      </Panel>
    </>
  );
}
