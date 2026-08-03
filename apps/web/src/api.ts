/** API 클라이언트 (docs/06-api-spec.md 응답 형태 기준) */

export interface UploadSession {
  uploadId: string;
  chunkSize: number;
  expiresAt: string;
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

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `요청 실패 (HTTP ${res.status})`;
  } catch {
    return `요청 실패 (HTTP ${res.status})`;
  }
}

export async function createUpload(file: File): Promise<UploadSession> {
  const res = await fetch('/api/v1/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
    }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as UploadSession;
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

export async function completeUpload(uploadId: string): Promise<{ jobId: string }> {
  const res = await fetch(`/api/v1/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as { jobId: string };
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

export async function getDownloadUrl(jobId: string): Promise<string> {
  const res = await fetch(`/api/v1/jobs/${jobId}/download-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}
