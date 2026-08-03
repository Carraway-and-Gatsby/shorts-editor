"""스토리지 드라이버 검증. S3는 S3_TEST_ENDPOINT가 있을 때만 실행."""

import os
from pathlib import Path

import pytest

from analyze_worker.storage import LocalStorage, S3Storage

S3_ENDPOINT = os.environ.get("S3_TEST_ENDPOINT")


def test_local_storage_roundtrip(tmp_path: Path):
    storage = LocalStorage(tmp_path)
    assert storage.exists("jobs/j/analysis.json") is False
    storage.put_text("jobs/j/analysis.json", '{"ok":true}')
    assert storage.exists("jobs/j/analysis.json") is True
    fetched = storage.fetch_to("jobs/j/analysis.json", tmp_path / "out.json")
    assert fetched.read_text() == '{"ok":true}'


@pytest.mark.skipif(not S3_ENDPOINT, reason="no S3 test endpoint")
def test_s3_storage_roundtrip(tmp_path: Path):
    import boto3

    bucket = "shorts-py-test"
    client = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        region_name="us-east-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    try:
        client.create_bucket(Bucket=bucket)
    except Exception:
        pass

    os.environ.setdefault("S3_ACCESS_KEY_ID", "testing")
    os.environ.setdefault("S3_SECRET_ACCESS_KEY", "testing")
    storage = S3Storage(bucket, S3_ENDPOINT, "us-east-1")
    storage.put_text("jobs/j/analysis.json", '{"ok":true}')
    assert storage.exists("jobs/j/analysis.json") is True
    assert storage.exists("jobs/j/missing") is False
    fetched = storage.fetch_to("jobs/j/analysis.json", tmp_path / "fetched.json")
    assert fetched.read_text() == '{"ok":true}'
