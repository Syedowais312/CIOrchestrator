import json
import re
from typing import Any

from groq_client import call_groq_async
from prompts import (
    UNIFIED_DIAGNOSIS_PROMPT,
)


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    return {}


def _extract_error_lines(logs: str) -> list[str]:
    patterns = [
        r".*ERROR.*",
        r".*Error:.*",
        r".*ModuleNotFoundError.*",
        r".*Cannot find module.*",
        r".*No matching distribution found.*",
        r".*ImportError.*",
        r".*Traceback.*",
        r".*exit code \d+.*",
        r".*FAILED.*",
    ]
    output: list[str] = []
    for line in logs.splitlines():
        for pattern in patterns:
            if re.search(pattern, line, re.IGNORECASE):
                cleaned = line.strip()
                if cleaned and cleaned not in output:
                    output.append(cleaned)
                break
    return output[:20]


def _infer_category(logs: str, repo_context: dict[str, Any] | None) -> tuple[str, str]:
    lowered = logs.lower()
    files = (repo_context or {}).get("files", {})
    if "module not found" in lowered or "cannot find module" in lowered or "importerror" in lowered:
        return "BUILD_ERROR", "A required module or import cannot be resolved from the current code or dependencies."
    if "no matching distribution found" in lowered or "could not find a version that satisfies the requirement" in lowered:
        return "VERSION_INCOMPATIBILITY", "The requested package version is unavailable or incompatible with the environment."
    if "eresolve" in lowered or "peer dependency" in lowered:
        return "DEPENDENCY_CONFLICT", "Dependency versions conflict during installation or resolution."
    if "traceback" in lowered or "assert" in lowered or "failed" in lowered:
        return "TEST_FAILURE", "The CI logs indicate a test or runtime execution failure."
    if "dockerfile" in files and "python" in files.get("dockerfile", "").lower() and "node" in lowered:
        return "ENVIRONMENT_MISMATCH", "The repo appears to mix runtime expectations across languages or images."
    return "UNKNOWN", "The failure needs model reasoning with repository context."


def _build_failure_signals(context: dict[str, Any]) -> dict[str, Any]:
    logs = context.get("ci_logs", "")
    repo_context = context.get("repo_context") or {}
    category, category_reason = _infer_category(logs, repo_context)
    return {
        "error_lines": _extract_error_lines(logs),
        "inferred_category": category,
        "category_reason": category_reason,
        "repo_profile": repo_context.get("profile", {}),
        "key_files": list((repo_context.get("files") or {}).keys()),
    }


def _build_context_blob(context: dict[str, Any]) -> str:
    signals = _build_failure_signals(context)
    return f"""
Repository: {context.get("repo")}
Ref: {context.get("ref")}
Commit: {context.get("commit_sha")}
Source: {context.get("source")}

Failure Signals:
{json.dumps(signals, ensure_ascii=True)}

CI Logs:
{context.get("ci_logs", "")}

Deployment Context:
{context.get("deployment_context", {})}

Repository Context:
{context.get("repo_context", {})}
""".strip()


async def run_diagnosis_pipeline(context: dict[str, Any], publish) -> dict[str, Any]:
    diagnosis_id = context["diagnosis_id"]
    blob = _build_context_blob(context)

    await publish(diagnosis_id, "aiPipeline", "Running unified diagnosis")
    unified = await call_groq_async(UNIFIED_DIAGNOSIS_PROMPT, blob)
    parsed = _extract_json(unified)
    fallback_signals = _build_failure_signals(context)
    evidence = parsed.get("evidence") or []
    missing_context = parsed.get("missing_context") or []
    failure_category = parsed.get("failure_category") or fallback_signals["inferred_category"]
    confidence = parsed.get("confidence", "low")
    classification = f"{failure_category} (confidence: {confidence})"
    if evidence:
        classification += "\nEvidence:\n- " + "\n- ".join(str(item) for item in evidence[:5])
    if missing_context:
        classification += "\nMissing context:\n- " + "\n- ".join(str(item) for item in missing_context[:5])
    elif fallback_signals["error_lines"]:
        classification += "\nKey log lines:\n- " + "\n- ".join(fallback_signals["error_lines"][:5])

    return {
        "raw": unified,
        "summary": parsed.get("summary", ""),
        "failure_category": failure_category,
        "confidence": confidence,
        "relevant_files": parsed.get("relevant_files") or [],
        "evidence": evidence or fallback_signals["error_lines"],
        "missing_context": missing_context,
        "pr_ready": bool(parsed.get("pr_ready", False)),
        "log_analysis": parsed.get("log_analysis") or "\n".join(fallback_signals["error_lines"]) or unified,
        "classification": classification,
        "root_cause": parsed.get("root_cause") or fallback_signals["category_reason"] or unified,
        "proposed_fix": parsed.get("proposed_fix", unified),
        "validation_plan": parsed.get("validation_plan", unified),
    }
