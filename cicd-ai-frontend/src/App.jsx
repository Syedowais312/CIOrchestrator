import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  Circle,
  ClipboardList,
  Code2,
  Command,
  FileCode2,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  History,
  Layers,
  Loader2,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shield,
  Terminal,
  XCircle,
  Zap,
  ChevronUp,
} from "lucide-react";

const API = {
  histories: "/api/diagnoses",
  latest: "/api/diagnosis/latest",
  diagnosis: (id) => `/api/diagnosis/${id}`,
  events: (id) => `/api/events/${id}`,
  webhook: "/api/webhook",
  previewPR: (id) => `/api/diagnosis/${id}/preview-pr`,
  createPR: (id) => `/api/diagnosis/${id}/create-pr`,
};

const EMPTY_SUMMARY = {
  classification: "No diagnosis selected",
  classificationSummary: "Select a stored failure or wait for a new run to trigger.",
  rootCause: "No root cause available.",
  proposedFix: "No fix available.",
  validationPlan: "No validation steps available.",
  logAnalysis: "No log analysis available.",
  repoLanguage: "Unknown",
  repoFramework: "Framework not detected.",
  workflowName: "Unknown",
  workflowState: "No workflow metadata loaded.",
  commit: "n/a",
  branch: "n/a",
  source: "n/a",
  pullRequest: null,
  title: "No diagnosis selected",
  subtitle: "History will appear here as failed runs are processed.",
  keyFiles: [],
  treeSample: [],
};

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

function inferFailureClass(text) {
  const source = (text || "").toUpperCase();
  const labels = [
    "DEPENDENCY_CONFLICT",
    "ENVIRONMENT_MISMATCH",
    "TEST_FAILURE",
    "CONFIGURATION_ERROR",
    "INFRASTRUCTURE_FAILURE",
    "VERSION_INCOMPATIBILITY",
    "BUILD_ERROR",
    "DEPLOYMENT_FAILURE",
  ];
  return labels.find((label) => source.includes(label)) || "Needs review";
}

function formatDate(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shortCommit(value) {
  return value && value !== "n/a" ? value.slice(0, 7) : "n/a";
}

function buildSimpleDiff(originalText = "", updatedText = "") {
  const before = originalText.split("\n");
  const after = updatedText.split("\n");
  const max = Math.max(before.length, after.length);
  const output = [];

  for (let index = 0; index < max; index += 1) {
    const left = before[index];
    const right = after[index];
    if (left === right) {
      if (left !== undefined) output.push(`  ${left}`);
      continue;
    }
    if (left !== undefined) output.push(`- ${left}`);
    if (right !== undefined) output.push(`+ ${right}`);
  }

  return output.join("\n");
}

function normalizeDiagnosis(record) {
  if (!record || record.error) return EMPTY_SUMMARY;
  const result = record.result || {};
  const diagnosis = result.diagnosis || {};
  const repoContext = result.repo_context || {};
  const workflow = result.run_details || {};
  const files = repoContext.files || {};
  const profile = repoContext.profile || {};
  const classification = diagnosis.classification || result.error || "No classification available.";
  return {
    classification: inferFailureClass(classification),
    classificationSummary: classification,
    rootCause: diagnosis.root_cause || result.error || EMPTY_SUMMARY.rootCause,
    proposedFix: diagnosis.proposed_fix || result.error || EMPTY_SUMMARY.proposedFix,
    validationPlan: diagnosis.validation_plan || result.error || EMPTY_SUMMARY.validationPlan,
    logAnalysis: diagnosis.log_analysis || result.error || EMPTY_SUMMARY.logAnalysis,
    repoLanguage: profile.language || EMPTY_SUMMARY.repoLanguage,
    repoFramework: profile.framework_hint || EMPTY_SUMMARY.repoFramework,
    workflowName: workflow.name || EMPTY_SUMMARY.workflowName,
    workflowState: workflow.conclusion || workflow.status || EMPTY_SUMMARY.workflowState,
    commit: result.commit_sha || EMPTY_SUMMARY.commit,
    branch: result.ref || EMPTY_SUMMARY.branch,
    source: record.source || EMPTY_SUMMARY.source,
    pullRequest: result.pull_request || null,
    title: record.repo || EMPTY_SUMMARY.title,
    subtitle: workflow.display_title || classification || EMPTY_SUMMARY.subtitle,
    keyFiles: Object.keys(files),
    treeSample: repoContext.tree_sample || [],
  };
}

function StatusDot({ status }) {
  return <span className={classNames("status-dot", status)} />;
}

function FailureBadge({ type, size }) {
  const colors = {
    DEPENDENCY_CONFLICT: "from-orange-500/20 to-orange-600/10 border-orange-500/30 text-orange-300",
    ENVIRONMENT_MISMATCH: "from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-300",
    TEST_FAILURE: "from-red-500/20 to-red-600/10 border-red-500/30 text-red-300",
    CONFIGURATION_ERROR: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/30 text-yellow-300",
    INFRASTRUCTURE_FAILURE: "from-pink-500/20 to-pink-600/10 border-pink-500/30 text-pink-300",
    VERSION_INCOMPATIBILITY: "from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-300",
    BUILD_ERROR: "from-rose-500/20 to-rose-600/10 border-rose-500/30 text-rose-300",
    DEPLOYMENT_FAILURE: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30 text-cyan-300",
  };

  const labelMap = {
    DEPENDENCY_CONFLICT: "Dependency Conflict",
    ENVIRONMENT_MISMATCH: "Environment Mismatch",
    TEST_FAILURE: "Test Failure",
    CONFIGURATION_ERROR: "Config Error",
    INFRASTRUCTURE_FAILURE: "Infra Failure",
    VERSION_INCOMPATIBILITY: "Version Issue",
    BUILD_ERROR: "Build Error",
    DEPLOYMENT_FAILURE: "Deploy Failure",
  };

  const color = colors[type] || "from-gray-500/20 to-gray-600/10 border-gray-500/30 text-gray-300";
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r border font-medium",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs",
        color,
      )}
    >
      <AlertTriangle className={size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {labelMap[type] || type}
    </span>
  );
}

function StatusPill({ status }) {
  const config = {
    running: { bg: "bg-amber-500/10 text-amber-300 border-amber-500/20", icon: Loader2, animate: "animate-spin" },
    completed: { bg: "bg-green-500/10 text-green-300 border-green-500/20", icon: CheckCircle2 },
    failed: { bg: "bg-red-500/10 text-red-300 border-red-500/20", icon: XCircle },
  };
  const c = config[status] || { bg: "bg-white/5 text-white/40 border-white/10", icon: Circle };
  const Icon = c.icon;
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border",
        c.bg,
      )}
    >
      <Icon className={classNames("w-3 h-3", c.animate)} />
      {status}
    </span>
  );
}

function Skeleton({ className }) {
  return <div className={classNames("skeleton-pulse", className)} />;
}

function CollapsibleSection({ title, icon: Icon, children, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full py-2 text-xs font-medium text-white/40 hover:text-white/70 transition-colors"
      >
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span className="uppercase tracking-wider">{title}</span>
        {open ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>
      {open && <div className="mt-2 animate-fade-in">{children}</div>}
    </div>
  );
}

function HistoryItem({ item, active, onSelect }) {
  const status = item.status || "unknown";
  const result = item.result || {};
  const diagnosis = result.diagnosis || {};
  return (
    <button
      type="button"
      onClick={() => onSelect(item.diagnosis_id)}
      className={classNames(
        "w-full text-left glass-card px-3.5 py-3 cursor-pointer transition-all duration-200",
        active ? "border-cyan-500/30 bg-cyan-500/[0.04]" : "border-transparent",
      )}
    >
      <div className="flex items-center gap-2.5 mb-1.5">
        <StatusDot status={status} />
        <span className="text-sm font-medium text-white truncate flex-1">{item.repo}</span>
        <StatusPill status={status} />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-white/30 ml-4">
        <span>#{item.diagnosis_id?.slice(0, 8)}</span>
        <span>{formatDate(item.updated_at)}</span>
      </div>
      {diagnosis.classification && (
        <p className="text-[11px] text-white/40 mt-1 ml-4 line-clamp-1">{diagnosis.classification}</p>
      )}
    </button>
  );
}

function Timeline({ events }) {
  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-white/20">
        <History className="w-8 h-8 mb-2" />
        <p className="text-xs">No agent steps recorded yet</p>
      </div>
    );
  }

  const agentIcons = {
    Analyzer: Search,
    "Repo Analyzer": Search,
    "Deployment Agent": Globe,
    Detective: Bug,
    default: Terminal,
  };

  return (
    <div className="relative">
      {events.map((event, index) => {
        const Icon = agentIcons[event.agent] || agentIcons.default;
        const isLast = index === events.length - 1;
        return (
          <div key={`${event.agent}-${event.created_at}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && <div className="absolute left-[11px] top-6 bottom-0 w-px bg-white/[0.06]" />}
            <div
              className={classNames(
                "relative z-10 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center",
                event.status === "completed"
                  ? "bg-green-500/15 text-green-400"
                  : event.status === "failed"
                    ? "bg-red-500/15 text-red-400"
                    : "bg-cyan-500/15 text-cyan-400",
              )}
            >
              <Icon className="w-3 h-3" />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium text-white/80">{event.agent}</span>
                <span className="text-[10px] text-white/30">Step {index + 1}</span>
                <span className="ml-auto text-[10px] text-white/20">{formatDate(event.created_at)}</span>
              </div>
              <p className="text-xs text-white/50 capitalize">{event.status}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function App() {
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [diagnosis, setDiagnosis] = useState(null);
  const [events, setEvents] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [form, setForm] = useState({ repo: "", run_id: "", ref: "main" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [prResult, setPrResult] = useState(null);
  const [showPRModal, setShowPRModal] = useState(false);
  const [prDraft, setPrDraft] = useState({ base_branch: "", title: "", body: "" });
  const [prPreview, setPrPreview] = useState(null);
  const [isPreviewingPR, setIsPreviewingPR] = useState(false);
  const [prActionError, setPrActionError] = useState("");
  const pollRef = useRef(null);
  const deferredSearch = useDeferredValue(search);

  const summary = useMemo(() => normalizeDiagnosis(diagnosis), [diagnosis]);

  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      const searchValue = deferredSearch.trim().toLowerCase();
      const matchesSearch =
        !searchValue ||
        item.repo.toLowerCase().includes(searchValue) ||
        item.diagnosis_id.toLowerCase().includes(searchValue);
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [history, deferredSearch, statusFilter]);

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function loadHistory() {
    const data = await fetchJson(API.histories);
    setHistory(data.items || []);
    return data.items || [];
  }

  async function loadDiagnosis(id) {
    const [diagnosisData, eventData] = await Promise.all([
      fetchJson(API.diagnosis(id)),
      fetchJson(API.events(id)),
    ]);
    setDiagnosis(diagnosisData);
    setEvents(eventData.events || []);
    setSelectedId(id);
    return diagnosisData;
  }

  function startPolling(id) {
    window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const record = await loadDiagnosis(id);
        await loadHistory();
        if (record.status !== "running") window.clearInterval(pollRef.current);
      } catch (pollError) {
        setError(pollError.message);
      }
    }, 3000);
  }

  async function attachDiagnosis(id) {
    setError("");
    setPrResult(null);
    setShowPRModal(false);
    setPrPreview(null);
    setPrActionError("");
    setLoading(true);
    const record = await loadDiagnosis(id);
    setPrResult(record.result?.pull_request || null);
    setForm((current) => ({
      ...current,
      repo: record.repo || current.repo,
      run_id: id,
      ref: record.result?.ref || current.ref,
    }));
    setPrDraft({
      base_branch: record.result?.ref || "main",
      title: "",
      body: "",
    });
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("diagnosis_id", id);
    window.history.replaceState({}, "", nextUrl);
    if (record.status === "running") startPolling(id);
    else window.clearInterval(pollRef.current);
    setLoading(false);
  }

  function openPRModal() {
    if (!selectedId || diagnosis?.status !== "completed") {
      return;
    }
    setShowPRModal(true);
    setPrPreview(null);
    setPrActionError("");
    void loadPRPreview();
  }

  async function loadPRPreview() {
    if (!selectedId) return;
    setIsPreviewingPR(true);
    setError("");
    setPrActionError("");
    try {
      const preview = await fetchJson(API.previewPR(selectedId), { method: "POST" });
      setPrPreview(preview);
      setPrDraft((current) => ({
        base_branch: current.base_branch || diagnosis?.result?.ref || "main",
        title: preview.title || current.title,
        body: preview.body || current.body,
      }));
    } catch (previewError) {
      setError(previewError.message);
    } finally {
      setIsPreviewingPR(false);
    }
  }

  async function handleCreatePR() {
    setIsCreatingPR(true);
    setError("");
    setPrActionError("");
    try {
      const result = await fetchJson(API.createPR(selectedId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_branch: prDraft.base_branch.trim() || undefined,
          title: prDraft.title.trim() || undefined,
          body: prDraft.body.trim() || undefined,
        }),
      });
      setPrResult(result);
      setShowPRModal(false);
    } catch (createPRError) {
      setError(createPRError.message);
      setPrActionError(createPRError.message);
    } finally {
      setIsCreatingPR(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const data = await fetchJson(API.webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "github", repo: form.repo.trim(), run_id: form.run_id.trim(), ref: form.ref.trim() }),
      });
      await loadHistory();
      await attachDiagnosis(data.diagnosis_id);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    let alive = true;
    async function bootstrap() {
      try {
        const items = await loadHistory();
        const params = new URLSearchParams(window.location.search);
        const diagnosisId = params.get("diagnosis_id");
        if (diagnosisId) {
          await attachDiagnosis(diagnosisId);
          return;
        }
        if (items[0] && alive) await attachDiagnosis(items[0].diagnosis_id);
      } catch (bootstrapError) {
        if (alive) setError(bootstrapError.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      alive = false;
      window.clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socketUrl = `${protocol}://${window.location.host}/ws`;
    const ws = new WebSocket(socketUrl);
    ws.addEventListener("open", () => ws.send("watch"));
    ws.addEventListener("message", async (message) => {
      try {
        const payload = JSON.parse(message.data);
        if (!payload?.diagnosis_id) return;
        await loadHistory();
        if (!selectedId || payload.diagnosis_id === selectedId || payload.status === "Diagnosis queued") {
          await attachDiagnosis(payload.diagnosis_id);
        }
      } catch (wsError) {
        setError(wsError.message);
      }
    });
    ws.addEventListener("error", () => setError("Live updates disconnected."));
    return () => ws.close();
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const latest = await fetchJson(API.latest);
        if (latest?.diagnosis_id && latest.diagnosis_id !== selectedId && latest.status === "running") {
          await loadHistory();
          await attachDiagnosis(latest.diagnosis_id);
        }
      } catch {}
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedId]);

  const DetailCard = ({ title, icon: Icon, children, highlight, meta }) => (
    <article
      className={classNames(
        "glass-panel p-5 animate-fade-in",
        highlight && "glass-card-highlight",
      )}
    >
      <div className="flex items-center gap-2.5 mb-3">
        {Icon && (
          <div
            className={classNames(
              "w-7 h-7 rounded-lg flex items-center justify-center",
              highlight
                ? "bg-cyan-500/10 text-cyan-400"
                : "bg-white/[0.04] text-white/40",
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
        <h3 className="text-sm font-semibold text-white/80">{title}</h3>
        {meta && <span className="ml-auto text-[10px] text-white/20">{meta}</span>}
      </div>
      <div className="text-sm text-white/60 leading-relaxed">{children}</div>
    </article>
  );

  const StatCard = ({ label, value, sub, icon: Icon, color }) => (
    <article className="glass-panel p-4 animate-fade-in">
      <div className="flex items-start gap-3">
        <div
          className={classNames(
            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
            `bg-${color}-500/10 text-${color}-400`,
          )}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-white/30 mb-0.5">{label}</p>
          <p className="text-sm font-semibold text-white truncate">{value}</p>
          {sub && <p className="text-xs text-white/40 mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
    </article>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex">
      <aside className="w-[340px] flex-shrink-0 border-r border-white/[0.06] flex flex-col bg-[#0a0a0f]">
        <div className="p-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">Sentinel CI</p>
              <p className="text-[10px] text-white/30">Incident Console</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">New Diagnosis</span>
          </div>
          <div className="space-y-2">
            <input
              value={form.repo}
              onChange={(e) => setForm((c) => ({ ...c, repo: e.target.value }))}
              placeholder="owner/repo"
              required
              className="input-field"
            />
            <input
              value={form.run_id}
              onChange={(e) => setForm((c) => ({ ...c, run_id: e.target.value }))}
              placeholder="Run ID"
              required
              className="input-field"
            />
            <input
              value={form.ref}
              onChange={(e) => setForm((c) => ({ ...c, ref: e.target.value }))}
              placeholder="branch"
              required
              className="input-field"
            />
          </div>
          <button type="submit" disabled={isSubmitting} className="btn-primary w-full mt-3 flex items-center justify-center gap-2">
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Inspect Failure
              </>
            )}
          </button>
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        </form>

        <div className="flex-1 flex flex-col min-h-0 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-white/40" />
              <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">Run History</span>
            </div>
            <button type="button" onClick={loadHistory} className="btn-ghost flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
          <div className="flex gap-1.5 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="input-field pl-8"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-field w-24 text-[11px]"
            >
              <option value="all">All</option>
              <option value="running">Running</option>
              <option value="completed">Done</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {filteredHistory.map((item) => (
              <HistoryItem key={item.diagnosis_id} item={item} active={item.diagnosis_id === selectedId} onSelect={attachDiagnosis} />
            ))}
            {!filteredHistory.length && (
              <div className="flex flex-col items-center justify-center py-8 text-white/20">
                <Search className="w-6 h-6 mb-2" />
                <p className="text-xs">No runs match filter</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-[120px] w-full rounded-2xl" />
            <div className="grid grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-2xl" />
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-6xl">
            <header className="glass-panel p-6 mb-4 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.03] via-transparent to-transparent pointer-events-none" />
              <div className="relative z-10">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400/60 mb-1">Active Incident</p>
                    <h1 className="text-xl font-bold text-white truncate">{summary.title}</h1>
                    <p className="text-sm text-white/40 mt-0.5">{summary.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {diagnosis?.status === "completed" && !prResult && (
                      <button
                        type="button"
                        onClick={openPRModal}
                        disabled={isCreatingPR}
                        className="btn-primary flex items-center gap-2"
                      >
                        <GitPullRequest className="w-3.5 h-3.5" />
                        Create PR
                      </button>
                    )}
                    {diagnosis?.status === "completed" && prResult && (
                      <span className="inline-flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm font-medium text-green-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        PR Created
                      </span>
                    )}
                    <StatusPill status={diagnosis?.status || "idle"} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="meta-tag">
                    <Globe className="w-3 h-3" />
                    {summary.source}
                  </span>
                  <span className="meta-tag">
                    <GitBranch className="w-3 h-3" />
                    {summary.branch}
                  </span>
                  <span className="meta-tag">
                    <GitCommit className="w-3 h-3" />
                    {shortCommit(summary.commit)}
                  </span>
                  {diagnosis?.diagnosis_id && (
                    <span className="meta-tag meta-tag-active">
                      <Command className="w-3 h-3" />
                      {diagnosis.diagnosis_id.slice(0, 8)}
                    </span>
                  )}
                </div>
                {prResult && (
                  <div className="mt-4 glass-card p-3 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-green-300 flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Pull request created
                      </p>
                      <p className="text-xs text-white/50 mt-1">
                        Branch `{prResult.branch_name}` with {prResult.changed_files?.length || 0} file changes.
                      </p>
                    </div>
                    <a
                      href={prResult.pr_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-ghost flex items-center gap-2 whitespace-nowrap"
                    >
                      <GitPullRequest className="w-3 h-3" />
                      Open PR
                    </a>
                  </div>
                )}
              </div>
            </header>

            <section className="grid grid-cols-4 gap-3 mb-4">
              <StatCard label="Failure Class" value={summary.classification} sub={summary.repoLanguage || undefined} icon={AlertTriangle} color="cyan" />
              <StatCard label="Language" value={summary.repoLanguage} sub={summary.repoFramework} icon={Code2} color="purple" />
              <StatCard label="Workflow" value={summary.workflowName} sub={summary.workflowState} icon={Activity} color="green" />
              <StatCard label="Run" value={`#${selectedId?.slice(0, 8) || "---"}`} sub={formatDate(diagnosis?.updated_at)} icon={Terminal} color="orange" />
            </section>

            <section className="grid grid-cols-2 gap-3">
              <DetailCard title="Analysis" icon={AlertTriangle} highlight meta="Primary">
                <div className="space-y-5">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400/60 mb-2">Root Cause</p>
                    <p className="leading-relaxed">{summary.rootCause}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400/60 mb-2">Proposed Fix</p>
                    <p className="leading-relaxed">{summary.proposedFix}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400/60 mb-2">Validation Plan</p>
                    <p className="leading-relaxed">{summary.validationPlan}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400/60 mb-2">Log Analysis</p>
                    <div className="bg-black/30 rounded-lg p-3 font-mono text-[12px] text-green-300/80 leading-relaxed whitespace-pre-wrap">
                      {summary.logAnalysis}
                    </div>
                  </div>
                </div>
              </DetailCard>

              <DetailCard title="Agent Timeline" icon={Layers} meta="Live + Stored">
                <Timeline events={events} />
              </DetailCard>

              <DetailCard title="Repository Context" icon={FileCode2} meta="Files Read">
                <div className="space-y-2">
                  <CollapsibleSection title="Key Files" icon={FileText} defaultOpen>
                    <div className="flex flex-wrap gap-1.5">
                      {summary.keyFiles.length ? (
                        summary.keyFiles.map((file) => (
                          <span
                            key={file}
                            className="inline-flex px-2 py-0.5 rounded text-[11px] font-mono bg-white/[0.04] border border-white/[0.06] text-white/50 hover:text-white/70 transition-colors"
                          >
                            {file}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-white/30">No files captured</span>
                      )}
                    </div>
                  </CollapsibleSection>
                  {summary.treeSample.length > 0 && (
                    <CollapsibleSection title="Tree Sample" icon={ChevronsRight}>
                      <pre className="text-[11px] font-mono text-white/40 leading-relaxed max-h-48 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(summary.treeSample.slice(0, 50), null, 2)}
                      </pre>
                    </CollapsibleSection>
                  )}
                </div>
              </DetailCard>
            </section>
          </div>
        )}
      </main>

      {showPRModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-2xl p-5 animate-fade-in">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400/60 mb-1">
                  Pull Request Review
                </p>
                <h2 className="text-lg font-semibold text-white">Review PR details before creation</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowPRModal(false)}
                className="btn-ghost"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1">Base branch</label>
                <input
                  value={prDraft.base_branch}
                  onChange={(e) => setPrDraft((c) => ({ ...c, base_branch: e.target.value }))}
                  className="input-field"
                  placeholder="main"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1">PR title</label>
                <input
                  value={prDraft.title}
                  onChange={(e) => setPrDraft((c) => ({ ...c, title: e.target.value }))}
                  className="input-field"
                  placeholder="Leave blank to use AI-generated title"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1">PR body</label>
                <textarea
                  value={prDraft.body}
                  onChange={(e) => setPrDraft((c) => ({ ...c, body: e.target.value }))}
                  className="input-field min-h-40 resize-y"
                  placeholder="Leave blank to use AI-generated body"
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-medium text-white/60 uppercase tracking-wider">AI PR Preview</p>
                <button
                  type="button"
                  onClick={loadPRPreview}
                  disabled={isPreviewingPR}
                  className="btn-ghost flex items-center gap-2"
                >
                  {isPreviewingPR ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Refreshing
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3 h-3" />
                      Refresh Preview
                    </>
                  )}
                </button>
              </div>

              <div className="glass-card p-3 space-y-3 max-h-80 overflow-auto">
                {!prPreview && !isPreviewingPR && (
                  <p className="text-xs text-white/35">No preview loaded yet.</p>
                )}
                {isPreviewingPR && (
                  <p className="text-xs text-white/35">AI is generating the PR plan and code changes...</p>
                )}
                {prPreview && (
                  <>
                    <div>
                      <p className="text-[11px] text-white/30 uppercase tracking-wider mb-1">AI branch</p>
                      <p className="text-sm text-white/75 font-mono">{prPreview.branch_name}</p>
                    </div>
                    {prPreview.reason && (
                      <div>
                        <p className="text-[11px] text-white/30 uppercase tracking-wider mb-1">Reasoning</p>
                        <p className="text-sm text-white/60">{prPreview.reason}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[11px] text-white/30 uppercase tracking-wider mb-2">AI file changes</p>
                      <div className="space-y-2">
                        {prPreview.changes?.map((change) => (
                          <div key={change.path} className="rounded-lg border border-white/10 bg-black/20 p-3">
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <p className="text-sm text-white/80 font-mono">{change.path}</p>
                              {change.commit_message && (
                                <span className="text-[10px] text-white/35">{change.commit_message}</span>
                              )}
                            </div>
                            {change.rationale && (
                              <p className="text-xs text-white/45 mb-2">{change.rationale}</p>
                            )}
                            <CollapsibleSection title="Diff Preview" icon={GitPullRequest} defaultOpen>
                              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-auto text-white/70">
                                {buildSimpleDiff(
                                  diagnosis?.result?.repo_context?.files?.[change.path] || "",
                                  change.content || "",
                                )}
                              </pre>
                            </CollapsibleSection>
                            <CollapsibleSection title="AI File Content" icon={FileCode2}>
                              <pre className="text-[11px] text-green-300/70 leading-relaxed whitespace-pre-wrap max-h-40 overflow-auto">
                                {change.content}
                              </pre>
                            </CollapsibleSection>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {prActionError && (
              <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <p className="text-xs font-semibold text-red-300 mb-1">PR creation failed</p>
                <p className="text-xs text-red-200/80 whitespace-pre-wrap">{prActionError}</p>
              </div>
            )}

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-xs text-white/35">
                The backend will create a branch, apply the AI-generated file changes above, and open the PR on GitHub.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPRModal(false)}
                  className="btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreatePR}
                  disabled={isCreatingPR}
                  className="btn-primary flex items-center gap-2"
                >
                  {isCreatingPR ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <GitPullRequest className="w-3.5 h-3.5" />
                      Confirm Create PR
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
