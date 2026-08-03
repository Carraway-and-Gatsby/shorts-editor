"""잡 상태 접근 (진행률 보고와 실패 처리에 필요한 최소한만).

상태 전이의 소유권 규칙(docs/05-architecture.md §5.3)에 따라
analyze 워커는 진행률 갱신과 실패 마킹만 수행하고,
ANALYZING → COMPOSING 전이는 compose 소비자(Node)가 담당한다.
"""

import json
import logging
import os

import psycopg

log = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://shorts:shorts@localhost:5432/shorts")

_conn: psycopg.Connection | None = None


def _connection() -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed:
        _conn = psycopg.connect(DATABASE_URL, autocommit=True)
    return _conn


def _execute(query: str, params: tuple) -> list[tuple]:
    try:
        with _connection().cursor() as cur:
            cur.execute(query, params)
            if cur.description:
                return cur.fetchall()
            return []
    except psycopg.OperationalError:
        # 연결이 끊겼으면 1회 재연결 후 재시도
        global _conn
        _conn = None
        with _connection().cursor() as cur:
            cur.execute(query, params)
            if cur.description:
                return cur.fetchall()
            return []


def get_job_status(job_id: str) -> str | None:
    rows = _execute("SELECT status FROM jobs WHERE id = %s", (job_id,))
    return rows[0][0] if rows else None


def set_progress(job_id: str, stage: str, progress: int) -> None:
    _execute(
        "UPDATE jobs SET stage = %s, progress = %s, updated_at = now() WHERE id = %s",
        (stage, progress, job_id),
    )


def fail_job(job_id: str, code: str, message: str, internal: dict | None = None) -> None:
    _execute(
        """UPDATE jobs SET status = 'FAILED', error_code = %s, error_message = %s,
               internal_error = %s, updated_at = now()
           WHERE id = %s AND status NOT IN ('DONE', 'FAILED', 'CANCELED')""",
        (code, message, json.dumps(internal) if internal else None, job_id),
    )
