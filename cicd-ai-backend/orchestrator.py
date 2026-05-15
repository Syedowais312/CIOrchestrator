import uuid
from typing import Any

from agents import deployment_agent, logs_need_code_context, repo_analyzer_agent
from diagnosis_pipeline import run_diagnosis_pipeline
from log_fetcher import fetch_github_logs, fetch_workflow_run


async def orchestrate(payload: dict[str, Any], publish) -> dict[str, Any]:
    diagnosis_id = payload.get("diagnosis_id") or payload.get("metadata", {}).get("diagnosis_id") or str(uuid.uuid4())
    context: dict[str, Any] = {
        "diagnosis_id": diagnosis_id,
        **payload,
        "ci_logs": "",
        "repo_context": None,
        "deployment_context": None,
    }

    await publish(diagnosis_id, "orchestrator", "Fetching CI workflow metadata")
    run_details = {}
    if context.get("run_id"):
        run_details = await fetch_workflow_run(context["repo"], context["run_id"])
        if run_details.get("head_sha") and not context.get("commit_sha"):
            context["commit_sha"] = run_details["head_sha"]
        if run_details.get("head_branch") and context.get("ref") == "main":
            context["ref"] = run_details["head_branch"]

    await publish(diagnosis_id, "githubCIAgent", "Fetching CI logs")
    if context.get("run_id"):
        context["ci_logs"] = await fetch_github_logs(context["repo"], context["run_id"])
    else:
        context["ci_logs"] = "No run_id provided. CI logs could not be fetched."

    if logs_need_code_context(context["ci_logs"]):
        await publish(diagnosis_id, "repoAnalyzer", "Reading repository context")
        context["repo_context"] = await repo_analyzer_agent(context)
    else:
        await publish(
            diagnosis_id,
            "repoAnalyzer",
            "Skipped repository read; logs did not require code context",
        )

    if context.get("deployment_id") or context.get("deployment_logs"):
        await publish(diagnosis_id, "deploymentAgent", "Collecting deployment context")
        context["deployment_context"] = await deployment_agent(context)

    await publish(diagnosis_id, "orchestrator", "Running diagnosis pipeline")
    diagnosis = await run_diagnosis_pipeline(context, publish)

    return {
        "diagnosis_id": diagnosis_id,
        "repo": context["repo"],
        "source": context["source"],
        "commit_sha": context.get("commit_sha"),
        "ref": context.get("ref"),
        "run_details": run_details,
        "repo_context": context.get("repo_context"),
        "deployment_context": context.get("deployment_context"),
        "diagnosis": diagnosis,
    }
