import base64
import json
import re
from typing import Any

import httpx

from config import GITHUB_API_BASE, GITHUB_TOKEN, REQUEST_TIMEOUT_SECONDS
from groq_client import call_groq_async
from log_fetcher import fetch_repo_file
from prompts import PR_PLAN_PROMPT


def _headers() -> dict[str, str]:
    if not GITHUB_TOKEN:
        raise RuntimeError("GITHUB_TOKEN is missing. Set it in .env before creating PRs.")
    return {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9/-]+", "-", value.lower()).strip("-")[:40]


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start : end + 1])
    raise RuntimeError("The AI did not return valid JSON for the PR plan.")


async def _get_repo(client: httpx.AsyncClient, repo: str) -> dict[str, Any]:
    response = await client.get(f"{GITHUB_API_BASE}/repos/{repo}", headers=_headers())
    response.raise_for_status()
    return response.json()


async def _get_ref_sha(client: httpx.AsyncClient, repo: str, branch: str) -> str:
    response = await client.get(
        f"{GITHUB_API_BASE}/repos/{repo}/git/ref/heads/{branch}",
        headers=_headers(),
    )
    response.raise_for_status()
    return response.json()["object"]["sha"]


async def _create_branch(client: httpx.AsyncClient, repo: str, branch: str, sha: str) -> None:
    response = await client.post(
        f"{GITHUB_API_BASE}/repos/{repo}/git/refs",
        headers=_headers(),
        json={"ref": f"refs/heads/{branch}", "sha": sha},
    )
    if response.status_code not in {201, 422}:
        response.raise_for_status()


async def _get_content_metadata(
    client: httpx.AsyncClient,
    repo: str,
    path: str,
    branch: str,
) -> dict[str, Any] | None:
    response = await client.get(
        f"{GITHUB_API_BASE}/repos/{repo}/contents/{path}?ref={branch}",
        headers=_headers(),
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


async def _put_file(
    client: httpx.AsyncClient,
    repo: str,
    branch: str,
    path: str,
    content: str,
    commit_message: str,
) -> None:
    existing = await _get_content_metadata(client, repo, path, branch)
    payload: dict[str, Any] = {
        "message": commit_message,
        "content": base64.b64encode(content.encode("utf-8")).decode("utf-8"),
        "branch": branch,
    }
    if existing and existing.get("sha"):
        payload["sha"] = existing["sha"]

    response = await client.put(
        f"{GITHUB_API_BASE}/repos/{repo}/contents/{path}",
        headers=_headers(),
        json=payload,
    )
    response.raise_for_status()


async def _create_pull_request(
    client: httpx.AsyncClient,
    repo: str,
    title: str,
    body: str,
    head: str,
    base: str,
) -> dict[str, Any]:
    response = await client.post(
        f"{GITHUB_API_BASE}/repos/{repo}/pulls",
        headers=_headers(),
        json={"title": title, "body": body, "head": head, "base": base},
    )
    response.raise_for_status()
    return response.json()


async def build_pr_plan(diagnosis_record: dict[str, Any]) -> dict[str, Any]:
    result = diagnosis_record.get("result") or {}
    diagnosis = result.get("diagnosis") or {}
    repo = diagnosis_record["repo"]
    ref = result.get("ref") or "main"
    repo_context = result.get("repo_context") or {}
    existing_files = repo_context.get("files") or {}
    relevant_files = diagnosis.get("relevant_files") or []

    for path in relevant_files:
        if path not in existing_files:
            existing_files[path] = await fetch_repo_file(repo, path, ref)

    prompt_input = json.dumps(
        {
            "repo": repo,
            "ref": ref,
            "diagnosis": diagnosis,
            "repo_context": {
                "profile": repo_context.get("profile"),
                "files": existing_files,
                "tree_sample": repo_context.get("tree_sample", [])[:100],
            },
        },
        ensure_ascii=True,
    )
    raw_plan = await call_groq_async(PR_PLAN_PROMPT, prompt_input)
    plan = _extract_json(raw_plan)
    if not plan.get("can_create_pr"):
        raise RuntimeError(plan.get("reason", "The AI could not confidently generate a safe PR."))
    if not plan.get("changes"):
        raise RuntimeError("The AI did not return any file changes for the PR.")

    plan.setdefault("branch_name", f"sentinel/fix-{_slug(diagnosis_record['diagnosis_id'])}")
    return plan


async def create_pr_from_plan(
    diagnosis_record: dict[str, Any],
    plan: dict[str, Any],
    base_branch: str | None = None,
    title_override: str | None = None,
    body_override: str | None = None,
) -> dict[str, Any]:
    repo = diagnosis_record["repo"]
    result = diagnosis_record.get("result") or {}

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        repo_meta = await _get_repo(client, repo)
        base = base_branch or result.get("ref") or repo_meta.get("default_branch") or "main"
        base_sha = await _get_ref_sha(client, repo, base)
        branch_name = plan["branch_name"]
        if not branch_name.startswith("sentinel/"):
            branch_name = f"sentinel/{_slug(branch_name)}"

        await _create_branch(client, repo, branch_name, base_sha)

        changed_files: list[str] = []
        for change in plan["changes"]:
            path = change["path"]
            content = change["content"]
            commit_message = change.get("commit_message") or f"Update {path}"
            await _put_file(client, repo, branch_name, path, content, commit_message)
            changed_files.append(path)

        title = title_override or plan.get("title") or f"fix(ci): resolve {diagnosis_record['diagnosis_id']}"
        body = body_override or plan.get("body") or plan.get("reason", "Automated fix proposed by Sentinel CI.")
        pr = await _create_pull_request(client, repo, title, body, branch_name, base)

        return {
            "branch_name": branch_name,
            "pr_url": pr["html_url"],
            "pr_number": pr["number"],
            "changed_files": changed_files,
            "title": title,
            "body": body,
        }


async def create_pr_from_diagnosis(
    diagnosis_record: dict[str, Any],
    base_branch: str | None = None,
    title_override: str | None = None,
    body_override: str | None = None,
) -> dict[str, Any]:
    plan = await build_pr_plan(diagnosis_record)
    return await create_pr_from_plan(
        diagnosis_record,
        plan,
        base_branch=base_branch,
        title_override=title_override,
        body_override=body_override,
    )
