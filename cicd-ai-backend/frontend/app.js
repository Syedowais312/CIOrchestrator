const form = document.getElementById("diagnosis-form");
const submitBtn = document.getElementById("submit-btn");
const refreshHistoryBtn = document.getElementById("refresh-history");
const historyList = document.getElementById("history-list");
const eventsEl = document.getElementById("events");
const statusBadge = document.getElementById("job-status");

let activeDiagnosisId = null;
let pollTimer = null;
let socket = null;

function $(id) {
  return document.getElementById(id);
}

function setStatus(status) {
  statusBadge.textContent = status || "idle";
  statusBadge.className = `badge ${status || "idle"}`;
}

function setText(id, value, fallback = "No result yet.") {
  $(id).textContent = value || fallback;
}

function inferFailureClass(text) {
  const source = (text || "").toUpperCase();
  const classes = [
    "DEPENDENCY_CONFLICT",
    "ENVIRONMENT_MISMATCH",
    "TEST_FAILURE",
    "CONFIGURATION_ERROR",
    "INFRASTRUCTURE_FAILURE",
    "VERSION_INCOMPATIBILITY",
    "BUILD_ERROR",
    "DEPLOYMENT_FAILURE",
  ];
  return classes.find((item) => source.includes(item)) || "Needs review";
}

function renderHistory(items) {
  if (!items.length) {
    historyList.innerHTML = "<p>No stored diagnoses yet.</p>";
    return;
  }

  historyList.innerHTML = items
    .map((item) => {
      const active = item.diagnosis_id === activeDiagnosisId ? "active" : "";
      const updated = item.updated_at ? new Date(item.updated_at).toLocaleString() : "Unknown";
      return `
        <article class="history-item ${active}" data-id="${item.diagnosis_id}">
          <div class="history-top">
            <strong>${item.repo}</strong>
            <span class="badge ${item.status}">${item.status}</span>
          </div>
          <p>Run ${item.diagnosis_id}</p>
          <span>${updated}</span>
        </article>
      `;
    })
    .join("");

  historyList.querySelectorAll(".history-item").forEach((node) => {
    node.addEventListener("click", () => {
      attachDiagnosis(node.dataset.id, false);
    });
  });
}

function renderEvents(events) {
  if (!events.length) {
    eventsEl.innerHTML = "<p>No events recorded yet.</p>";
    return;
  }

  eventsEl.innerHTML = events
    .map(
      (event, index) => `
        <article class="timeline-item">
          <strong>
            <span>${event.agent}</span>
            <small>Step ${index + 1}</small>
          </strong>
          <div>${event.status}</div>
        </article>
      `,
    )
    .join("");
}

function renderRepoContext(repoContext) {
  const profile = repoContext?.profile || {};
  const files = repoContext?.files || {};
  const treeSample = repoContext?.tree_sample || [];

  setText("repo-language", profile.language, "Unknown");
  setText("repo-framework", profile.framework_hint, "Framework not detected yet.");

  const fileList = $("key-files");
  fileList.innerHTML = "";
  const names = Object.keys(files);
  if (!names.length) {
    fileList.innerHTML = "<li>No repository files loaded yet.</li>";
  } else {
    names.forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      fileList.appendChild(li);
    });
  }

  $("tree-sample").textContent = JSON.stringify(treeSample.slice(0, 50), null, 2);
}

function renderDiagnosis(record) {
  const result = record.result || {};
  const diagnosis = result.diagnosis || {};
  const runDetails = result.run_details || {};

  setStatus(record.status);
  setText("summary-diagnosis", record.diagnosis_id, "Not started");
  setText("job-meta", `${record.repo} • ${record.status}`, "Waiting for a failed run.");
  setText("hero-title", record.repo, "No diagnosis selected");
  setText(
    "hero-subtitle",
    runDetails.display_title || diagnosis.classification || "Diagnosis loaded.",
    "Pick a run from history or trigger a new diagnosis.",
  );
  setText("hero-source", `source: ${record.source || "n/a"}`);
  setText("hero-branch", `branch: ${result.ref || "n/a"}`);
  setText("hero-commit", `commit: ${(result.commit_sha || "n/a").slice(0, 12)}`);

  setText("workflow-name", runDetails.name || "Unknown");
  setText("workflow-state", runDetails.conclusion || runDetails.status || "Unknown");

  const classification = diagnosis.classification || result.error || "No classification yet.";
  setText("classification-brief", inferFailureClass(classification));
  setText("classification-summary", classification);
  setText("root_cause", diagnosis.root_cause || result.error || "No result yet.");
  setText("proposed_fix", diagnosis.proposed_fix || result.error || "No result yet.");
  setText("validation_plan", diagnosis.validation_plan || result.error || "No result yet.");
  setText("log_analysis", diagnosis.log_analysis || result.error || "No result yet.");

  renderRepoContext(result.repo_context);
}

async function fetchHistory() {
  const response = await fetch("/api/diagnoses");
  const data = await response.json();
  renderHistory(data.items || []);
}

async function fetchEvents(diagnosisId) {
  const response = await fetch(`/api/events/${diagnosisId}`);
  const data = await response.json();
  renderEvents(data.events || []);
}

async function fetchDiagnosis(diagnosisId) {
  const response = await fetch(`/api/diagnosis/${diagnosisId}`);
  const data = await response.json();
  if (data.error) {
    return;
  }
  activeDiagnosisId = diagnosisId;
  renderDiagnosis(data);
  await fetchHistory();
}

async function attachDiagnosis(diagnosisId, pushState = true) {
  activeDiagnosisId = diagnosisId;
  setStatus("running");
  setText("hero-title", "Diagnosis in progress");
  setText("hero-subtitle", `Attaching to run ${diagnosisId}`);
  if (pushState) {
    history.replaceState({}, "", `/?diagnosis_id=${encodeURIComponent(diagnosisId)}`);
  }
  await Promise.all([fetchDiagnosis(diagnosisId), fetchEvents(diagnosisId)]);
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await Promise.all([fetchDiagnosis(diagnosisId), fetchEvents(diagnosisId)]);
  }, 3000);
}

async function submitDiagnosis(event) {
  event.preventDefault();

  const payload = {
    source: "github",
    repo: $("repo").value.trim(),
    run_id: $("run_id").value.trim(),
    ref: $("ref").value.trim(),
  };

  submitBtn.disabled = true;
  const response = await fetch("/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  submitBtn.disabled = false;
  await attachDiagnosis(data.diagnosis_id);
}

async function watchLatestDiagnosis() {
  const response = await fetch("/api/diagnosis/latest");
  const data = await response.json();
  if (data.error || !data.diagnosis_id) {
    return;
  }
  if (data.diagnosis_id !== activeDiagnosisId && data.status === "running") {
    await attachDiagnosis(data.diagnosis_id);
  }
}

function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

  socket.addEventListener("open", () => socket.send("watch"));
  socket.addEventListener("message", async (event) => {
    const payload = JSON.parse(event.data);
    if (!payload?.diagnosis_id) {
      return;
    }

    if (!activeDiagnosisId || payload.diagnosis_id === activeDiagnosisId) {
      await Promise.all([fetchDiagnosis(payload.diagnosis_id), fetchEvents(payload.diagnosis_id)]);
      return;
    }

    if (payload.status === "Diagnosis queued") {
      await attachDiagnosis(payload.diagnosis_id);
    }
  });

  socket.addEventListener("close", () => {
    window.setTimeout(connectSocket, 2000);
  });
}

function hydrateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const diagnosisId = params.get("diagnosis_id");
  if (diagnosisId) {
    attachDiagnosis(diagnosisId, false);
  }
}

form.addEventListener("submit", submitDiagnosis);
refreshHistoryBtn.addEventListener("click", fetchHistory);

fetchHistory();
hydrateFromQuery();
watchLatestDiagnosis();
window.setInterval(watchLatestDiagnosis, 5000);
connectSocket();
