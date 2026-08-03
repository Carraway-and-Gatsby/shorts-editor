"""스토리지 키 규약 (docs/07-data-model.md §7.4).

M2에서는 로컬 FS 스토리지를 전제로 경로를 직접 조합한다.
S3 전환 시 스토리지 클라이언트 계층으로 교체한다.
"""

import os
from pathlib import Path

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "./storage-data"))


def proxy_path(job_id: str) -> Path:
    return STORAGE_ROOT / "jobs" / job_id / "proxy.mp4"


def audio_path(job_id: str) -> Path:
    return STORAGE_ROOT / "jobs" / job_id / "audio.wav"


def analysis_path(job_id: str) -> Path:
    return STORAGE_ROOT / "jobs" / job_id / "analysis.json"
