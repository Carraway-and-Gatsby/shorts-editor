"""analyze_job 오케스트레이션 검증 (STT는 페이크 주입)"""

import json
import wave
from pathlib import Path

import numpy as np
import pytest

from analyze_worker.analyze import analyze_job, write_analysis
from analyze_worker.keys import analysis_key, audio_key
from analyze_worker.storage import LocalStorage


def fake_transcriber(_audio_file, _language):
    return {
        "language": "ko",
        "segments": [
            {
                "start": 0.5,
                "end": 2.0,
                "text": "테스트 발화",
                "words": [
                    {"start": 0.5, "end": 1.2, "text": "테스트"},
                    {"start": 1.2, "end": 2.0, "text": "발화"},
                ],
            }
        ],
    }


def put_wav(storage: LocalStorage, job_id: str, samples: np.ndarray) -> None:
    path = storage.root / audio_key(job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes((np.clip(samples, -1, 1) * 32767).astype("int16").tobytes())


def test_analyze_without_audio_marks_warning(job_storage: tuple[str, LocalStorage]):
    job_id, storage = job_storage
    doc = analyze_job(job_id, transcriber=fake_transcriber, storage=storage)

    assert doc["version"] == 1
    assert doc["jobId"] == job_id
    assert doc["source"]["hasAudio"] is False
    assert doc["transcript"] is None
    assert "stt_skipped_no_audio" in doc["warnings"]
    assert len(doc["shots"]) >= 1


def test_analyze_with_audio_uses_transcriber(job_storage: tuple[str, LocalStorage]):
    job_id, storage = job_storage
    put_wav(storage, job_id, 0.2 * np.sin(np.linspace(0, 2 * np.pi * 440, 16000)))

    progress_calls: list[int] = []
    doc = analyze_job(
        job_id, progress=progress_calls.append, transcriber=fake_transcriber, storage=storage
    )

    assert doc["source"]["hasAudio"] is True
    assert doc["transcript"]["language"] == "ko"
    assert doc["transcript"]["segments"][0]["words"][0]["text"] == "테스트"
    assert len(doc["energy"]) > 0
    assert progress_calls == sorted(progress_calls)

    key = write_analysis(job_id, doc, storage=storage)
    assert key == analysis_key(job_id)
    reparsed = json.loads((storage.root / key).read_text())
    assert reparsed["jobId"] == job_id


def test_stt_failure_becomes_warning(job_storage: tuple[str, LocalStorage]):
    job_id, storage = job_storage
    put_wav(storage, job_id, np.zeros(16000))

    doc = analyze_job(job_id, transcriber=lambda _a, _b: None, storage=storage)
    assert doc["transcript"] is None
    assert "stt_failed" in doc["warnings"]


def test_missing_proxy_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        analyze_job("job_nonexistent", transcriber=fake_transcriber, storage=LocalStorage(tmp_path))
