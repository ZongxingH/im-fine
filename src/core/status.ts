import fs from "node:fs";
import path from "node:path";

export interface StatusResult {
  cwd: string;
  initialized: boolean;
  workspace: string;
  currentRunId: string | null;
  currentRunStatus: string | null;
  currentRunExecutionMode: string | null;
  currentRunBranch: string | null;
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
