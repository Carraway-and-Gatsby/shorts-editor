"""Analyze 단계 오케스트레이션: 프록시/오디오 → analysis.json (AnalysisDoc).

packages/shared/src/analysis.ts의 스키마와 동일한 구조를 생성한다.
스토리지 드라이버(local/S3)를 통해 산출물을 읽고 쓴다.
"""

import json
import logging
import tempfile
from collections.abc import Callable
from pathlib import Path

from . import audio as audio_mod
from . import stt as stt_mod
from . import visual as visual_mod
from .keys import analysis_key, audio_key, proxy_key
from .storage import storage_from_env

log = logging.getLogger(__name__)

ProgressFn = Callable[[int], None]


def analyze_job(
    job_id: str,
    language: str = "auto",
    progress: ProgressFn | None = None,
    transcriber=stt_mod.transcribe,
    storage=None,
) -> dict:
    """분석을 수행하고 AnalysisDoc(dict)을 반환한다.

    - 시각 분석 실패는 예외로 전파된다 (잡 실패 처리 대상).
    - STT 실패는 warnings에 기록하고 진행한다.
    """
    report = progress or (lambda _p: None)
    store = storage or storage_from_env()
    warnings: list[str] = []

    if not store.exists(proxy_key(job_id)):
        raise FileNotFoundError(f"proxy not found: {proxy_key(job_id)}")

    with tempfile.TemporaryDirectory(prefix="shorts-analyze-") as tmp:
        tmp_dir = Path(tmp)
        proxy = store.fetch_to(proxy_key(job_id), tmp_dir / "proxy.mp4")

        report(15)
        source, shots = visual_mod.analyze_visual(proxy)
        report(30)

        has_audio = store.exists(audio_key(job_id))
        energy: list[dict] = []
        silences: list[dict] = []
        transcript: dict | None = None
        if has_audio:
            audio_file = store.fetch_to(audio_key(job_id), tmp_dir / "audio.wav")
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


def write_analysis(job_id: str, doc: dict, storage=None) -> str:
    store = storage or storage_from_env()
    key = analysis_key(job_id)
    store.put_text(key, json.dumps(doc, ensure_ascii=False))
    return key
