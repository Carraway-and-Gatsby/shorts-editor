"""Analyze 단계 오케스트레이션: 프록시/오디오 → analysis.json (AnalysisDoc).

packages/shared/src/analysis.ts의 스키마와 동일한 구조를 생성한다.
"""

import json
import logging
from collections.abc import Callable
from pathlib import Path

from . import audio as audio_mod
from . import stt as stt_mod
from . import visual as visual_mod
from .paths import analysis_path, audio_path, proxy_path

log = logging.getLogger(__name__)

ProgressFn = Callable[[int], None]


def analyze_job(
    job_id: str,
    language: str = "auto",
    progress: ProgressFn | None = None,
    transcriber=stt_mod.transcribe,
) -> dict:
    """분석을 수행하고 AnalysisDoc(dict)을 반환한다.

    - 시각 분석 실패는 예외로 전파된다 (잡 실패 처리 대상).
    - STT 실패는 warnings에 기록하고 진행한다.
    """
    report = progress or (lambda _p: None)
    warnings: list[str] = []

    proxy = proxy_path(job_id)
    if not proxy.exists():
        raise FileNotFoundError(f"proxy not found: {proxy}")

    report(15)
    source, shots = visual_mod.analyze_visual(proxy)
    report(30)

    audio_file = audio_path(job_id)
    has_audio = audio_file.exists()
    energy: list[dict] = []
    silences: list[dict] = []
    transcript: dict | None = None
    if has_audio:
        try:
            energy = audio_mod.energy_curve(audio_file)
            silences = audio_mod.detect_silences(audio_file)
        except Exception as err:
            log.warning("audio analysis failed: %s", err)
            warnings.append("audio_analysis_failed")
        report(35)
        transcript = transcriber(audio_file, language)
        if transcript is None:
            warnings.append("stt_failed")
        elif not transcript["segments"]:
            transcript = None
            warnings.append("stt_no_speech")
    else:
        warnings.append("stt_skipped_no_audio")
    report(44)

    return {
        "version": 1,
        "jobId": job_id,
        "source": {
            "duration": round(source.duration, 3),
            "fps": round(source.fps, 3),
            "width": source.width,
            "height": source.height,
            "hasAudio": has_audio,
        },
        "shots": [
            {
                "start": shot.start,
                "end": shot.end,
                "signals": shot.signals,
                "subjectTrack": shot.subject_track,
            }
            for shot in shots
        ],
        "transcript": transcript,
        "silences": silences,
        "energy": energy,
        "warnings": warnings,
    }


def write_analysis(job_id: str, doc: dict) -> Path:
    path = analysis_path(job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False))
    return path
