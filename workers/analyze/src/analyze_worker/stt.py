"""음성 인식 (F-11): faster-whisper 기반, 단어 타임스탬프 필수.

faster-whisper는 선택 의존성([stt] extra)이다. 미설치·모델 로드 실패 시
None을 반환하고 호출부가 warning으로 처리한다 (docs/04-pipeline-spec.md §4.2 실패 정책).
"""

import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

_model = None
_model_failed = False


def _load_model():
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    try:
        from faster_whisper import WhisperModel

        name = os.environ.get("WHISPER_MODEL", "base")
        cache = os.environ.get("WHISPER_CACHE") or None
        log.info("loading whisper model %s", name)
        _model = WhisperModel(name, device="auto", compute_type="auto", download_root=cache)
    except Exception as err:
        log.warning("whisper unavailable: %s", err)
        _model_failed = True
        _model = None
    return _model


def transcribe(audio_file: Path, language: str = "auto") -> dict | None:
    """전사 결과(Transcript 스키마) 또는 실패 시 None"""
    model = _load_model()
    if model is None:
        return None
    try:
        segments_iter, info = model.transcribe(
            str(audio_file),
            language=None if language == "auto" else language,
            word_timestamps=True,
            vad_filter=True,
        )
        segments = []
        for segment in segments_iter:
            words = [
                {"start": round(w.start, 3), "end": round(w.end, 3), "text": w.word.strip()}
                for w in (segment.words or [])
                if w.word.strip()
            ]
            text = segment.text.strip()
            if text:
                segments.append(
                    {
                        "start": round(segment.start, 3),
                        "end": round(segment.end, 3),
                        "text": text,
                        "words": words,
                    }
                )
        return {"language": info.language or "unknown", "segments": segments}
    except Exception as err:
        log.warning("transcription failed: %s", err)
        return None
