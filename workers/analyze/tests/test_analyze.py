"""analyze_job 오케스트레이션 검증 (STT는 페이크 주입)"""

import json

import pytest

from analyze_worker.analyze import analyze_job, write_analysis
from analyze_worker.paths import analysis_path, audio_path


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


def test_analyze_without_audio_marks_warning(job_storage: str):
    doc = analyze_job(job_storage, transcriber=fake_transcriber)

    assert doc["version"] == 1
    assert doc["jobId"] == job_storage
    assert doc["source"]["hasAudio"] is False
    assert doc["transcript"] is None
    assert "stt_skipped_no_audio" in doc["warnings"]
    assert len(doc["shots"]) >= 1


def test_analyze_with_audio_uses_transcriber(job_storage: str, tmp_path):
    # 무음 WAV를 오디오 산출물로 배치
    import wave

    import numpy as np

    wav_path = audio_path(job_storage)
    samples = (0.2 * np.sin(np.linspace(0, 2 * np.pi * 440, 16000))).astype(np.float64)
    with wave.open(str(wav_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes((samples * 32767).astype("int16").tobytes())

    progress_calls: list[int] = []
    doc = analyze_job(job_storage, progress=progress_calls.append, transcriber=fake_transcriber)

    assert doc["source"]["hasAudio"] is True
    assert doc["transcript"]["language"] == "ko"
    assert doc["transcript"]["segments"][0]["words"][0]["text"] == "테스트"
    assert len(doc["energy"]) > 0
    assert progress_calls == sorted(progress_calls)

    path = write_analysis(job_storage, doc)
    assert path == analysis_path(job_storage)
    reparsed = json.loads(path.read_text())
    assert reparsed["jobId"] == job_storage


def test_stt_failure_becomes_warning(job_storage: str):
    wav_path = audio_path(job_storage)
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    # 최소 길이 무음 WAV
    import wave

    with wave.open(str(wav_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * 16000)

    doc = analyze_job(job_storage, transcriber=lambda _a, _b: None)
    assert doc["transcript"] is None
    assert "stt_failed" in doc["warnings"]


def test_missing_proxy_raises(job_storage: str, monkeypatch: pytest.MonkeyPatch):
    with pytest.raises(FileNotFoundError):
        analyze_job("job_nonexistent", transcriber=fake_transcriber)
