import { useEffect, useRef, useState } from 'react';
import {
  completeUpload,
  createUpload,
  getBgmTracks,
  getPresets,
  uploadChunks,
  type BgmTrackInfo,
  type JobOptionsInput,
  type PresetInfo,
} from '../api';
import { Panel, ProgressBar } from '../ui';

interface Props {
  onJobCreated: (jobId: string) => void;
  onError: (message: string) => void;
}

/** 업로드 + 생성 옵션 (F-01, F-03) */
export function UploadView({ onJobCreated, onError }: Props) {
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [bgmTracks, setBgmTracks] = useState<BgmTrackInfo[]>([]);
  const [targetDuration, setTargetDuration] = useState<'auto' | number>('auto');
  const [preset, setPreset] = useState('clean');
  const [subtitle, setSubtitle] = useState(true);
  const [bgm, setBgm] = useState('auto');
  const [uploading, setUploading] = useState<number | null>(null);

  useEffect(() => {
    getPresets().then(setPresets).catch(() => {});
    getBgmTracks().then(setBgmTracks).catch(() => {});
  }, []);

  const handleFile = async (file: File) => {
    try {
      setUploading(0);
      const session = await createUpload(file);
      await uploadChunks(file, session, setUploading);
      const options: JobOptionsInput = {
        targetDuration,
        preset,
        subtitle: subtitle ? 'on' : 'off',
        bgm,
      };
      const { jobId } = await completeUpload(session.uploadId, options);
      onJobCreated(jobId);
    } catch (err) {
      setUploading(null);
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  if (uploading !== null) {
    return (
      <Panel title="업로드 중">
        <ProgressBar ratio={uploading} />
        <p>{Math.round(uploading * 100)}%</p>
      </Panel>
    );
  }

  const selectStyle = { padding: '0.35rem', borderRadius: 6, border: '1px solid #ccc' };

  return (
    <>
      <Panel title="생성 옵션">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <label>
            길이{' '}
            <select
              style={selectStyle}
              value={String(targetDuration)}
              onChange={(e) =>
                setTargetDuration(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
              }
            >
              <option value="auto">자동 (최대 60초)</option>
              <option value="15">15초</option>
              <option value="30">30초</option>
              <option value="60">60초</option>
              <option value="90">90초</option>
            </select>
          </label>
          <label>
            스타일{' '}
            <select style={selectStyle} value={preset} onChange={(e) => setPreset(e.target.value)}>
              {(presets.length > 0 ? presets : [{ id: 'clean', name: '클린' } as PresetInfo]).map(
                (p) => (
                  <option key={p.id} value={p.id} title={p.description}>
                    {p.name}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={subtitle}
              onChange={(e) => setSubtitle(e.target.checked)}
            />{' '}
            자동 자막
          </label>
          <label>
            BGM{' '}
            <select style={selectStyle} value={bgm} onChange={(e) => setBgm(e.target.value)}>
              <option value="auto">자동 선택</option>
              <option value="off">사용 안 함</option>
              {bgmTracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Panel>
      <UploadBox onFile={handleFile} />
    </>
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
        marginTop: '1.5rem',
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
