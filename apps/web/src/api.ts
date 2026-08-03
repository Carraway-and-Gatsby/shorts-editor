/** API 클라이언트 (docs/06-api-spec.md 응답 형태 기준) */

export interface UploadSession {
  uploadId: string;
  chunkSize: number;
  expiresAt: string;
}

export interface JobOptionsInput {
  targetDuration?: number | 'auto';
  preset?: string;
  subtitle?: 'on' | 'off';
  bgm?: string;
  profanityMask?: 'on' | 'off';
}

export interface UserInfo {
  email: string;
}

export interface JobProgressEvent {
  status: string;
  progress: number;
  stage: string | null;
}

export interface JobFailedError {
  code: string | null;
  message: string | null;
}

export interface JobDetail {
  jobId: string;
  status: string;
  progress: number;
  stage: string | null;
  createdAt: string;
  source: { duration: number; width: number; height: number; hasAudio: boolean } | null;
  options: { preset: string; targetDuration: number | 'auto' };
  currentRevision: number;
  result: {
    revision: number;
    duration: number | null;
    thumbnailUrl: string | null;
    downloadUrl: null;
  } | null;
  error: JobFailedError | null;
}

export interface JobSummary {
  jobId: string;
  status: string;
  progress: number;
  createdAt: string;
  preset: string;
  duration: number | null;
  thumbnailUrl: string;
}

export interface Cut {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  transition: 'cut' | 'crossfade';
}

export interface SubtitleBlock {
  id: string;
  start: number;
  end: number;
  text: string;
  words: unknown[];
}

export interface CompositionView {
  composition: {
    cuts: Cut[];
    output: { duration: number };
    subtitles: { style: string; blocks: SubtitleBlock[] };
    style: { preset: string };
    audio: { bgm: { trackId: string } | null };
  };
  hasDraft: boolean;
  analysisSummary: {
    sourceDuration: number;
    speech: Array<{ start: number; end: number }>;
    silences: Array<{ start: number; end: number }>;
  } | null;
}

export interface PresetInfo {
  id: string;
  name: string;
  description: string;
  titleCard: boolean;
}

export interface BgmTrackInfo {
  id: string;
  name: string;
  moods: string[];
  durationSeconds: number;
}

export interface RevisionInfo {
  revision: number;
  createdAt: string;
  duration: number | null;
  thumbnailUrl: string | null;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `요청 실패 (HTTP ${res.status})`;
  } catch {
    return `요청 실패 (HTTP ${res.status})`;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function createUpload(file: File): Promise<UploadSession> {
  return request('/api/v1/uploads', jsonInit('POST', {
    filename: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
  }));
}

export async function uploadChunks(
  file: File,
  session: UploadSession,
  onProgress: (ratio: number) => void,
): Promise<void> {
  const total = Math.ceil(file.size / session.chunkSize);
  for (let i = 0; i < total; i++) {
    const start = i * session.chunkSize;
    const chunk = file.slice(start, Math.min(start + session.chunkSize, file.size));
    const res = await fetch(`/api/v1/uploads/${session.uploadId}/chunks/${i}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: chunk,
    });
    if (!res.ok) {
      throw new Error(await parseError(res));
    }
    onProgress((i + 1) / total);
  }
}

export function completeUpload(
  uploadId: string,
  options: JobOptionsInput,
): Promise<{ jobId: string }> {
  return request(`/api/v1/uploads/${uploadId}/complete`, jsonInit('POST', { options }));
}

export function getJob(jobId: string): Promise<JobDetail> {
  return request(`/api/v1/jobs/${jobId}`);
}

export function listJobs(): Promise<{ jobs: JobSummary[]; nextCursor: string | null }> {
  return request('/api/v1/jobs?limit=30');
}

export function getPresets(): Promise<PresetInfo[]> {
  return request('/api/v1/presets');
}

export function getBgmTracks(): Promise<BgmTrackInfo[]> {
  return request('/api/v1/bgm-tracks');
}

export function getComposition(jobId: string): Promise<CompositionView> {
  return request(`/api/v1/jobs/${jobId}/composition`);
}

export function patchComposition(
  jobId: string,
  patch: {
    cuts?: Cut[];
    subtitles?: { blocks: SubtitleBlock[] };
    style?: { preset: string };
    audio?: { bgm: string };
  },
): Promise<CompositionView> {
  return request(`/api/v1/jobs/${jobId}/composition`, jsonInit('PATCH', patch));
}

export function getMe(): Promise<{ user: UserInfo | null }> {
  return request('/api/v1/auth/me');
}

export function signup(email: string, password: string): Promise<{ user: UserInfo }> {
  return request('/api/v1/auth/signup', jsonInit('POST', { email, password }));
}

export function login(email: string, password: string): Promise<{ user: UserInfo }> {
  return request('/api/v1/auth/login', jsonInit('POST', { email, password }));
}

export async function logout(): Promise<void> {
  const res = await fetch('/api/v1/auth/logout', { method: 'POST' });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
}

export function startRender(jobId: string): Promise<{ revision: number }> {
  return request(`/api/v1/jobs/${jobId}/render`, jsonInit('POST', {}));
}

export function getRevisions(jobId: string): Promise<RevisionInfo[]> {
  return request(`/api/v1/jobs/${jobId}/revisions`);
}

export async function getDownloadUrl(jobId: string, revision?: number): Promise<string> {
  const { url } = await request<{ url: string }>(
    `/api/v1/jobs/${jobId}/download-url`,
    jsonInit('POST', revision === undefined ? {} : { revision }),
  );
  return url;
}

export function watchJob(
  jobId: string,
  handlers: {
    onProgress: (event: JobProgressEvent) => void;
    onDone: () => void;
    onFailed: (error: JobFailedError) => void;
    onConnectionError: () => void;
  },
): () => void {
  const source = new EventSource(`/api/v1/jobs/${jobId}/events`);
  source.addEventListener('progress', (e) => {
    handlers.onProgress(JSON.parse((e as MessageEvent).data) as JobProgressEvent);
  });
  source.addEventListener('done', () => {
    source.close();
    handlers.onDone();
  });
  source.addEventListener('failed', (e) => {
    source.close();
    const data = JSON.parse((e as MessageEvent).data) as { error: JobFailedError };
    handlers.onFailed(data.error);
  });
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      handlers.onConnectionError();
    }
  };
  return () => source.close();
}
