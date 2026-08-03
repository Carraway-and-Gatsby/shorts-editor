from analyze_worker.health import health_payload


def test_health_payload_ok():
    assert health_payload(True) == {"status": "ok", "stage": "analyze", "redis": "up"}


def test_health_payload_degraded():
    assert health_payload(False) == {"status": "degraded", "stage": "analyze", "redis": "down"}
