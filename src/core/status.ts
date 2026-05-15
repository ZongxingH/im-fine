import fs from "node:fs";
import path from "node:path";
import { writeBlockerSummary } from "./blocker-summary.js";

export interface StatusResult {
  cwd: string;
  initialized: boolean;
  workspace: string;
  currentRunId: string | null;
  currentRunStatus: string | null;
  currentRunExecutionMode: string | null;
  currentRunBranch: string | null;
  currentRunGates: Record<string, string> | null;
  currentRunActions: {
    ready: number;
    waiting: number;
    blocked: number;
    currentParallelGroups: string[];
  } | null;
  currentRunBlockers: {
    file: string;
    status: string;
    items: number;
  } | null;
  currentRunLatestCheckpoint: {
    file: string;
    actionId: string;
    status: string;
    detail: string;
    recordedAt: string;
  } | null;
  runs: Array<{
    runId: string;
    status: string;
    source: string;
    relation: "current" | "active" | "completed" | "blocked";
    updatedAt: string | null;
  }>;
  reports: string[];
}

export interface ReportResult {
  runId: string;
  file: string;
  exists: boolean;
  content?: string;
}

export function status(cwd: string): StatusResult {
  const workspace = path.join(cwd, ".imfine");
  const currentFile = path.join(workspace, "state", "current.json");
  let currentRunId: string | null = null;
  let currentRunStatus: string | null = null;
  let currentRunExecutionMode: string | null = null;
  let currentRunBranch: string | null = null;
  let currentRunGates: StatusResult["currentRunGates"] = null;
  let currentRunActions: StatusResult["currentRunActions"] = null;
  let currentRunBlockers: StatusResult["currentRunBlockers"] = null;
  let currentRunLatestCheckpoint: StatusResult["currentRunLatestCheckpoint"] = null;

  if (fs.existsSync(currentFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(currentFile, "utf8")) as { current_run_id?: unknown };
      currentRunId = typeof parsed.current_run_id === "string" ? parsed.current_run_id : null;
    } catch {
      currentRunId = null;
    }
  }

  const reportsDir = path.join(workspace, "reports");
  const reports = fs.existsSync(reportsDir)
    ? fs.readdirSync(reportsDir).filter((item) => item.endsWith(".md")).sort()
    : [];
  const runsDir = path.join(workspace, "runs");
  const runs = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const runFile = path.join(runsDir, entry.name, "run.json");
        if (!fs.existsSync(runFile)) return null;
        try {
          const parsed = JSON.parse(fs.readFileSync(runFile, "utf8")) as {
            status?: unknown;
            source?: { value?: unknown };
            updated_at?: unknown;
            created_at?: unknown;
          };
          const runStatus = typeof parsed.status === "string" ? parsed.status : "unknown";
          const relation: "current" | "active" | "completed" | "blocked" = entry.name === currentRunId
            ? "current"
            : runStatus === "completed"
              ? "completed"
              : runStatus === "blocked"
                ? "blocked"
                : "active";
          return {
            runId: entry.name,
            status: runStatus,
            source: typeof parsed.source?.value === "string" ? parsed.source.value : "unknown",
            relation,
            updatedAt: typeof parsed.updated_at === "string" ? parsed.updated_at : typeof parsed.created_at === "string" ? parsed.created_at : null
          };
        } catch {
          return null;
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""))
    : [];

  if (currentRunId) {
    const runFile = path.join(workspace, "runs", currentRunId, "run.json");
    if (fs.existsSync(runFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(runFile, "utf8")) as { status?: unknown; execution_mode?: unknown; run_branch?: unknown };
        currentRunStatus = typeof parsed.status === "string" ? parsed.status : null;
        currentRunExecutionMode = typeof parsed.execution_mode === "string" ? parsed.execution_mode : null;
        currentRunBranch = typeof parsed.run_branch === "string" ? parsed.run_branch : null;
        const runRoot = path.join(workspace, "runs", currentRunId);
        const finalGates = path.join(runRoot, "orchestration", "final-gates.json");
        if (fs.existsSync(finalGates)) {
          const gates = JSON.parse(fs.readFileSync(finalGates, "utf8")) as { gates?: Record<string, unknown> };
          currentRunGates = gates.gates
            ? Object.fromEntries(Object.entries(gates.gates).map(([key, value]) => [key, String(value)]))
            : null;
        } else {
          const trueHarness = path.join(runRoot, "orchestration", "true-harness-evidence.json");
          currentRunGates = {
            qa: fs.existsSync(path.join(runRoot, "evidence", "test-results.md")) ? "present" : "missing",
            review: fs.existsSync(path.join(runRoot, "evidence", "review.md")) ? "present" : "missing",
            committer: fs.existsSync(path.join(runRoot, "agents", "committer", "handoff.json")) ? "present" : "missing",
            push: fs.existsSync(path.join(runRoot, "evidence", "push.md")) ? "present" : "missing",
            archive: fs.existsSync(path.join(runRoot, "agents", "archive", "handoff.json")) ? "present" : "missing",
            true_harness: fs.existsSync(trueHarness)
              ? JSON.parse(fs.readFileSync(trueHarness, "utf8")).true_harness_passed === true ? "pass" : "blocked"
              : "missing"
          };
        }
        const queue = path.join(runRoot, "orchestration", "queue.json");
        if (fs.existsSync(queue)) {
          const parsedQueue = JSON.parse(fs.readFileSync(queue, "utf8")) as { actions?: Array<{ status?: string; parallelGroup?: string }> };
          const actions = Array.isArray(parsedQueue.actions) ? parsedQueue.actions : [];
          currentRunActions = {
            ready: actions.filter((action) => action.status === "ready").length,
            waiting: actions.filter((action) => action.status === "waiting").length,
            blocked: actions.filter((action) => action.status === "blocked").length,
            currentParallelGroups: Array.from(new Set(actions.map((action) => action.parallelGroup).filter((item): item is string => typeof item === "string")))
          };
        }
        const blockerFile = writeBlockerSummary(cwd, currentRunId);
        if (fs.existsSync(blockerFile)) {
          const blockers = JSON.parse(fs.readFileSync(blockerFile, "utf8")) as { status?: string; sources?: Array<{ blockers?: unknown[] }> };
          currentRunBlockers = {
            file: blockerFile,
            status: blockers.status || "unknown",
            items: Array.isArray(blockers.sources) ? blockers.sources.reduce((total, source) => total + (Array.isArray(source.blockers) ? source.blockers.length : 0), 0) : 0
          };
        }
        const checkpointFile = path.join(runRoot, "orchestration", "checkpoints", "latest.json");
        if (fs.existsSync(checkpointFile)) {
          const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, "utf8")) as {
            file?: unknown;
            action_id?: unknown;
            status?: unknown;
            detail?: unknown;
            recorded_at?: unknown;
          };
          currentRunLatestCheckpoint = {
            file: typeof checkpoint.file === "string" ? checkpoint.file : checkpointFile,
            actionId: typeof checkpoint.action_id === "string" ? checkpoint.action_id : "unknown",
            status: typeof checkpoint.status === "string" ? checkpoint.status : "unknown",
            detail: typeof checkpoint.detail === "string" ? checkpoint.detail : "unknown",
            recordedAt: typeof checkpoint.recorded_at === "string" ? checkpoint.recorded_at : "unknown"
          };
        }
      } catch {
        currentRunStatus = null;
        currentRunExecutionMode = null;
      }
    }
  }

  return {
    cwd,
    initialized: fs.existsSync(workspace),
    workspace,
    currentRunId,
    currentRunStatus,
    currentRunExecutionMode,
    currentRunBranch,
    currentRunGates,
    currentRunActions,
    currentRunBlockers,
    currentRunLatestCheckpoint,
    runs,
    reports
  };
}

export function readReport(cwd: string, runId: string): ReportResult {
  const file = path.join(cwd, ".imfine", "reports", `${runId}.md`);
  if (!fs.existsSync(file)) {
    return { runId, file, exists: false };
  }
  return {
    runId,
    file,
    exists: true,
    content: fs.readFileSync(file, "utf8")
  };
}
