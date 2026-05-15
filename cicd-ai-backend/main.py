import asyncio
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from event_bus import event_bus
from github_pr import build_pr_plan, create_pr_from_diagnosis, create_pr_from_plan
from models import CreatePRRequest, CreatePRResponse, DiagnosisRecord, PRPreviewResponse, WebhookPayload
from orchestrator import orchestrate
from storage import get_diagnosis as load_diagnosis
from storage import get_events as load_events
from storage import get_latest_diagnosis as load_latest_diagnosis
from storage import init_db, list_diagnoses, upsert_diagnosis

app = FastAPI(title="CI/CD AI Backend", version="0.1.0")
diagnosis_store: dict[str, DiagnosisRecord] = {}
latest_diagnosis_id: str | None = None
pr_plan_store: dict[str, dict[str, Any]] = {}
app.mount("/assets", StaticFiles(directory="frontend"), name="frontend-assets")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


async def publish(diagnosis_id: str, agent: str, status: str, data: dict[str, Any] | None = None) -> None:
    event = {
        "type": "agent_update",
        "diagnosis_id": diagnosis_id,
        "agent": agent,
        "status": status,
        "data": data or {},
    }
    await event_bus.publish(diagnosis_id, event)


async def run_diagnosis(payload: WebhookPayload) -> None:
    body = payload.model_dump()
    diagnosis_id = payload.metadata.get("diagnosis_id", "unknown")
    try:
        result = await orchestrate(body, publish)
        diagnosis_id = result["diagnosis_id"]
        diagnosis_store[diagnosis_id] = DiagnosisRecord(
            diagnosis_id=diagnosis_id,
            status="completed",
            source=payload.source,
            repo=payload.repo,
            result=result,
        )
        upsert_diagnosis(diagnosis_id, "completed", payload.source, payload.repo, result)
        await publish(diagnosis_id, "system", "Diagnosis completed", {"result": result})
    except Exception as exc:
        diagnosis_store[diagnosis_id] = DiagnosisRecord(
            diagnosis_id=diagnosis_id,
            status="failed",
            source=payload.source,
            repo=payload.repo,
            result={"error": str(exc)},
        )
        upsert_diagnosis(
            diagnosis_id,
            "failed",
            payload.source,
            payload.repo,
            {"error": str(exc)},
        )
        await publish(diagnosis_id, "system", "Diagnosis failed", {"error": str(exc)})


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse("frontend/index.html")


@app.post("/api/webhook")
async def receive_webhook(payload: WebhookPayload) -> dict[str, str]:
    global latest_diagnosis_id
    diagnosis_id = payload.metadata.get("diagnosis_id") or payload.run_id or payload.commit_sha
    diagnosis_id = diagnosis_id or f"{payload.repo.replace('/', '-')}-{payload.source}"
    latest_diagnosis_id = diagnosis_id

    diagnosis_store[diagnosis_id] = DiagnosisRecord(
        diagnosis_id=diagnosis_id,
        status="running",
        source=payload.source,
        repo=payload.repo,
        result=None,
    )
    upsert_diagnosis(diagnosis_id, "running", payload.source, payload.repo, None)

    request_payload = payload.model_copy(
        update={"metadata": {**payload.metadata, "diagnosis_id": diagnosis_id}}
    )
    await publish(
        diagnosis_id,
        "system",
        "Diagnosis queued",
        {"repo": payload.repo, "source": payload.source, "status": "running"},
    )
    asyncio.create_task(run_diagnosis(request_payload))

    return {"status": "accepted", "diagnosis_id": diagnosis_id}


@app.get("/api/diagnosis/{diagnosis_id}")
async def get_diagnosis(diagnosis_id: str) -> DiagnosisRecord | dict[str, str]:
    memory_record = diagnosis_store.get(diagnosis_id)
    if memory_record:
        return memory_record
    return load_diagnosis(diagnosis_id) or {"error": "Diagnosis not found"}


@app.post("/api/diagnosis/{diagnosis_id}/preview-pr")
async def preview_pr(diagnosis_id: str) -> PRPreviewResponse | dict[str, str]:
    record = diagnosis_store.get(diagnosis_id)
    if record:
        diagnosis_record: dict[str, Any] = record.model_dump()
    else:
        diagnosis_record = load_diagnosis(diagnosis_id) or {}

    if not diagnosis_record:
        return {"error": "Diagnosis not found"}
    if diagnosis_record.get("status") != "completed":
        return {"error": "Diagnosis must be completed before previewing a PR"}

    try:
        plan = await build_pr_plan(diagnosis_record)
    except Exception as exc:
        return {"error": str(exc)}

    pr_plan_store[diagnosis_id] = plan
    return PRPreviewResponse(
        diagnosis_id=diagnosis_id,
        branch_name=plan["branch_name"],
        title=plan.get("title") or f"fix(ci): resolve {diagnosis_id}",
        body=plan.get("body") or plan.get("reason") or "",
        reason=plan.get("reason"),
        changes=plan.get("changes", []),
    )


@app.post("/api/diagnosis/{diagnosis_id}/create-pr")
async def create_pr(diagnosis_id: str, payload: CreatePRRequest) -> CreatePRResponse | dict[str, str]:
    record = diagnosis_store.get(diagnosis_id)
    if record:
        diagnosis_record: dict[str, Any] = record.model_dump()
    else:
        diagnosis_record = load_diagnosis(diagnosis_id) or {}

    if not diagnosis_record:
        return {"error": "Diagnosis not found"}
    if diagnosis_record.get("status") != "completed":
        return {"error": "Diagnosis must be completed before creating a PR"}

    try:
        plan = pr_plan_store.get(diagnosis_id)
        if plan:
            pr_result = await create_pr_from_plan(
                diagnosis_record,
                plan,
                base_branch=payload.base_branch,
                title_override=payload.title,
                body_override=payload.body,
            )
        else:
            pr_result = await create_pr_from_diagnosis(
                diagnosis_record,
                base_branch=payload.base_branch,
                title_override=payload.title,
                body_override=payload.body,
            )
    except Exception as exc:
        return {"error": str(exc)}

    updated_result = dict(diagnosis_record.get("result") or {})
    updated_result["pull_request"] = pr_result
    diagnosis_store[diagnosis_id] = DiagnosisRecord(
        diagnosis_id=diagnosis_id,
        status=diagnosis_record["status"],
        source=diagnosis_record["source"],
        repo=diagnosis_record["repo"],
        result=updated_result,
    )
    upsert_diagnosis(
        diagnosis_id,
        diagnosis_record["status"],
        diagnosis_record["source"],
        diagnosis_record["repo"],
        updated_result,
    )
    return CreatePRResponse(diagnosis_id=diagnosis_id, **pr_result)


@app.get("/api/diagnosis/latest")
async def get_latest_diagnosis() -> DiagnosisRecord | dict[str, str]:
    if latest_diagnosis_id and diagnosis_store.get(latest_diagnosis_id):
        return diagnosis_store[latest_diagnosis_id]
    return load_latest_diagnosis() or {"error": "No diagnosis found"}


@app.get("/api/diagnoses")
async def get_diagnoses(limit: int = 25) -> dict[str, Any]:
    return {"items": list_diagnoses(limit)}


@app.get("/api/events/{diagnosis_id}")
async def get_events(diagnosis_id: str) -> dict[str, Any]:
    memory_events = event_bus.history.get(diagnosis_id)
    return {
        "diagnosis_id": diagnosis_id,
        "events": memory_events if memory_events is not None else load_events(diagnosis_id),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await event_bus.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        event_bus.disconnect(websocket)
