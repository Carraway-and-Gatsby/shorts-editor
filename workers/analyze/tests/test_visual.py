"""장면 분석 검증 (실제 opencv/scenedetect 사용)"""

from pathlib import Path

from analyze_worker.visual import analyze_visual


def test_analyze_visual_produces_shots_and_signals(test_video: Path):
    source, shots = analyze_visual(test_video)

    assert source.duration > 5
    assert source.width == 640
    assert source.height == 360
    assert source.fps > 0

    assert len(shots) >= 1
    covered = sum(s.end - s.start for s in shots)
    assert covered > source.duration * 0.9

    for shot in shots:
        signals = shot.signals
        for key in ("motion", "shake", "quality", "facePresence", "darkness"):
            assert 0 <= signals[key] <= 1, f"{key} out of range: {signals[key]}"
    # testsrc 패턴은 움직임이 있다
    assert any(s.signals["motion"] > 0 for s in shots)
    # 합성 패턴에는 얼굴이 없다
    assert all(s.signals["facePresence"] == 0 for s in shots)
