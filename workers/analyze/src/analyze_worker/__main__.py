"""분석 워커 엔트리포인트: BullMQ 소비 + HTTP 헬스체크 서버."""

import asyncio
import json
import logging
import os
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import redis

from .health import health_payload
from .worker import run_worker

logging.basicConfig(level=logging.INFO, format="[worker:analyze] %(message)s")
log = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
HEALTH_PORT = int(os.environ.get("HEALTH_PORT", "8083"))

_redis_ok = False
_shutdown_flag = threading.Event()


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/healthz":
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(health_payload(_redis_ok)).encode()
        self.send_response(200 if _redis_ok else 503)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args) -> None:
        pass  # 헬스체크 폴링 로그 억제


def _ping_loop(client: "redis.Redis") -> None:
    global _redis_ok
    while not _shutdown_flag.is_set():
        try:
            client.ping()
            if not _redis_ok:
                log.info("redis connection ready")
            _redis_ok = True
        except redis.RedisError as err:
            if _redis_ok:
                log.warning("redis connection lost: %s", err)
            _redis_ok = False
        _shutdown_flag.wait(5)


def main() -> None:
    client = redis.Redis.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=2)

    server = ThreadingHTTPServer(("0.0.0.0", HEALTH_PORT), HealthHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("health endpoint on :%d/healthz", HEALTH_PORT)

    threading.Thread(target=_ping_loop, args=(client,), daemon=True).start()

    async def async_main() -> None:
        shutdown = asyncio.Event()
        loop = asyncio.get_running_loop()

        def handle_signal() -> None:
            _shutdown_flag.set()
            shutdown.set()

        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, handle_signal)

        await run_worker(shutdown)

    try:
        asyncio.run(async_main())
    finally:
        _shutdown_flag.set()
        server.shutdown()
        log.info("stopped")


if __name__ == "__main__":
    main()
