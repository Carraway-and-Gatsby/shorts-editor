"""장면 분석 (F-10): 샷 경계 감지 + 샷별 신호 + 얼굴(피사체) 트랙.

프록시 영상(720p/30fps)을 입력으로 하며, 신호는 모두 0~1로 정규화한다.
docs/04-pipeline-spec.md §4.2.1 참조.
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from scenedetect import ContentDetector, detect

log = logging.getLogger(__name__)

# 샘플링/정규화 상수
SAMPLE_FPS = 3.0
DOWNSCALE_WIDTH = 320
MOTION_NORM = 30.0  # 픽셀 평균 절대차의 정규화 기준
SHARPNESS_NORM = 400.0  # 라플라시안 분산 정규화 기준
DARK_LUMA_THRESHOLD = 0.35  # 이보다 어두우면 darkness 증가
SCENE_THRESHOLD = 27.0


@dataclass
class FrameSample:
    t: float
    motion: float
    luma: float
    sharpness: float
    face: tuple[float, float, float, float] | None  # cx, cy, w, h (정규화)


@dataclass
class SourceInfo:
    duration: float
    fps: float
    width: int
    height: int


@dataclass
class ShotResult:
    start: float
    end: float
    signals: dict = field(default_factory=dict)
    subject_track: list[dict] = field(default_factory=list)


def detect_shots(proxy_path: Path, duration: float) -> list[tuple[float, float]]:
    """샷 경계 감지. 실패하거나 장면이 없으면 전체를 단일 샷으로 취급한다."""
    try:
        scenes = detect(str(proxy_path), ContentDetector(threshold=SCENE_THRESHOLD))
    except Exception as err:
        log.warning("scene detection failed, using single shot: %s", err)
        return [(0.0, duration)]
    if not scenes:
        return [(0.0, duration)]
    return [(s.get_seconds(), e.get_seconds()) for s, e in scenes]


def sample_frames(proxy_path: Path) -> tuple[SourceInfo, list[FrameSample]]:
    """프록시를 SAMPLE_FPS로 샘플링하며 프레임 단위 신호를 수집한다."""
    cap = cv2.VideoCapture(str(proxy_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open proxy video: {proxy_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = frame_count / fps if fps > 0 else 0.0
    step = max(1, round(fps / SAMPLE_FPS))

    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    samples: list[FrameSample] = []
    prev_gray: np.ndarray | None = None
    index = 0
    while True:
        grabbed = cap.grab()
        if not grabbed:
            break
        if index % step != 0:
            index += 1
            continue
        ok, frame = cap.retrieve()
        if not ok:
            break
        t = index / fps

        scale = DOWNSCALE_WIDTH / frame.shape[1]
        small = cv2.resize(frame, (DOWNSCALE_WIDTH, max(1, int(frame.shape[0] * scale))))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        motion = 0.0
        if prev_gray is not None and prev_gray.shape == gray.shape:
            motion = float(np.mean(cv2.absdiff(gray, prev_gray)))
        prev_gray = gray

        luma = float(np.mean(gray)) / 255.0
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        face = None
        detected = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5)
        if len(detected) > 0:
            fx, fy, fw, fh = max(detected, key=lambda f: f[2] * f[3])
            gh, gw = gray.shape
            face = ((fx + fw / 2) / gw, (fy + fh / 2) / gh, fw / gw, fh / gh)

        samples.append(
            FrameSample(t=t, motion=motion, luma=luma, sharpness=sharpness, face=face)
        )
        index += 1

    cap.release()
    return SourceInfo(duration=duration, fps=fps, width=width, height=height), samples


def aggregate_shots(
    shots: list[tuple[float, float]], samples: list[FrameSample]
) -> list[ShotResult]:
    """샷 구간별로 프레임 샘플을 집계해 신호와 피사체 트랙을 만든다."""
    results: list[ShotResult] = []
    for start, end in shots:
        in_shot = [s for s in samples if start <= s.t < end] or samples[:1]
        motions = np.array([s.motion for s in in_shot])
        lumas = np.array([s.luma for s in in_shot])
        sharps = np.array([s.sharpness for s in in_shot])

        motion = float(np.clip(np.mean(motions) / MOTION_NORM, 0, 1)) if len(motions) else 0.0
        shake = float(np.clip(np.std(motions) / MOTION_NORM, 0, 1)) if len(motions) else 0.0
        mean_luma = float(np.mean(lumas)) if len(lumas) else 0.5
        darkness = float(np.clip((DARK_LUMA_THRESHOLD - mean_luma) / DARK_LUMA_THRESHOLD, 0, 1))
        exposure = 1.0 - abs(mean_luma - 0.5) * 2.0
        sharpness = float(np.clip(np.mean(sharps) / SHARPNESS_NORM, 0, 1)) if len(sharps) else 0.5
        quality = float(np.clip(0.5 * exposure + 0.5 * sharpness, 0, 1))

        faces = [s for s in in_shot if s.face is not None]
        face_presence = len(faces) / len(in_shot) if in_shot else 0.0
        track = [
            {
                "t": round(s.t, 3),
                "cx": round(s.face[0], 4),
                "cy": round(s.face[1], 4),
                "w": round(s.face[2], 4),
                "h": round(s.face[3], 4),
            }
            for s in faces
        ]

        results.append(
            ShotResult(
                start=round(start, 3),
                end=round(end, 3),
                signals={
                    "motion": round(motion, 4),
                    "shake": round(shake, 4),
                    "quality": round(quality, 4),
                    "facePresence": round(face_presence, 4),
                    "darkness": round(darkness, 4),
                },
                subject_track=track,
            )
        )
    return results


def analyze_visual(proxy_path: Path) -> tuple[SourceInfo, list[ShotResult]]:
    source, samples = sample_frames(proxy_path)
    shots = detect_shots(proxy_path, source.duration)
    return source, aggregate_shots(shots, samples)
