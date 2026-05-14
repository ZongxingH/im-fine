import fs from "node:fs";
import path from "node:path";
import { readFixLoopDesignReworkState, readFixLoopRecoveryState } from "./fix-loop.js";
import { ensureDir, writeText } from "./fs.js";
import { refreshOrchestrationSnapshot } from "./orchestration-sync.js";
import { type TaskGraph, type TaskGraphTask } from "./plan.js";
import { runShellCommand } from "./shell.js";
import { assertTransitionAccepted, transitionRunState, transitionTaskState } from "./state-machine.js";
import { validatePatch } from "./worktree.js";

export type VerificationStatus = "pass" | "fail" | "blocked";
export type ReviewDecision = "approved" | "changes_requested" | "blocked";

export interface VerificationCommandResult {
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface VerificationResult {
  runId: string;
  taskId: string;
  status: VerificationStatus;
  summary: string;
  commands: VerificationCommandResult[];
  evidence: string;
  agent: string;
  fixTaskId?: string;
  errors: string[];
}

export interface ReviewResult {
  runId: string;
  taskId: string;
  status: ReviewDecision;
  summary: string;
  evidence: string;
  agent: string;
  fixTaskId?: string;
  errors: string[];
}

export interface DesignReworkResult {
  runId: string;
  taskId: string;
  status: "needs_design_update";
  summary: string;
  evidence: string;
  architectInput: string;
  taskPlannerInput: string;
}

interface WorktreeIndex {
  tasks: Array<{
    task_id: string;
    path: string;
  }>;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function graphFile(cwd: string, runId: string): string {
  const file = path.join(runDir(cwd, runId), "planning", "task-graph.json");
  if (!fs.existsSync(file)) throw new Error(`Missing task graph for run: ${runId}`);
  return file;
}

function readGraph(cwd: string, runId: string): TaskGraph {
  return readJson<TaskGraph>(graphFile(cwd, runId));
}

function writeGraph(cwd: string, runId: string, graph: TaskGraph): void {
  writeText(graphFile(cwd, runId), `${JSON.stringify(graph, null, 2)}\n`);
}

function taskById(graph: TaskGraph, taskId: string): TaskGraphTask {
  const task = graph.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown task ${taskId} in run ${graph.run_id}`);
  return task;
}

function worktreeForTask(cwd: string, runId: string, taskId: string): string {
  const file = path.join(runDir(cwd, runId), "worktrees", "index.json");
  if (!fs.existsSync(file)) throw new Error(`Missing worktree index for run: ${runId}. Run worktree prepare first.`);
  const index = readJson<WorktreeIndex>(file);
  const task = index.tasks.find((item) => item.task_id === taskId);
  if (!task) throw new Error(`Missing worktree for task ${taskId}`);
  return task.path;
}

function executableVerificationCommands(task: TaskGraphTask): string[] {
  return task.verification.filter((command) => {
    const normalized = command.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.includes("unknown")) return false;
    if (normalized === "documentation review") return false;
    return true;
  });
}

function normalizeVerificationStatus(value: VerificationStatus | undefined): VerificationStatus | undefined {
  if (!value) return undefined;
  if (value === "pass" || value === "fail" || value === "blocked") return value;
  throw new Error("Invalid verify --status. Expected pass, fail, or blocked.");
}

function updateRunStatus(cwd: string, runId: string, status: string, extra: Record<string, unknown> = {}): void {
  assertTransitionAccepted(transitionRunState(cwd, runId, status, extra), `update run ${runId}`);
}

function updateTaskStatus(cwd: string, runId: string, taskId: string, status: string, extra: Record<string, unknown> = {}): void {
  assertTransitionAccepted(transitionTaskState(cwd, runId, taskId, status, extra), `update task ${taskId}`);
}

function writeEvidenceSection(file: string, title: string, section: string): void {
  ensureDir(path.dirname(file));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# ${title}\n\n${section}\n`);
    return;
  }
  fs.appendFileSync(file, `\n\n${section}\n`);
}

function writeTaskFiles(cwd: string, runId: string, task: TaskGraphTask): void {
  const dir = path.join(runDir(cwd, runId), "tasks", task.id);
  const base = `# ${task.id}: ${task.title}\n\n## Goal\n\n${task.title}\n\n## Read Scope\n\n${task.read_scope.map((item) => `- ${item}`).join("\n")}\n\n## Write Scope\n\n${task.write_scope.map((item) => `- ${item}`).join("\n")}\n\n## Dependencies\n\n${task.depends_on.map((item) => `- ${item}`).join("\n")}\n\n## Acceptance\n\n${task.acceptance.map((item) => `- ${item}`).join("\n")}\n\n## Dev Plan\n\n${task.dev_plan.map((item) => `- ${item}`).join("\n")}\n\n## Test Plan\n\n${task.test_plan.map((item) => `- ${item}`).join("\n")}\n\n## Review Plan\n\n${task.review_plan.map((item) => `- ${item}`).join("\n")}\n\n## Commit Plan\n\n- Mode: ${task.commit.mode}\n- Message: ${task.commit.message}\n`;
  writeText(path.join(dir, "task.md"), base);
  writeText(path.join(dir, "dev-plan.md"), `# Dev Plan\n\n${task.dev_plan.map((item) => `- ${item}`).join("\n")}\n`);
  writeText(path.join(dir, "test-plan.md"), `# Test Plan\n\n${task.test_plan.map((item) => `- ${item}`).join("\n")}\n`);
  writeText(path.join(dir, "review-plan.md"), `# Review Plan\n\n${task.review_plan.map((item) => `- ${item}`).join("\n")}\n`);
  writeText(path.join(dir, "evidence.md"), "# Evidence\n\nFix task created from QA or Review feedback. No execution evidence yet.\n");
  writeText(path.join(dir, "status.json"), `${JSON.stringify({ task_id: task.id, status: "planned" }, null, 2)}\n`);
}

function createFixTask(cwd: string, runId: string, sourceTask: TaskGraphTask, reason: "qa_failed" | "review_changes_requested", details: string[]): string {
  const graph = readGraph(cwd, runId);
  const workflow = readFixLoopRecoveryState(reason);
  const prefix = `FIX-${sourceTask.id}-`;
  const existing = graph.tasks
    .filter((task) => task.id.startsWith(prefix))
    .map((task) => Number(task.id.slice(prefix.length)))
    .filter((value) => Number.isInteger(value));
  const next = existing
    .reduce((max, value) => Math.max(max, value), 0) + 1;
  const id = `${prefix}${next}`;
  const title = reason === "qa_failed"
    ? `Fix QA failure for ${sourceTask.id}`
    : `Address review feedback for ${sourceTask.id}`;
  const fixTask: TaskGraphTask = {
    id,
    title,
    type: "dev",
    depends_on: [sourceTask.id],
    read_scope: Array.from(new Set([...sourceTask.read_scope, `.imfine/runs/${runId}/evidence/**`, `.imfine/runs/${runId}/agents/**`])),
    write_scope: sourceTask.write_scope,
    acceptance: details.length > 0 ? details : [`Resolve ${reason} for ${sourceTask.id}`],
    dev_plan: [`Inspect ${reason} evidence`, workflow.reason, "Apply the smallest scoped fix", "Collect a new patch after changes"],
    test_plan: sourceTask.test_plan,
    review_plan: sourceTask.review_plan,
    verification: sourceTask.verification,
    commit: {
      mode: sourceTask.commit.mode,
      message: `fix(${sourceTask.id.toLowerCase()}): address ${reason.replace(/_/g, " ")}`
    }
  };
  graph.tasks.push(fixTask);
  writeGraph(cwd, runId, graph);
  writeTaskFiles(cwd, runId, fixTask);
  return id;
}

function qaAgentDir(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `qa-${taskId}`);
}

function reviewerAgentDir(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `reviewer-${taskId}`);
}

function requireValidatedPatch(cwd: string, runId: string, taskId: string): void {
  const file = path.join(runDir(cwd, runId), "agents", taskId, "status.json");
  if (!fs.existsSync(file)) {
    throw new Error(`Missing patch collection status for task ${taskId}`);
  }
  const status = readJson<{ status?: string; validation?: { passed?: boolean } }>(file);
  if (status.status !== "patch_validated" || status.validation?.passed !== true) {
    throw new Error(`Task ${taskId} patch must be collected and validated before QA`);
  }
}

export function verifyTask(cwd: string, runId: string, taskId: string, agentStatus?: VerificationStatus, summary = ""): VerificationResult {
  const graph = readGraph(cwd, runId);
  const task = taskById(graph, taskId);
  requireValidatedPatch(cwd, runId, taskId);
  const worktree = worktreeForTask(cwd, runId, taskId);
  const agentDir = qaAgentDir(cwd, runId, taskId);
  ensureDir(agentDir);

  const patchValidation = validatePatch(cwd, runId, taskId);
  const commands = executableVerificationCommands(task);
  const results: VerificationCommandResult[] = [];
  const errors = [...patchValidation.errors];
  let status: VerificationStatus = normalizeVerificationStatus(agentStatus) || "pass";

  if (!patchValidation.passed) {
    status = "fail";
  } else if (commands.length === 0 && !agentStatus) {
    status = "blocked";
    errors.push("No executable verification command and no QA Agent status was provided");
  } else {
    for (const command of commands) {
      const result = runShellCommand(command, worktree);
      results.push({ command, ...result });
      if (result.code !== 0) status = "fail";
    }
  }

  if (results.some((result) => result.code !== 0)) {
    errors.push("One or more verification commands failed");
  }

  let fixTaskId: string | undefined;
  if (status === "fail") {
    fixTaskId = createFixTask(cwd, runId, task, "qa_failed", errors);
    updateTaskStatus(cwd, runId, taskId, "qa_failed", { fix_task_id: fixTaskId });
    updateRunStatus(cwd, runId, "needs_dev_fix", { qa_failed_at: new Date().toISOString() });
  } else if (status === "blocked") {
    updateTaskStatus(cwd, runId, taskId, "qa_blocked", { errors });
    updateRunStatus(cwd, runId, "blocked", { qa_blocked_at: new Date().toISOString() });
  } else {
    updateTaskStatus(cwd, runId, taskId, "qa_passed");
    updateRunStatus(cwd, runId, "reviewing", { qa_passed_at: new Date().toISOString() });
  }

  const evidenceFile = path.join(runDir(cwd, runId), "evidence", "test-results.md");
  const agentInput = path.join(agentDir, "input.md");
  const agentOutput = path.join(agentDir, "output.md");
  const handoff = path.join(agentDir, "handoff.json");
  const statusFile = path.join(agentDir, "status.json");

  writeText(agentInput, `# QA Input: ${taskId}\n\n## Worktree\n\n${worktree}\n\n## Verification Commands\n\n${commands.length > 0 ? commands.map((command) => `- ${command}`).join("\n") : "- none"}\n\n## Patch Validation\n\n- passed: ${patchValidation.passed}\n${patchValidation.errors.map((error) => `- ${error}`).join("\n")}\n`);
  writeEvidenceSection(evidenceFile, "Test Results", `## ${taskId}\n\n- status: ${status}\n- summary: ${summary || "none"}\n- fix task: ${fixTaskId || "none"}\n\n## Commands\n\n${results.length > 0 ? results.map((result) => `### ${result.command}\n\n- exit: ${result.code}\n\n#### stdout\n\n\`\`\`text\n${result.stdout}\n\`\`\`\n\n#### stderr\n\n\`\`\`text\n${result.stderr}\n\`\`\``).join("\n\n") : "- none"}\n\n## Errors\n\n${errors.length > 0 ? errors.map((error) => `- ${error}`).join("\n") : "- none"}`);
  writeText(agentOutput, `# QA Output: ${taskId}\n\n- status: ${status}\n- summary: ${summary || "none"}\n- evidence: ${evidenceFile}\n- fix task: ${fixTaskId || "none"}\n`);
  writeText(handoff, `${JSON.stringify({
    run_id: runId,
    task_id: taskId,
    role: "qa",
    from: "qa",
    to: status === "pass" ? "review" : "dev",
    status,
    summary: summary || (status === "pass" ? "Verification passed" : "Verification did not pass"),
    commands: results.map((result) => result.command),
    failures: errors,
    evidence: [evidenceFile],
    next_state: status === "pass" ? "reviewing" : status === "fail" ? "needs_dev_fix" : "blocked",
    fix_task_id: fixTaskId
  }, null, 2)}\n`);
  writeText(statusFile, `${JSON.stringify({ task_id: taskId, status, fix_task_id: fixTaskId, errors }, null, 2)}\n`);
  refreshOrchestrationSnapshot(cwd, runId);

  return {
    runId,
    taskId,
    status,
    summary,
    commands: results,
    evidence: evidenceFile,
    agent: agentDir,
    fixTaskId,
    errors
  };
}

export function reviewTask(cwd: string, runId: string, taskId: string, decision: ReviewDecision, summary: string): ReviewResult {
  const graph = readGraph(cwd, runId);
  const task = taskById(graph, taskId);
  const agentDir = reviewerAgentDir(cwd, runId, taskId);
  ensureDir(agentDir);

  const qaStatusFile = path.join(qaAgentDir(cwd, runId, taskId), "status.json");
  const errors: string[] = [];
  if (!fs.existsSync(qaStatusFile)) {
    errors.push("Missing QA evidence");
  } else {
    const qaStatus = readJson<{ status?: string }>(qaStatusFile);
    if (qaStatus.status !== "pass" && decision === "approved") {
      errors.push("Cannot approve without passing QA evidence");
    }
  }

  let status = decision;
  if (errors.length > 0 && decision === "approved") status = "blocked";

  let fixTaskId: string | undefined;
  if (status === "changes_requested") {
    fixTaskId = createFixTask(cwd, runId, task, "review_changes_requested", [summary]);
    updateTaskStatus(cwd, runId, taskId, "review_changes_requested", { fix_task_id: fixTaskId });
    updateRunStatus(cwd, runId, "needs_dev_fix", { review_changes_requested_at: new Date().toISOString() });
  } else if (status === "blocked") {
    updateTaskStatus(cwd, runId, taskId, "review_blocked", { errors });
    updateRunStatus(cwd, runId, "blocked", { review_blocked_at: new Date().toISOString() });
  } else {
    updateTaskStatus(cwd, runId, taskId, "review_approved");
    updateRunStatus(cwd, runId, "reviewing", { review_approved_at: new Date().toISOString() });
  }

  const evidenceFile = path.join(runDir(cwd, runId), "evidence", "review.md");
  const agentInput = path.join(agentDir, "input.md");
  const agentOutput = path.join(agentDir, "output.md");
  const handoff = path.join(agentDir, "handoff.json");
  const statusFile = path.join(agentDir, "status.json");

  writeText(agentInput, `# Review Input: ${taskId}\n\n## Task\n\n${task.title}\n\n## Review Plan\n\n${task.review_plan.map((item) => `- ${item}`).join("\n")}\n\n## QA Evidence\n\n${qaStatusFile}\n`);
  writeEvidenceSection(evidenceFile, "Review Evidence", `## ${taskId}\n\n- status: ${status}\n- summary: ${summary || "none"}\n- fix task: ${fixTaskId || "none"}\n\n## Errors\n\n${errors.length > 0 ? errors.map((error) => `- ${error}`).join("\n") : "- none"}`);
  writeText(agentOutput, `# Review Output: ${taskId}\n\n- status: ${status}\n- summary: ${summary || "none"}\n- evidence: ${evidenceFile}\n- fix task: ${fixTaskId || "none"}\n`);
  writeText(handoff, `${JSON.stringify({
    run_id: runId,
    task_id: taskId,
    role: "reviewer",
    from: "reviewer",
    to: status === "approved" ? "archive" : "dev",
    status,
    summary,
    commands: [],
    findings: status === "changes_requested" ? [{ severity: "medium", file: "unknown", line: 1, issue: summary, required_change: summary }] : [],
    evidence: [evidenceFile],
    next_state: status === "approved" ? "committing" : status === "changes_requested" ? "needs_dev_fix" : "blocked",
    fix_task_id: fixTaskId
  }, null, 2)}\n`);
  writeText(statusFile, `${JSON.stringify({ task_id: taskId, status, summary, fix_task_id: fixTaskId, errors }, null, 2)}\n`);
  refreshOrchestrationSnapshot(cwd, runId);

  return {
    runId,
    taskId,
    status,
    summary,
    evidence: evidenceFile,
    agent: agentDir,
    fixTaskId,
    errors
  };
}

export function requestDesignRework(cwd: string, runId: string, taskId: string, summary: string): DesignReworkResult {
  const graph = readGraph(cwd, runId);
  const task = taskById(graph, taskId);
  const workflow = readFixLoopDesignReworkState();
  const evidenceFile = path.join(runDir(cwd, runId), "evidence", "design-rework.md");
  const architectDir = path.join(runDir(cwd, runId), "agents", `architect-${taskId}`);
  const plannerDir = path.join(runDir(cwd, runId), "agents", `task-planner-${taskId}`);
  ensureDir(architectDir);
  ensureDir(plannerDir);

  const architectInput = path.join(architectDir, "input.md");
  const taskPlannerInput = path.join(plannerDir, "input.md");
  writeEvidenceSection(evidenceFile, "Design Rework", `## ${taskId}\n\n- status: implementation_blocked_by_design\n- summary: ${summary || "none"}\n- workflow_reason: ${workflow.reason}\n\n## Affected Task\n\n- ${task.id}: ${task.title}`);
  writeText(architectInput, `# Architect Rework Input: ${taskId}\n\n## Reason\n\n${summary || workflow.architect.reason}\n\n## Workflow Reason\n\n${workflow.reason}\n\n## Current Task\n\n${task.title}\n\n## Required Output\n\n- Update design artifacts if the design is invalid.\n- Produce architecture guidance for Task Planner.\n- Do not change implementation code.\n`);
  writeText(taskPlannerInput, `# Task Planner Rework Input: ${taskId}\n\n## Reason\n\n${summary || workflow.task_planner.reason}\n\n## Workflow Reason\n\n${workflow.reason}\n\n## Current Task Graph\n\n${graphFile(cwd, runId)}\n\n## Required Output\n\n- Re-plan affected tasks after Architect updates design.\n- Preserve valid task boundaries where possible.\n- Do not change implementation code.\n`);
  updateRunStatus(cwd, runId, "needs_design_update", {
    design_rework_requested_at: new Date().toISOString(),
    design_rework_evidence: evidenceFile
  });
  updateTaskStatus(cwd, runId, taskId, "implementation_blocked_by_design", {
    design_rework_evidence: evidenceFile
  });
  refreshOrchestrationSnapshot(cwd, runId);

  return {
    runId,
    taskId,
    status: "needs_design_update",
    summary,
    evidence: evidenceFile,
    architectInput,
    taskPlannerInput
  };
}
