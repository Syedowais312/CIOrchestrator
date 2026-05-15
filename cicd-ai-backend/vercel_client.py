import hashlib
import hmac
from typing import Any

import httpx

from config import REQUEST_TIMEOUT_SECONDS, VERCEL_TOKEN, VERCEL_WEBHOOK_SECRET

VERCEL_API_BASE = "https://api.vercel.com"


def verify_vercel_signature(raw_body: bytes, signature: str | None) -> bool:
    if not VERCEL_WEBHOOK_SECRET:
        return True
    if not signature:
        return False
    expected = hmac.new(
        VERCEL_WEBHOOK_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha1,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _headers() -> dict[str, str]:
    if not VERCEL_TOKEN:
        raise RuntimeError("VERCEL_TOKEN is missing. Set it in .env before using Vercel integration.")
    return {
        "Authorization": f"Bearer {VERCEL_TOKEN}",
        "Accept": "application/json",
    }


def _query(team_id: str | None = None, slug: str | None = None) -> dict[str, str]:
    query: dict[str, str] = {}
    if team_id:
        query["teamId"] = team_id
    if slug:
        query["slug"] = slug
    return query


async def fetch_vercel_deployment(deployment_id: str, team_id: str | None = None, slug: str | None = None) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.get(
            f"{VERCEL_API_BASE}/v13/deployments/{deployment_id}",
            headers=_headers(),
            params={**_query(team_id, slug), "withGitRepoInfo": "true"},
        )
        response.raise_for_status()
        return response.json()


async def fetch_vercel_deployment_events(
    deployment_id: str,
    team_id: str | None = None,
    slug: str | None = None,
) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.get(
            f"{VERCEL_API_BASE}/v3/deployments/{deployment_id}/events",
            headers=_headers(),
            params={
                **_query(team_id, slug),
                "direction": "backward",
                "limit": 200,
                "builds": 1,
            },
        )
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else []


def summarize_vercel_events(events: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for event in events:
        payload = event.get("payload", {})
        info = payload.get("info", {})
        text = payload.get("text") or ""
        step = info.get("step") or info.get("type") or event.get("type") or "log"
        if text:
            lines.append(f"[{step}] {text}")
    return "\n".join(lines[-120:])


def infer_repo_from_vercel_deployment(deployment: dict[str, Any]) -> tuple[str | None, str | None]:
    git_repo = deployment.get("gitRepo") or {}
    namespace = git_repo.get("namespace")
    name = git_repo.get("name")
    if namespace and name:
        return f"{namespace}/{name}", git_repo.get("defaultBranch")
    return None, None
