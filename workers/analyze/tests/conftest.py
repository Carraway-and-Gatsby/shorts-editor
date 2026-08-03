"""공용 픽스처: ffmpeg로 테스트 영상/스토리지 구성 (ffmpeg 없으면 관련 테스트 스킵)"""

import shutil
import subprocess
from pathlib import Path

import pytest

FFMPEG = shutil.which("ffmpeg")


@pytest.fixture(scope="session")
def test_video(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """6초 640x360 테스트 영상 (움직임 있는 testsrc 패턴)"""
    if not FFMPEG:
        pytest.skip("ffmpeg not available")
    path = tmp_path_factory.mktemp("video") / "test.mp4"
    subprocess.run(
        [
            FFMPEG, "-y",
            "-f", "lavfi", "-i", "testsrc=duration=6:size=640x360:rate=30",
            "-c:v", "libx264", "-preset", "ultrafast", "-an",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path


@pytest.fixture
def job_storage(tmp_path: Path, test_video: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    """STORAGE_ROOT를 임시 디렉터리로 바꾸고 프록시를 배치한 잡을 만든다."""
    job_id = "job_pytest"
    job_dir = tmp_path / "jobs" / job_id
    job_dir.mkdir(parents=True)
    shutil.copy(test_video, job_dir / "proxy.mp4")

    import analyze_worker.paths as paths

    monkeypatch.setattr(paths, "STORAGE_ROOT", tmp_path)
    return job_id
