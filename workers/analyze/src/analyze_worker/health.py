"""헬스체크 응답 구성."""


def health_payload(redis_ok: bool) -> dict:
    """다른 워커들과 동일한 형식의 헬스체크 응답을 만든다."""
    return {
        "status": "ok" if redis_ok else "degraded",
        "stage": "analyze",
        "redis": "up" if redis_ok else "down",
    }
