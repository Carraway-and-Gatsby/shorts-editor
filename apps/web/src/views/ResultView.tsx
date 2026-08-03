import { useCallback, useEffect, useState } from 'react';
import {
  getComposition,
  getDownloadUrl,
  getRevisions,
  patchComposition,
  startRender,
  type CompositionView,
  type Cut,
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
      setRevisions(revisionList);
      setSelectedRevision(revisionList[0]?.revision ?? null);
      setDirty(composition.hasDraft);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [jobId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

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
