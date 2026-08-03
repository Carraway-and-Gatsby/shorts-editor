"""스토리지 키 규약 (docs/07-data-model.md §7.4). Node 측 storageKeys와 동일."""


def proxy_key(job_id: str) -> str:
    return f"jobs/{job_id}/proxy.mp4"


def audio_key(job_id: str) -> str:
    return f"jobs/{job_id}/audio.wav"


def analysis_key(job_id: str) -> str:
    return f"jobs/{job_id}/analysis.json"
