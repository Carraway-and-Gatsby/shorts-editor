"""음향 분석 (F-11 일부): RMS 에너지 곡선과 무음 구간 감지.

16kHz mono WAV(Ingest 산출물)를 입력으로 한다. docs/04-pipeline-spec.md §4.2.2 참조.
"""

import wave
from pathlib import Path

import numpy as np

ENERGY_WINDOW = 0.5  # 에너지 곡선 창(초)
SILENCE_WINDOW = 0.1  # 무음 판정 창(초)
SILENCE_RMS_THRESHOLD = 0.01  # 정규화 RMS 기준
MIN_SILENCE_SECONDS = 0.8  # 이보다 길어야 무음 구간 (F-11-R3)


def _read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        frames = wav.readframes(wav.getnframes())
    data = np.frombuffer(frames, dtype=np.int16).astype(np.float64) / 32768.0
    return data, rate


def _windowed_rms(data: np.ndarray, rate: int, window_seconds: float) -> np.ndarray:
    window = max(1, int(rate * window_seconds))
    usable = len(data) - (len(data) % window)
    if usable <= 0:
        return np.array([])
    chunks = data[:usable].reshape(-1, window)
    return np.sqrt(np.mean(chunks**2, axis=1))


def energy_curve(path: Path) -> list[dict]:
    """0.5초 창 RMS 샘플 목록"""
    data, rate = _read_wav(path)
    rms = _windowed_rms(data, rate, ENERGY_WINDOW)
    return [
        {"t": round(i * ENERGY_WINDOW, 3), "rms": round(float(v), 5)}
        for i, v in enumerate(rms)
    ]


def detect_silences(path: Path) -> list[dict]:
    """MIN_SILENCE_SECONDS 이상 지속되는 무음 구간 목록"""
    data, rate = _read_wav(path)
    rms = _windowed_rms(data, rate, SILENCE_WINDOW)
    silences: list[dict] = []
    run_start: float | None = None
    for i, value in enumerate(rms):
        t = i * SILENCE_WINDOW
        if value < SILENCE_RMS_THRESHOLD:
            if run_start is None:
                run_start = t
        else:
            if run_start is not None and t - run_start >= MIN_SILENCE_SECONDS:
                silences.append({"start": round(run_start, 3), "end": round(t, 3)})
            run_start = None
    if run_start is not None:
        end = len(rms) * SILENCE_WINDOW
        if end - run_start >= MIN_SILENCE_SECONDS:
            silences.append({"start": round(run_start, 3), "end": round(end, 3)})
    return silences
