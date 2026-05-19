import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateAgentHandoff } from "./handoff-evidence.js";
import { validateHandoff } from "./handoff-validator.js";
import { writeProviderExecutionReceipt } from "./provider-evidence.js";
import { refreshOrchestrationSnapshot } from "./orchestration-sync.js";
import { type TaskGraph } from "./plan.js";
import { assertTransitionAccepted, transitionRunState } from "./state-machine.js";
import { validateTrueHarnessEvidenceFiles, writePreArchiveHarnessEvidence, writeTrueHarnessEvidence } from "./true-harness-evidence.js";
import { writeCapabilityTrace, writeRunTraceIndex } from "./trace.js";
import { runCommand } from "./shell.js";

export type ArchiveStatus = "completed" | "blocked";

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

export interface ArchiveRunOptions {
  archiveAction?: {
    id: string;
    role: string;
    taskId?: string;
    parallelGroup: string;
    iteration?: number;
  };
}

interface ParallelExecutionWave {
  iteration: number;
  parallel_group: string;
  action_ids: string[];
  task_ids: string[];
  roles: string[];
  status: "waiting_for_agent_output" | "completed" | "blocked";
  reason: string;
  started_at: string;
  completed_at?: string;
}

interface RunMetadata {
  run_id: string;
  status?: string;
  execution_mode?: string;
  project_kind?: string;
  run_branch?: string;
  push_status?: string;
  push_user_action?: string;
  push_local_commit?: string;
  commit_hashes?: string[];
  commit_set?: string[];
  implementation_commit?: string;
  evidence_sync_commit?: string;
  archive_commit?: string;
  final_head?: string;
  pushed_head?: string;
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

function updateRunMetadataFile(cwd: string, runId: string, extra: Record<string, unknown>): void {
  const file = path.join(runDir(cwd, runId), "run.json");
  const current = readJson<Record<string, unknown>>(file);
  writeText(file, `${JSON.stringify({ ...current, ...extra, updated_at: new Date().toISOString() }, null, 2)}\n`);
}

function recordArchiveIdentity(cwd: string, runId: string): void {
  const head = runCommand("git", ["rev-parse", "HEAD"], cwd);
  const status = runCommand("git", ["status", "--porcelain"], cwd);
  const finalHead = head.code === 0 && head.stdout.trim() ? head.stdout.trim() : undefined;
  updateRunMetadataFile(cwd, runId, {
    archive_started_head: finalHead,
    archive_commit: finalHead,
    final_head: finalHead,
    worktree_clean_before_archive: status.code === 0 ? status.stdout.trim().length === 0 : false,
    worktree_status_before_archive: status.code === 0 ? status.stdout.trim() : status.stderr || status.error || "unknown"
  });
}

function recordArchiveWave(cwd: string, runId: string, options: ArchiveRunOptions, status: ArchiveStatus): void {
  const action = options.archiveAction;
  if (!action) return;
  const file = path.join(runDir(cwd, runId), "orchestration", "parallel-execution.json");
  const current = fs.existsSync(file)
    ? readJson<{
      schema_version?: number;
      run_id?: string;
      artifact_type?: string;
      wave_history?: ParallelExecutionWave[];
      executed_parallel_groups?: string[];
      blocked_parallel_groups?: string[];
    }>(file)
    : { schema_version: 1, run_id: runId, artifact_type: "execution" };
  const waveHistory = Array.isArray(current.wave_history) ? current.wave_history : [];
  if (waveHistory.some((wave) => wave.action_ids.includes(action.id) && wave.status === status)) return;
  const executed = new Set(Array.isArray(current.executed_parallel_groups) ? current.executed_parallel_groups : []);
  const blocked = new Set(Array.isArray(current.blocked_parallel_groups) ? current.blocked_parallel_groups : []);
  const waveStatus = status === "completed" ? "completed" : "blocked";
  if (waveStatus === "completed") executed.add(action.parallelGroup);
  if (waveStatus === "blocked") blocked.add(action.parallelGroup);
  const now = new Date().toISOString();
  waveHistory.push({
    iteration: action.iteration || 0,
    parallel_group: action.parallelGroup,
    action_ids: [action.id],
    task_ids: action.taskId ? [action.taskId] : [],
    roles: [action.role],
    status: waveStatus,
    reason: `archive status: ${status}`,
    started_at: now,
    completed_at: now
  });
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    artifact_type: "execution",
    executed_parallel_groups: Array.from(executed).sort(),
    blocked_parallel_groups: Array.from(blocked).sort(),
    wave_history: waveHistory
  }, null, 2)}\n`);
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

function qaHandoffFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `qa-${taskId}`, "handoff.json");
}

function reviewHandoffFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `reviewer-${taskId}`, "handoff.json");
}

function taskHandoffFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", taskId, "handoff.json");
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

function handoffEvidenceCheck(id: string, role: "qa" | "reviewer", file: string, runId: string, taskId: string): ArchiveCheck {
  if (!fs.existsSync(file)) return { id, status: "fail", detail: `missing handoff: ${file}` };
  const parsed = readJson<unknown>(file);
  const validation = validateHandoff(role, parsed, runId, taskId);
  if (!validation.passed) return { id, status: "fail", detail: `${file}: ${validation.errors.join("; ")}` };
  const evidence = (parsed as { evidence?: unknown[] }).evidence || [];
  const missing = evidence.filter((item) => typeof item !== "string" || !fs.existsSync(item));
  return {
    id,
    status: missing.length === 0 ? "pass" : "fail",
    detail: missing.length === 0 ? file : `${file}: missing evidence ${missing.map(String).join(", ")}`
  };
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

    if (task.type === "docs") {
      const handoff = taskHandoffFile(cwd, runId, task.id);
      const docsHandoff = validateAgentHandoff({ id: task.id, role: "technical-writer", taskId: task.id }, runDir(cwd, runId), runId);
      const reviewEvidence = path.join(runDir(cwd, runId), "evidence", "review.md");
      const docsDone = docsHandoff.passed && fs.existsSync(reviewEvidence);
      checks.push({
        id: `task.${task.id}.docs`,
        status: docsDone ? "pass" : "fail",
        detail: docsDone ? handoff : `${handoff} and ${reviewEvidence}`
      });
      continue;
    }

    if (task.type === "qa" || task.type === "qa_gate") {
      const evidence = path.join(runDir(cwd, runId), "evidence", "test-results.md");
      checks.push({
        id: `task.${task.id}.qa_gate`,
        status: fs.existsSync(evidence) ? "pass" : "fail",
        detail: evidence
      });
      continue;
    }

    if (task.type === "review" || task.type === "review_gate") {
      const evidence = path.join(runDir(cwd, runId), "evidence", "review.md");
      checks.push({
        id: `task.${task.id}.review_gate`,
        status: fs.existsSync(evidence) ? "pass" : "fail",
        detail: evidence
      });
      continue;
    }

    if (task.type === "delivery_gate") {
      const commitEvidence = path.join(runDir(cwd, runId), "evidence", "commits.md");
      const pushEvidence = path.join(runDir(cwd, runId), "evidence", "push.md");
      const committer = validateAgentHandoff({ id: "committer", role: "committer" }, runDir(cwd, runId), runId);
      const deliveryReady = committer.passed && commitOutcomeKnown && fs.existsSync(commitEvidence) && fs.existsSync(pushEvidence);
      checks.push({
        id: `task.${task.id}.delivery_gate`,
        status: deliveryReady ? "pass" : "fail",
        detail: deliveryReady ? `${commitEvidence}, ${pushEvidence}` : `${committer.file || "committer handoff"}, ${commitEvidence}, ${pushEvidence}`
      });
      continue;
    }

    if (task.type === "archive") {
      checks.push({
        id: `task.${task.id}.archive_gate`,
        status: "pass",
        detail: "run-level archive gate is evaluated by archiveRun"
      });
      continue;
    }

    checks.push({
      id: `task.${task.id}.qa`,
      status: qa.status === "pass" ? "pass" : "fail",
      detail: qaFile
    });
    checks.push(handoffEvidenceCheck(`task.${task.id}.qa_handoff`, "qa", qaHandoffFile(cwd, runId, task.id), runId, task.id));
    checks.push({
      id: `task.${task.id}.review`,
      status: review.status === "approved" ? "pass" : "fail",
      detail: reviewFile
    });
    checks.push(handoffEvidenceCheck(`task.${task.id}.review_handoff`, "reviewer", reviewHandoffFile(cwd, runId, task.id), runId, task.id));
    checks.push({
      id: `task.${task.id}.commit`,
      status: taskStatus.status === "committed" || taskStatus.status === "exempt" || commitOutcomeKnown ? "pass" : "fail",
      detail: statusFile
    });
  }
  return checks;
}

function trueHarnessCheck(cwd: string, runId: string): ArchiveCheck {
  const file = path.join(runDir(cwd, runId), "orchestration", "true-harness-evidence.json");
  const markdown = path.join(runDir(cwd, runId), "orchestration", "true-harness-evidence.md");
  if (!fs.existsSync(file)) return { id: "true-harness-evidence", status: "fail", detail: `missing ${file}` };
  const evidence = readJson<{ true_harness_passed?: boolean }>(file);
  const consistency = validateTrueHarnessEvidenceFiles(file, markdown);
  return {
    id: "true-harness-evidence",
    status: evidence.true_harness_passed === true && consistency.passed ? "pass" : "fail",
    detail: consistency.passed ? file : `${file}: ${consistency.errors.join("; ")}`
  };
}

function preArchiveHarnessCheck(file: string): ArchiveCheck {
  if (!fs.existsSync(file)) return { id: "pre-archive-harness", status: "fail", detail: `missing ${file}` };
  const evidence = readJson<{ pre_archive_harness_passed?: boolean; missing_completed_wave_contracts?: unknown[]; invalid_handoffs?: unknown[]; missing_provider_receipt_contracts?: unknown[]; missing_standard_evidence?: unknown[] }>(file);
  const blocked = [
    ...(Array.isArray(evidence.missing_completed_wave_contracts) ? evidence.missing_completed_wave_contracts : []),
    ...(Array.isArray(evidence.invalid_handoffs) ? evidence.invalid_handoffs.map((item) => JSON.stringify(item)) : []),
    ...(Array.isArray(evidence.missing_provider_receipt_contracts) ? evidence.missing_provider_receipt_contracts : []),
    ...(Array.isArray(evidence.missing_standard_evidence) ? evidence.missing_standard_evidence : [])
  ].map(String);
  return {
    id: "pre-archive-harness",
    status: evidence.pre_archive_harness_passed === true ? "pass" : "fail",
    detail: blocked.length > 0 ? blocked.join(", ") : file
  };
}

function runLevelGateChecks(cwd: string, runId: string): ArchiveCheck[] {
  const dir = runDir(cwd, runId);
  const committer = validateAgentHandoff({ id: "committer", role: "committer" }, dir, runId);
  return [
    checkFile("run-level.qa-evidence", path.join(dir, "evidence", "test-results.md")),
    checkFile("run-level.review-evidence", path.join(dir, "evidence", "review.md")),
    {
      id: "run-level.committer-handoff",
      status: committer.passed ? "pass" : "fail",
      detail: committer.passed ? committer.file || "committer handoff" : `${committer.file || path.join(dir, "agents", "committer", "handoff.json")}: ${committer.errors.join("; ")}`
    }
  ];
}

function runLevelArchiveGateChecks(cwd: string, runId: string): ArchiveCheck[] {
  const dir = runDir(cwd, runId);
  const archive = validateAgentHandoff({ id: "archive", role: "archive" }, dir, runId);
  const archiveStatusFile = path.join(dir, "agents", "archive", "status.json");
  const archiveStatus = fs.existsSync(archiveStatusFile) ? readJson<{ status?: string }>(archiveStatusFile).status : "missing";
  return [
    {
      id: "run-level.archive-status",
      status: archiveStatus === "completed" || archiveStatus === "blocked" ? "pass" : "fail",
      detail: `${archiveStatus}: ${archiveStatusFile}`
    },
    {
      id: "run-level.archive-handoff",
      status: archive.passed ? "pass" : "fail",
      detail: archive.passed ? archive.file || "archive handoff" : `${archive.file || path.join(dir, "agents", "archive", "handoff.json")}: ${archive.errors.join("; ")}`
    }
  ];
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
  assertTransitionAccepted(transitionRunState(cwd, runId, status === "completed" ? "completed" : "blocked", extra), `archive run ${runId}`);
}

function archiveBlockedItems(checks: ArchiveCheck[]): string[] {
  return checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.detail}`);
}

function writeArchiveBlockerMatrix(cwd: string, runId: string, checks: ArchiveCheck[]): string {
  const dir = runDir(cwd, runId);
  const reviewDir = path.join(dir, "review");
  ensureDir(reviewDir);
  const run = readJson<RunMetadata>(path.join(dir, "run.json"));
  const file = path.join(reviewDir, "blocker-matrix.json");
  const rows = checks
    .filter((check) => check.status === "fail")
    .map((check) => ({
      id: check.id,
      source: "archive",
      severity: check.id.includes("true-harness") || check.id.includes("pre-archive") ? "P0" : "P1",
      status: "still_blocking",
      summary: check.detail,
      code_evidence: [],
      test_evidence: check.id.includes("qa") || check.id.includes("test") ? ["evidence/test-results.md"] : [],
      commit: run.final_head || null,
      recheck: "archive gate blocked"
    }));
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    final_head: run.final_head || null,
    rows,
    summary: {
      total: rows.length,
      still_blocking: rows.length,
      resolved: 0,
      accepted_residual: 0,
      obsolete: 0
    }
  }, null, 2)}\n`);
  return file;
}

function writeDerivedFinalGates(cwd: string, runId: string, status: ArchiveStatus, checks: ArchiveCheck[], projectUpdateFiles: string[]): string {
  const file = path.join(runDir(cwd, runId), "orchestration", "final-gates.json");
  const checkStatus = (id: string) => checks.find((check) => check.id === id)?.status === "pass";
  const allTaskChecksPassed = checks.filter((check) => check.id.startsWith("task.")).every((check) => check.status === "pass");
  const dispatchPassed = checkStatus("true-harness-evidence");
  const qaPassed = checkStatus("test-results") && checks.filter((check) => check.id.endsWith(".qa") || check.id.endsWith(".qa_handoff") || check.id.endsWith(".qa_gate")).every((check) => check.status === "pass");
  const reviewPassed = checkStatus("review") && checks.filter((check) => check.id.endsWith(".review") || check.id.endsWith(".review_handoff") || check.id.endsWith(".review_gate")).every((check) => check.status === "pass");
  const committerPassed = checkStatus("run-level.committer-handoff") && checkStatus("commit-outcome");
  const pushPassed = checkStatus("push-outcome");
  const archivePassed = checkStatus("run-level.archive-status") && checkStatus("run-level.archive-handoff") && status === "completed";
  const projectKnowledgePassed = status === "completed" && projectUpdateFiles.length > 0;
  const gates = {
    planning: checkStatus("project-context") && checkStatus("runtime-context") && checkStatus("task-graph") ? "pass" : "blocked",
    dispatch: dispatchPassed ? "pass" : "blocked",
    qa: qaPassed ? "pass" : "blocked",
    review: reviewPassed ? "pass" : "blocked",
    recheck_fix_loop: allTaskChecksPassed && qaPassed && reviewPassed ? "pass" : "blocked",
    committer: committerPassed ? "pass" : "blocked",
    push: pushPassed ? "pass" : "blocked",
    archive: archivePassed ? "pass" : "blocked",
    true_harness: checkStatus("true-harness-evidence") ? "pass" : "blocked",
    project_knowledge: projectKnowledgePassed ? "pass" : "blocked"
  };
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_by: "imfine-runtime",
    generated_at: new Date().toISOString(),
    source: "derived_from_standard_evidence",
    gates,
    checks: checks.map((check) => ({ id: check.id, status: check.status, detail: check.detail }))
  }, null, 2)}\n`);
  return file;
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

function qaStatusLines(graph: TaskGraph | null, cwd: string, runId: string): string {
  if (!graph) return "missing";
  return graph.tasks.map((task) => {
    const file = qaStatusFile(cwd, runId, task.id);
    const qa = fs.existsSync(file) ? readJson<{ status?: string }>(file) : {};
    return `${task.id}=${qa.status || "missing"}`;
  }).join(", ");
}

function reviewStatusLines(graph: TaskGraph | null, cwd: string, runId: string): string {
  if (!graph) return "missing";
  return graph.tasks.map((task) => {
    const file = reviewStatusFile(cwd, runId, task.id);
    const review = fs.existsSync(file) ? readJson<{ status?: string }>(file) : {};
    return `${task.id}=${review.status || "missing"}`;
  }).join(", ");
}

function buildArchiveReport(cwd: string, runId: string, status: ArchiveStatus, checks: ArchiveCheck[], blockedItems: string[], projectUpdateFiles: string[]): string {
  const dir = runDir(cwd, runId);
  const run = readJson<RunMetadata>(path.join(dir, "run.json"));
  const graph = readTaskGraph(cwd, runId);
  const requirement = firstContentLine(path.join(dir, "request", "normalized.md"));
  const commits = readTextIfExists(path.join(dir, "evidence", "commits.md"));
  const push = readTextIfExists(path.join(dir, "evidence", "push.md"));
  const harnessEvidence = path.join(dir, "orchestration", "true-harness-evidence.md");
  const harnessEvidenceJson = path.join(dir, "orchestration", "true-harness-evidence.json");
  const methodProvenance = path.join(dir, "orchestration", "method-provenance.json");
  const harness = fs.existsSync(harnessEvidenceJson)
    ? readJson<{ harness_classification?: string; true_harness_passed?: boolean }>(harnessEvidenceJson)
    : null;

  return `# Archive Report

## Run

- run id: ${runId}
- status: ${status}
- execution mode: ${run.execution_mode || "unknown"}
- harness classification: ${harness?.harness_classification || "unknown"}
- true harness passed: ${harness?.true_harness_passed ? "yes" : "no"}
- project kind: ${run.project_kind || "unknown"}
- run branch: ${run.run_branch || "unknown"}

## Requirement

${requirement}

## Delivered Changes

${taskLines(graph, cwd, runId).join("\n")}

## Evidence Chain

- request: ${path.join(dir, "request", "normalized.md")}
- project context: ${path.join(dir, "analysis", "project-context.md")}
- impact analysis: ${path.join(dir, "analysis", "impact-analysis.md")}
- risk analysis: ${path.join(dir, "analysis", "risk-analysis.md")}
- runtime context: ${path.join(dir, "orchestration", "context.json")}
- task graph: ${path.join(dir, "planning", "task-graph.json")}
- execution plan: ${path.join(dir, "planning", "execution-plan.md")}
- commit plan: ${path.join(dir, "planning", "commit-plan.md")}

## Verification Evidence

- test results: ${path.join(dir, "evidence", "test-results.md")}
- QA status: ${qaStatusLines(graph, cwd, runId)}

## Review Evidence

- review evidence: ${path.join(dir, "evidence", "review.md")}
- Review status: ${reviewStatusLines(graph, cwd, runId)}

## Commit and Push

- commit evidence: ${commits ? path.join(dir, "evidence", "commits.md") : "missing"}
- commit hashes: ${run.commit_hashes?.length ? run.commit_hashes.join(", ") : "missing"}
- commit set: ${run.commit_set?.length ? run.commit_set.join(", ") : "missing"}
- implementation commit: ${run.implementation_commit || "missing"}
- evidence sync commit: ${run.evidence_sync_commit || "none"}
- archive commit: ${run.archive_commit || "missing"}
- final head: ${run.final_head || "missing"}
- commit blocker: ${run.commit_blocked_reason || "none"}
- push evidence: ${push ? path.join(dir, "evidence", "push.md") : "missing"}
- push status: ${run.push_status || "missing"}
- push local commit: ${run.push_local_commit || run.commit_hashes?.at(-1) || "missing"}
- pushed head: ${run.pushed_head || "missing"}
- push user action: ${run.push_user_action || "none"}

## True Harness Evidence

- true harness evidence: ${fs.existsSync(harnessEvidence) ? harnessEvidence : "missing"}
- method provenance: ${fs.existsSync(methodProvenance) ? methodProvenance : "missing"}

## Project Knowledge Updates

${projectUpdateFiles.length > 0 ? projectUpdateFiles.map((file) => `- ${file}`).join("\n") : status === "blocked" ? "- blocked: archive did not update long-term project knowledge because required evidence is incomplete" : "- none"}

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
    ["architecture.md", `Runtime and design evidence:\n\n- .imfine/runs/${runId}/orchestration/context.json\n- .imfine/runs/${runId}/archive/archive-report.md`],
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
- runtime context: .imfine/runs/${runId}/orchestration/context.json
- tests: .imfine/runs/${runId}/evidence/test-results.md
- review: .imfine/runs/${runId}/evidence/review.md
- commits: .imfine/runs/${runId}/evidence/commits.md
`);
  files.push(capability);
  files.push(writeCapabilityTrace(cwd, runId, capability));
  files.push(writeProjectKnowledgeFreshness(cwd, runId));

  return files;
}

function writeProjectKnowledgeFreshness(cwd: string, runId: string): string {
  const projectDir = path.join(workspace(cwd), "project");
  const file = path.join(projectDir, "project-knowledge-freshness.json");
  const markers = ["initialized from limited evidence", "not detected", "unknown", ".gitignore only", "no source evidence", "no test evidence"];
  const stale: Array<{ file: string; marker: string }> = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && target.endsWith(".md")) {
        const text = readTextIfExists(target).toLowerCase();
        for (const marker of markers) {
          if (text.includes(marker)) stale.push({ file: path.relative(cwd, target), marker });
        }
      }
    }
  };
  walk(projectDir);
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    status: stale.length === 0 ? "fresh" : "stale_markers_found",
    stale
  }, null, 2)}\n`);
  return file;
}

export function archiveRun(cwd: string, runId: string, options: ArchiveRunOptions = {}): ArchiveResult {
  const dir = runDir(cwd, runId);
  const preArchiveEvidence = writePreArchiveHarnessEvidence(cwd, runId);
  assertTransitionAccepted(transitionRunState(cwd, runId, "archiving", { archiving_at: new Date().toISOString() }), `start archive for ${runId}`);
  recordArchiveIdentity(cwd, runId);
  const graph = readTaskGraph(cwd, runId);
  const archiveDir = path.join(dir, "archive");
  const agentDir = path.join(dir, "agents", "archive");
  ensureDir(archiveDir);
  ensureDir(agentDir);

  const baseChecks: ArchiveCheck[] = [
    checkFile("project-context", path.join(dir, "analysis", "project-context.md")),
    checkFile("runtime-context", path.join(dir, "orchestration", "context.json")),
    checkFile("task-graph", path.join(dir, "planning", "task-graph.json")),
    checkFile("test-results", path.join(dir, "evidence", "test-results.md")),
    checkFile("review", path.join(dir, "evidence", "review.md")),
    preArchiveHarnessCheck(preArchiveEvidence.json),
    ...runLevelGateChecks(cwd, runId),
    ...outcomeChecks(cwd, runId),
    ...taskEvidenceChecks(cwd, runId, graph)
  ];

  const archiveReport = path.join(archiveDir, "archive-report.md");
  const projectUpdates = path.join(archiveDir, "project-updates.md");
  const finalSummary = path.join(archiveDir, "final-summary.md");
  const userReport = path.join(workspace(cwd), "reports", `${runId}.md`);
  const preliminaryBlocked = archiveBlockedItems(baseChecks);
  let status: ArchiveStatus = preliminaryBlocked.length === 0 ? "completed" : "blocked";
  let blockedItems = preliminaryBlocked;
  let projectUpdateFiles: string[] = [];

  const writeArchiveAgent = (archiveStatus: ArchiveStatus, items: string[], updates: string[]): void => {
    writeText(path.join(agentDir, "input.md"), `# Archive Input

- run: ${runId}
- task graph: ${graphFile(cwd, runId)}
- test evidence: ${path.join(dir, "evidence", "test-results.md")}
- review evidence: ${path.join(dir, "evidence", "review.md")}
- commit evidence: ${path.join(dir, "evidence", "commits.md")}
- push evidence: ${path.join(dir, "evidence", "push.md")}
`);
    writeText(path.join(agentDir, "output.md"), `# Archive Output

- status: ${archiveStatus}
- archive report: ${archiveReport}
- user report: ${userReport}
- blocked items: ${items.length}
`);
    writeText(path.join(agentDir, "status.json"), `${JSON.stringify({ run_id: runId, status: archiveStatus, blocked_items: items }, null, 2)}\n`);
    writeText(path.join(agentDir, "handoff.json"), `${JSON.stringify({
      run_id: runId,
      task_id: "run",
      role: "archive",
      from: "archive",
      to: "orchestrator",
      status: archiveStatus,
      summary: archiveStatus === "completed" ? "Archive completed" : "Archive blocked by missing evidence",
      commands: [],
      evidence: [archiveReport, userReport],
      archive_report: archiveReport,
      project_updates: updates,
      blocked_items: items,
      next_state: archiveStatus
    }, null, 2)}\n`);
  };

  writeArchiveAgent(status, blockedItems, projectUpdateFiles);
  const preliminaryReport = buildArchiveReport(cwd, runId, status, baseChecks, blockedItems, projectUpdateFiles);
  writeText(archiveReport, preliminaryReport);
  writeText(userReport, preliminaryReport);
  recordArchiveWave(cwd, runId, options, status);
  writeProviderExecutionReceipt(cwd, runId, {
    actionId: options.archiveAction?.id || "agent-archive",
    agentId: "archive",
    role: "archive",
    parallelGroup: options.archiveAction?.parallelGroup || "archive",
    status,
    metadata: { phase: "archive-run", archive_report: archiveReport, user_report: userReport }
  });
  writeTrueHarnessEvidence(cwd, runId);

  const checks = [...baseChecks, ...runLevelArchiveGateChecks(cwd, runId), trueHarnessCheck(cwd, runId)];
  const blockerMatrix = writeArchiveBlockerMatrix(cwd, runId, checks);
  blockedItems = archiveBlockedItems(checks);
  status = blockedItems.length === 0 ? "completed" : "blocked";
  if (status === "completed") writeRunTraceIndex(cwd, runId);
  projectUpdateFiles = status === "completed" ? writeProjectKnowledge(cwd, runId, graph) : [];
  writeArchiveAgent(status, blockedItems, projectUpdateFiles);

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

  writeDerivedFinalGates(cwd, runId, status, checks, projectUpdateFiles);
  writeRunTraceIndex(cwd, runId);
  writeTrueHarnessEvidence(cwd, runId);
  updateRun(cwd, runId, status, {
    archived_at: status === "completed" ? new Date().toISOString() : undefined,
    archive_blocked_at: status === "blocked" ? new Date().toISOString() : undefined,
    archive_report: archiveReport,
    user_report: userReport
  });
  refreshOrchestrationSnapshot(cwd, runId);

  return {
    runId,
    status,
    archiveReport,
    userReport,
    projectUpdates,
    finalSummary,
    agent: agentDir,
    checks: [...checks, { id: "blocker-matrix", status: fs.existsSync(blockerMatrix) ? "pass" : "fail", detail: blockerMatrix }],
    blockedItems
  };
}
