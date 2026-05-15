import base64
from typing import Any

import httpx

from config import (
    GITHUB_API_BASE,
    HEADERS_GITHUB,
    MAX_FILE_CHARS,
    MAX_LOG_CHARS,
    REQUEST_TIMEOUT_SECONDS,
)


def _clean_headers() -> dict[str, str]:
    return {key: value for key, value in HEADERS_GITHUB.items() if value}


async def fetch_github_logs(repo: str, run_id: str) -> str:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        jobs_url = f"{GITHUB_API_BASE}/repos/{repo}/actions/runs/{run_id}/jobs"
        jobs_res = await client.get(jobs_url, headers=_clean_headers())

        if jobs_res.status_code != 200:
            return f"Could not fetch workflow jobs. Status: {jobs_res.status_code}"

        jobs = jobs_res.json().get("jobs", [])
        if not jobs:
            return "No jobs found for this workflow run."

        failed_job = next((job for job in jobs if job.get("conclusion") == "failure"), jobs[0])
        job_id = failed_job["id"]

        logs_url = f"{GITHUB_API_BASE}/repos/{repo}/actions/jobs/{job_id}/logs"
        logs_res = await client.get(
            logs_url,
            headers=_clean_headers(),
            follow_redirects=True,
        )

        if logs_res.status_code != 200:
            return f"Could not fetch logs. Status: {logs_res.status_code}"

        return logs_res.text[-MAX_LOG_CHARS:]


async def fetch_repo_file(repo: str, path: str, ref: str = "main") -> str:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        url = f"{GITHUB_API_BASE}/repos/{repo}/contents/{path}?ref={ref}"
        res = await client.get(url, headers=_clean_headers())

        if res.status_code != 200:
            return f"Could not fetch {path}. Status: {res.status_code}"

        data = res.json()
        content = data.get("content", "")
        if not content:
            return f"{path} is empty or unavailable."

        decoded = base64.b64decode(content).decode("utf-8", errors="ignore")
        return decoded[:MAX_FILE_CHARS]


async def fetch_repo_tree(repo: str, ref: str = "main") -> list[str]:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        url = f"{GITHUB_API_BASE}/repos/{repo}/git/trees/{ref}?recursive=1"
        res = await client.get(url, headers=_clean_headers())

        if res.status_code != 200:
            return []

        tree = res.json().get("tree", [])
        return [
            item["path"]
            for item in tree
            if item.get("type") == "blob" and item.get("size", 0) < 100000
        ]


async def fetch_workflow_run(repo: str, run_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        url = f"{GITHUB_API_BASE}/repos/{repo}/actions/runs/{run_id}"
        res = await client.get(url, headers=_clean_headers())

        if res.status_code != 200:
            return {}

        return res.json()
