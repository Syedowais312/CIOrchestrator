from typing import Any, Literal

from pydantic import BaseModel, Field


class WebhookPayload(BaseModel):
    source: Literal["github", "vercel", "render", "aws"] = "github"
    repo: str = Field(..., description="owner/repo")
    run_id: str | None = None
    commit_sha: str | None = None
    ref: str = "main"
    deployment_provider: str | None = None
    deployment_id: str | None = None
    deployment_status: str | None = None
    deployment_logs: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentEvent(BaseModel):
    diagnosis_id: str
    agent: str
    status: str
    data: dict[str, Any] | None = None


class DiagnosisRecord(BaseModel):
    diagnosis_id: str
    status: str
    source: str
    repo: str
    result: dict[str, Any] | None = None


class CreatePRRequest(BaseModel):
    base_branch: str | None = None
    title: str | None = None
    body: str | None = None


class CreatePRResponse(BaseModel):
    diagnosis_id: str
    branch_name: str
    pr_url: str
    pr_number: int
    changed_files: list[str]


class PRChangePreview(BaseModel):
    path: str
    content: str
    commit_message: str | None = None
    rationale: str | None = None


class PRPreviewResponse(BaseModel):
    diagnosis_id: str
    branch_name: str
    title: str
    body: str
    reason: str | None = None
    changes: list[PRChangePreview]
