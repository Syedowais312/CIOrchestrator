import json
import sqlite3
from contextlib import contextmanager
from typing import Any

from config import DATABASE_PATH


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def _cursor():
    connection = _connect()
    try:
        cursor = connection.cursor()
        yield cursor
        connection.commit()
    finally:
        connection.close()


def init_db() -> None:
    with _cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS diagnoses (
                diagnosis_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                source TEXT NOT NULL,
                repo TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                result_json TEXT
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                diagnosis_id TEXT NOT NULL,
                agent TEXT NOT NULL,
                status TEXT NOT NULL,
                data_json TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def upsert_diagnosis(
    diagnosis_id: str,
    status: str,
    source: str,
    repo: str,
    result: dict[str, Any] | None = None,
) -> None:
    result_json = json.dumps(result) if result is not None else None
    with _cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO diagnoses (diagnosis_id, status, source, repo, result_json)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(diagnosis_id) DO UPDATE SET
                status = excluded.status,
                source = excluded.source,
                repo = excluded.repo,
                result_json = excluded.result_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            (diagnosis_id, status, source, repo, result_json),
        )


def add_event(
    diagnosis_id: str,
    agent: str,
    status: str,
    data: dict[str, Any] | None = None,
) -> None:
    with _cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO events (diagnosis_id, agent, status, data_json)
            VALUES (?, ?, ?, ?)
            """,
            (diagnosis_id, agent, status, json.dumps(data or {})),
        )


def get_diagnosis(diagnosis_id: str) -> dict[str, Any] | None:
    with _cursor() as cursor:
        cursor.execute(
            """
            SELECT diagnosis_id, status, source, repo, created_at, updated_at, result_json
            FROM diagnoses
            WHERE diagnosis_id = ?
            """,
            (diagnosis_id,),
        )
        row = cursor.fetchone()

    if not row:
        return None

    return {
        "diagnosis_id": row["diagnosis_id"],
        "status": row["status"],
        "source": row["source"],
        "repo": row["repo"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "result": json.loads(row["result_json"]) if row["result_json"] else None,
    }


def list_diagnoses(limit: int = 25) -> list[dict[str, Any]]:
    with _cursor() as cursor:
        cursor.execute(
            """
            SELECT diagnosis_id, status, source, repo, created_at, updated_at, result_json
            FROM diagnoses
            ORDER BY datetime(updated_at) DESC, diagnosis_id DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cursor.fetchall()

    output: list[dict[str, Any]] = []
    for row in rows:
        result = json.loads(row["result_json"]) if row["result_json"] else None
        output.append(
            {
                "diagnosis_id": row["diagnosis_id"],
                "status": row["status"],
                "source": row["source"],
                "repo": row["repo"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "result": result,
            }
        )
    return output


def get_latest_diagnosis() -> dict[str, Any] | None:
    records = list_diagnoses(limit=1)
    return records[0] if records else None


def get_events(diagnosis_id: str) -> list[dict[str, Any]]:
    with _cursor() as cursor:
        cursor.execute(
            """
            SELECT diagnosis_id, agent, status, data_json, created_at
            FROM events
            WHERE diagnosis_id = ?
            ORDER BY id ASC
            """,
            (diagnosis_id,),
        )
        rows = cursor.fetchall()

    return [
        {
            "diagnosis_id": row["diagnosis_id"],
            "agent": row["agent"],
            "status": row["status"],
            "data": json.loads(row["data_json"]) if row["data_json"] else {},
            "created_at": row["created_at"],
        }
        for row in rows
    ]
