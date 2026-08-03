"""스토리지 드라이버 (Node 측 @shorts/storage와 동일한 규약).

- STORAGE_DRIVER=local (기본): STORAGE_ROOT 하위 파일 직접 접근
- STORAGE_DRIVER=s3: boto3 기반 S3 호환 스토리지
"""

import os
import shutil
from pathlib import Path


class LocalStorage:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        return self.root / key

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def fetch_to(self, key: str, dest: Path) -> Path:
        """오브젝트를 로컬 파일로 가져온다 (로컬 드라이버는 복사 대신 원본 경로 반환)."""
        return self._path(key)

    def put_text(self, key: str, text: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)


class S3Storage:
    def __init__(self, bucket: str, endpoint: str | None, region: str | None):
        import boto3

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint or None,
            region_name=region or "us-east-1",
            aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID") or None,
            aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY") or None,
        )

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def fetch_to(self, key: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(dest))
        return dest

    def put_text(self, key: str, text: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=text.encode())


def storage_from_env():
    driver = os.environ.get("STORAGE_DRIVER", "local")
    if driver == "s3":
        bucket = os.environ.get("S3_BUCKET")
        if not bucket:
            raise RuntimeError("STORAGE_DRIVER=s3 requires S3_BUCKET")
        return S3Storage(
            bucket,
            os.environ.get("S3_ENDPOINT"),
            os.environ.get("S3_REGION"),
        )
    if driver != "local":
        raise RuntimeError(f"unknown STORAGE_DRIVER: {driver}")
    return LocalStorage(os.environ.get("STORAGE_ROOT", "./storage-data"))


__all__ = ["LocalStorage", "S3Storage", "storage_from_env", "shutil"]
