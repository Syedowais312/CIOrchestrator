from typing import Any
import re

from log_fetcher import fetch_repo_file, fetch_repo_tree


KEY_FILES = [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "Dockerfile",
    ".github/workflows/ci.yml",
    ".github/workflows/ci.yaml",
]


def _extract_file_hints(logs: str) -> list[str]:
    patterns = [
        r"([A-Za-z0-9_./-]+\.(?:py|js|ts|tsx|jsx|json|yml|yaml|toml))",
    ]
    matches: list[str] = []
    for pattern in patterns:
        matches.extend(re.findall(pattern, logs))
    seen: set[str] = set()
    output: list[str] = []
    for match in matches:
        if match not in seen:
            seen.add(match)
            output.append(match)
    return output[:10]


def _select_repo_files(tree: list[str], logs: str) -> list[str]:
    candidate_files = [path for path in KEY_FILES if path in tree]
    workflow_files = [path for path in tree if path.startswith(".github/workflows/")][:2]
    for workflow_file in workflow_files:
        if workflow_file not in candidate_files:
            candidate_files.append(workflow_file)

    hinted = _extract_file_hints(logs)
    for hint in hinted:
        if hint in tree and hint not in candidate_files:
            candidate_files.append(hint)

    root_source_files = [
        path
        for path in tree
        if "/" not in path and path.endswith((".py", ".js", ".ts", ".tsx", ".jsx"))
    ][:4]
    for path in root_source_files:
        if path not in candidate_files:
            candidate_files.append(path)

    test_files = [
        path
        for path in tree
        if ("test" in path.lower() or "spec" in path.lower())
        and path.endswith((".py", ".js", ".ts", ".tsx", ".jsx"))
    ][:4]
    for path in test_files:
        if path not in candidate_files:
            candidate_files.append(path)

    return candidate_files[:10]


def logs_need_code_context(logs: str) -> bool:
    triggers = [
        "ERESOLVE",
        "peer dependency",
        "requirements.txt",
        "No matching distribution found",
        "Cannot find module",
        "ModuleNotFoundError",
        "Traceback",
        ".js:",
        ".ts:",
        ".py:",
    ]
    lowered = logs.lower()
    return any(trigger.lower() in lowered for trigger in triggers)


def infer_repo_profile(tree: list[str]) -> dict[str, str]:
    lowered = set(tree)
    if "package.json" in lowered:
        return {"language": "JavaScript/TypeScript", "framework_hint": "Node.js"}
    if "requirements.txt" in lowered or "pyproject.toml" in lowered:
        return {"language": "Python", "framework_hint": "Python application"}
    if "pom.xml" in lowered:
        return {"language": "Java", "framework_hint": "Maven"}
    if "go.mod" in lowered:
        return {"language": "Go", "framework_hint": "Go modules"}
    return {"language": "Unknown", "framework_hint": "Unknown"}


async def repo_analyzer_agent(context: dict[str, Any]) -> dict[str, Any]:
    repo = context["repo"]
    ref = context.get("ref", "main")
    logs = context.get("ci_logs", "")
    tree = await fetch_repo_tree(repo, ref)
    profile = infer_repo_profile(tree)
    candidate_files = _select_repo_files(tree, logs)

    files: dict[str, str] = {}
    for path in candidate_files:
        files[path] = await fetch_repo_file(repo, path, ref)

    return {
        "profile": profile,
        "tree_sample": tree[:200],
        "files": files,
    }


async def deployment_agent(context: dict[str, Any]) -> dict[str, Any]:
    provider = context.get("deployment_provider") or context.get("source")
    deployment_logs = context.get("deployment_logs")

    if deployment_logs:
        return {
            "provider": provider,
            "status": context.get("deployment_status", "unknown"),
            "logs": deployment_logs[-12000:],
            "note": "Deployment logs supplied directly in webhook payload.",
        }

    return {
        "provider": provider,
        "status": context.get("deployment_status", "unknown"),
        "logs": "",
        "note": "Deployment integration not implemented yet. Pass deployment_logs in the webhook payload.",
    }
