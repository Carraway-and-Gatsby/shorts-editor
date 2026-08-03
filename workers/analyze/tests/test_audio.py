"""무음 감지·에너지 곡선 검증 (합성 WAV 사용)"""

import wave
from pathlib import Path

import numpy as np
import pytest

from analyze_worker.audio import detect_silences, energy_curve

RATE = 16000


def write_wav(path: Path, data: np.ndarray) -> None:
    samples = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(samples.tobytes())


@pytest.fixture
def speech_with_silence(tmp_path: Path) -> Path:
    """0~2초 톤, 2~4초 무음, 4~6초 톤"""
    t1 = np.linspace(0, 2, RATE * 2, endpoint=False)
    tone = 0.3 * np.sin(2 * np.pi * 440 * t1)
    silence = np.zeros(RATE * 2)
    data = np.concatenate([tone, silence, tone])
    path = tmp_path / "test.wav"
    write_wav(path, data)
    return path


def test_detects_silence_span(speech_with_silence: Path):
    silences = detect_silences(speech_with_silence)
    assert len(silences) == 1
    assert silences[0]["start"] == pytest.approx(2.0, abs=0.2)
    assert silences[0]["end"] == pytest.approx(4.0, abs=0.2)


def test_ignores_short_gaps(tmp_path: Path):
    """0.4초 무음은 무음 구간으로 치지 않는다 (기준 0.8초)"""
    t = np.linspace(0, 1, RATE, endpoint=False)
    tone = 0.3 * np.sin(2 * np.pi * 440 * t)
    gap = np.zeros(int(RATE * 0.4))
    data = np.concatenate([tone, gap, tone])
    path = tmp_path / "short-gap.wav"
    write_wav(path, data)
    assert detect_silences(path) == []


def test_energy_curve_reflects_loudness(speech_with_silence: Path):
    energy = energy_curve(speech_with_silence)
    assert len(energy) == 12  # 6초 / 0.5초 창
    loud = [s["rms"] for s in energy if s["t"] < 2.0]
    quiet = [s["rms"] for s in energy if 2.0 <= s["t"] < 4.0]
    assert min(loud) > 0.1
    assert max(quiet) < 0.01
