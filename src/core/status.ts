import fs from "node:fs";
import path from "node:path";

export interface StatusResult {
  cwd: string;
  initialized: boolean;
  workspace: string;
  currentRunId: string | null;
  currentRunStatus: string | null;
  currentRunBranch: string | null;
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

  if (currentRunId) {
    const runFile = path.join(workspace, "runs", currentRunId, "run.json");
    if (fs.existsSync(runFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(runFile, "utf8")) as { status?: unknown; run_branch?: unknown };
        currentRunStatus = typeof parsed.status === "string" ? parsed.status : null;
        currentRunBranch = typeof parsed.run_branch === "string" ? parsed.run_branch : null;
      } catch {
        currentRunStatus = null;
      }
    }
  }

  return {
    cwd,
    initialized: fs.existsSync(workspace),
    workspace,
    currentRunId,
    currentRunStatus,
    currentRunBranch,
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
