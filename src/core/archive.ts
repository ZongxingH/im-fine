import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { type TaskGraph } from "./plan.js";
import { transitionRunState } from "./state-machine.js";

export type ArchiveStatus = "archived" | "blocked";

export interface ArchiveCheck {
  id: string;
  status: "pass" | "fail";
  detail: string;
}

export interface ArchiveResult {
  runId: string;
  status: ArchiveStatus;
  archiveReport: string;
  userReport: string;
  projectUpdates: string;
  finalSummary: string;
  agent: string;
  checks: ArchiveCheck[];
  blockedItems: string[];
}

interface RunMetadata {
  run_id: string;
  status?: string;
  project_kind?: string;
  run_branch?: string;
  push_status?: string;
  push_user_action?: string;
  push_local_commit?: string;
  commit_hashes?: string[];
  commit_blocked_reason?: string;
}

interface TaskStatus {
  status?: string;
  commit_hash?: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readTextIfExists(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function workspace(cwd: string): string {
  return path.join(cwd, ".imfine");
}

function graphFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "planning", "task-graph.json");
}

function taskStatusFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "tasks", taskId, "status.json");
}

function qaStatusFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `qa-${taskId}`, "status.json");
}

function reviewStatusFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `reviewer-${taskId}`, "status.json");
}

function checkFile(id: string, file: string): ArchiveCheck {
  return {
    id,
    status: fs.existsSync(file) ? "pass" : "fail",
    detail: file
  };
}

function firstContentLine(file: string): string {
  return readTextIfExists(file)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) || "unknown";
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "capability";
}

function readTaskGraph(cwd: string, runId: string): TaskGraph | null {
  const file = graphFile(cwd, runId);
  if (!fs.existsSync(file)) return null;
  return readJson<TaskGraph>(file);
}

function taskEvidenceChecks(cwd: string, runId: string, graph: TaskGraph | null): ArchiveCheck[] {
  if (!graph) return [{ id: "tasks", status: "fail", detail: "missing task graph" }];
  const run = readJson<RunMetadata>(path.join(runDir(cwd, runId), "run.json"));
  const commitOutcomeKnown = Boolean(run.commit_hashes?.length || run.commit_blocked_reason);
  const checks: ArchiveCheck[] = [];
  for (const task of graph.tasks) {
    const qaFile = qaStatusFile(cwd, runId, task.id);
    const reviewFile = reviewStatusFile(cwd, runId, task.id);
    const statusFile = taskStatusFile(cwd, runId, task.id);
    const qa = fs.existsSync(qaFile) ? readJson<{ status?: string }>(qaFile) : {};
    const review = fs.existsSync(reviewFile) ? readJson<{ status?: string }>(reviewFile) : {};
    const taskStatus = fs.existsSync(statusFile) ? readJson<TaskStatus>(statusFile) : {};
    checks.push({
      id: `task.${task.id}.qa`,
      status: qa.status === "pass" ? "pass" : "fail",
      detail: qaFile
    });
    checks.push({
      id: `task.${task.id}.review`,
      status: review.status === "approved" ? "pass" : "fail",
      detail: reviewFile
    });
    checks.push({
      id: `task.${task.id}.commit`,
      status: taskStatus.status === "committed" || taskStatus.status === "exempt" || commitOutcomeKnown ? "pass" : "fail",
      detail: statusFile
    });
  }
  return checks;
}

function outcomeChecks(cwd: string, runId: string): ArchiveCheck[] {
  const dir = runDir(cwd, runId);
  const run = readJson<RunMetadata>(path.join(dir, "run.json"));
  const commitEvidence = path.join(dir, "evidence", "commits.md");
  const pushEvidence = path.join(dir, "evidence", "push.md");
  const pushOutcomeKnown = run.push_status === "pushed" || Boolean(run.push_status?.startsWith("push_blocked_"));
  const commitOutcomeKnown = Boolean(run.commit_hashes?.length || run.commit_blocked_reason);

  return [
    {
      id: "commit-outcome",
      status: commitOutcomeKnown && (fs.existsSync(commitEvidence) || Boolean(run.commit_blocked_reason)) ? "pass" : "fail",
      detail: run.commit_hashes?.length ? commitEvidence : run.commit_blocked_reason || "missing commit hash or explicit commit blocker"
    },
    {
      id: "push-outcome",
      status: pushOutcomeKnown && fs.existsSync(pushEvidence) ? "pass" : "fail",
      detail: run.push_status ? `${run.push_status}: ${pushEvidence}` : "missing push status or push evidence"
    }
  ];
}

function updateRun(cwd: string, runId: string, status: ArchiveStatus, extra: Record<string, unknown>): void {
  transitionRunState(cwd, runId, status, extra);
}

function appendProjectSection(file: string, title: string, body: string): void {
  ensureDir(path.dirname(file));
  const section = `\n\n## ${title}\n\n${body.trim()}\n`;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# ${path.basename(file, ".md")}\n${section}`);
    return;
  }
  fs.appendFileSync(file, section);
}

function taskLines(graph: TaskGraph | null, cwd: string, runId: string): string[] {
  if (!graph) return ["- task graph missing"];
  return graph.tasks.map((task) => {
    const statusFile = taskStatusFile(cwd, runId, task.id);
    const status = fs.existsSync(statusFile) ? readJson<TaskStatus>(statusFile) : {};
    return `- ${task.id}: ${task.title} (${status.status || "unknown"}${status.commit_hash ? `, ${status.commit_hash}` : ""})`;
  });
}

function buildArchiveReport(cwd: string, runId: string, status: ArchiveStatus, checks: ArchiveCheck[], blockedItems: string[], projectUpdateFiles: string[]): string {
  const dir = runDir(cwd, runId);
  const run = readJson<RunMetadata>(path.join(dir, "run.json"));
  const graph = readTaskGraph(cwd, runId);
  const requirement = firstContentLine(path.join(dir, "request", "normalized.md"));
  const commits = readTextIfExists(path.join(dir, "evidence", "commits.md"));
  const push = readTextIfExists(path.join(dir, "evidence", "push.md"));

  return `# Archive Report

## Run

- run id: ${runId}
- status: ${status}
- project kind: ${run.project_kind || "unknown"}
- run branch: ${run.run_branch || "unknown"}

## Requirement

${requirement}

## Delivered Changes

${taskLines(graph, cwd, runId).join("\n")}

## Evidence Chain

- request: ${path.join(dir, "request", "normalized.md")}
- requirement analysis: ${path.join(dir, "analysis", "requirement-analysis.md")}
- project context: ${path.join(dir, "analysis", "project-context.md")}
- impact analysis: ${path.join(dir, "analysis", "impact-analysis.md")}
- risk analysis: ${path.join(dir, "analysis", "risk-analysis.md")}
- solution design: ${path.join(dir, "design", "solution-design.md")}
- architecture decisions: ${path.join(dir, "design", "architecture-decisions.md")}
- task graph: ${path.join(dir, "planning", "task-graph.json")}
- execution plan: ${path.join(dir, "planning", "execution-plan.md")}
- commit plan: ${path.join(dir, "planning", "commit-plan.md")}

## Verification Evidence

- test results: ${path.join(dir, "evidence", "test-results.md")}
- QA status: ${graph ? graph.tasks.map((task) => `${task.id}=pass`).join(", ") : "missing"}

## Review Evidence

- review evidence: ${path.join(dir, "evidence", "review.md")}
- Review status: ${graph ? graph.tasks.map((task) => `${task.id}=approved`).join(", ") : "missing"}

## Commit and Push

- commit evidence: ${commits ? path.join(dir, "evidence", "commits.md") : "missing"}
- commit hashes: ${run.commit_hashes?.length ? run.commit_hashes.join(", ") : "unknown"}
- commit blocker: ${run.commit_blocked_reason || "none"}
- push evidence: ${push ? path.join(dir, "evidence", "push.md") : "missing"}
- push status: ${run.push_status || "unknown"}
- push local commit: ${run.push_local_commit || run.commit_hashes?.at(-1) || "unknown"}
- push user action: ${run.push_user_action || "none"}

## Project Knowledge Updates

${projectUpdateFiles.length > 0 ? projectUpdateFiles.map((file) => `- ${file}`).join("\n") : "- none"}

## Archive Confirmation

${checks.map((check) => `- ${check.status}: ${check.id} (${check.detail})`).join("\n")}

## Blocked or Follow-Up Items

${blockedItems.length > 0 ? blockedItems.map((item) => `- ${item}`).join("\n") : "- none"}
`;
}

function writeProjectKnowledge(cwd: string, runId: string, graph: TaskGraph | null): string[] {
  const projectDir = path.join(workspace(cwd), "project");
  const dir = runDir(cwd, runId);
  const requirement = firstContentLine(path.join(dir, "request", "normalized.md"));
  const title = `Archived Run ${runId}`;
  const files: string[] = [];

  const updates: Array<[string, string]> = [
    ["overview.md", `Requirement: ${requirement}\n\nReport: .imfine/reports/${runId}.md`],
    ["product.md", `Delivered requirement: ${requirement}`],
    ["architecture.md", `Design evidence:\n\n- .imfine/runs/${runId}/design/solution-design.md\n- .imfine/runs/${runId}/design/architecture-decisions.md`],
    ["test-strategy.md", `Verification evidence:\n\n- .imfine/runs/${runId}/evidence/test-results.md`],
    ["risks.md", `Risk evidence:\n\n- .imfine/runs/${runId}/analysis/risk-analysis.md\n- .imfine/runs/${runId}/archive/archive-report.md`]
  ];

  for (const [file, body] of updates) {
    const target = path.join(projectDir, file);
    appendProjectSection(target, title, body);
    files.push(target);
  }

  const capabilityDir = path.join(projectDir, "capabilities", safeName(runId));
  const capability = path.join(capabilityDir, "spec.md");
  const specDeltaDir = path.join(dir, "spec-delta");
  const specDeltaFiles = fs.existsSync(specDeltaDir)
    ? fs.readdirSync(specDeltaDir).filter((file) => file.endsWith(".md")).sort().map((file) => path.join(".imfine", "runs", runId, "spec-delta", file))
    : [];
  writeText(capability, `# Capability: ${runId}

## Requirement

${requirement}

## Verified Facts

- Archive status is verified by .imfine/runs/${runId}/archive/archive-report.md.
- QA evidence is verified by .imfine/runs/${runId}/evidence/test-results.md.
- Review evidence is verified by .imfine/runs/${runId}/evidence/review.md.
- Commit evidence is verified by .imfine/runs/${runId}/evidence/commits.md.

## Inferences

- Product and architecture notes are carried forward only when supported by run evidence.
- Future agents must re-check source files before relying on inferred module impact.

## Delivered Tasks

${taskLines(graph, cwd, runId).join("\n")}

## Spec Delta

${specDeltaFiles.length > 0 ? specDeltaFiles.map((file) => `- ${file}`).join("\n") : "- no run-local spec delta recorded"}

## Evidence

- archive: .imfine/runs/${runId}/archive/archive-report.md
- report: .imfine/reports/${runId}.md
- design: .imfine/runs/${runId}/design/solution-design.md
- tests: .imfine/runs/${runId}/evidence/test-results.md
- review: .imfine/runs/${runId}/evidence/review.md
- commits: .imfine/runs/${runId}/evidence/commits.md
`);
  files.push(capability);

  return files;
}

export function archiveRun(cwd: string, runId: string): ArchiveResult {
  const dir = runDir(cwd, runId);
  transitionRunState(cwd, runId, "archiving", { archiving_at: new Date().toISOString() });
  const graph = readTaskGraph(cwd, runId);
  const archiveDir = path.join(dir, "archive");
  const agentDir = path.join(dir, "agents", "archive");
  ensureDir(archiveDir);
  ensureDir(agentDir);

  const checks: ArchiveCheck[] = [
    checkFile("requirement-analysis", path.join(dir, "analysis", "requirement-analysis.md")),
    checkFile("solution-design", path.join(dir, "design", "solution-design.md")),
    checkFile("task-graph", path.join(dir, "planning", "task-graph.json")),
    checkFile("test-results", path.join(dir, "evidence", "test-results.md")),
    checkFile("review", path.join(dir, "evidence", "review.md")),
    ...outcomeChecks(cwd, runId),
    ...taskEvidenceChecks(cwd, runId, graph)
  ];

  const blockedItems = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.detail}`);
  const status: ArchiveStatus = blockedItems.length === 0 ? "archived" : "blocked";
  const projectUpdateFiles = status === "archived" ? writeProjectKnowledge(cwd, runId, graph) : [];

  const archiveReport = path.join(archiveDir, "archive-report.md");
  const projectUpdates = path.join(archiveDir, "project-updates.md");
  const finalSummary = path.join(archiveDir, "final-summary.md");
  const userReport = path.join(workspace(cwd), "reports", `${runId}.md`);

  const report = buildArchiveReport(cwd, runId, status, checks, blockedItems, projectUpdateFiles);
  writeText(archiveReport, report);
  writeText(userReport, report);
  writeText(projectUpdates, `# Project Updates

${projectUpdateFiles.length > 0 ? projectUpdateFiles.map((file) => `- ${file}`).join("\n") : "- none; archive blocked before long-term knowledge update"}
`);
  writeText(finalSummary, `# Final Summary

- run id: ${runId}
- status: ${status}
- report: ${userReport}
- blocked items: ${blockedItems.length}
`);

  writeText(path.join(agentDir, "input.md"), `# Archive Input

- run: ${runId}
- task graph: ${graphFile(cwd, runId)}
- test evidence: ${path.join(dir, "evidence", "test-results.md")}
- review evidence: ${path.join(dir, "evidence", "review.md")}
- commit evidence: ${path.join(dir, "evidence", "commits.md")}
- push evidence: ${path.join(dir, "evidence", "push.md")}
`);
  writeText(path.join(agentDir, "output.md"), `# Archive Output

- status: ${status}
- archive report: ${archiveReport}
- user report: ${userReport}
- blocked items: ${blockedItems.length}
`);
  writeText(path.join(agentDir, "status.json"), `${JSON.stringify({ run_id: runId, status, blocked_items: blockedItems }, null, 2)}\n`);
  writeText(path.join(agentDir, "handoff.json"), `${JSON.stringify({
    run_id: runId,
    from: "archive",
    to: "orchestrator",
    status,
    summary: status === "archived" ? "Archive completed" : "Archive blocked by missing evidence",
    archive_report: archiveReport,
    project_updates: projectUpdateFiles,
    blocked_items: blockedItems,
    next_state: status
  }, null, 2)}\n`);

  updateRun(cwd, runId, status, {
    archive_status: status,
    archived_at: status === "archived" ? new Date().toISOString() : undefined,
    archive_blocked_at: status === "blocked" ? new Date().toISOString() : undefined,
    archive_report: archiveReport,
    user_report: userReport
  });

  return {
    runId,
    status,
    archiveReport,
    userReport,
    projectUpdates,
    finalSummary,
    agent: agentDir,
    checks,
    blockedItems
  };
}
