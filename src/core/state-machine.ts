import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateAgentHandoff } from "./handoff-evidence.js";

export type RunState =
  | "created"
  | "infrastructure_checked"
  | "project_analyzed"
  | "requirement_analyzed"
  | "designed"
  | "orchestrating"
  | "planned"
  | "waiting_for_agent_output"
  | "branch_prepared"
  | "executing"
  | "implementing"
  | "integrating"
  | "verifying"
  | "reviewing"
  | "committing"
  | "pushing"
  | "archiving"
  | "completed"
  | "blocked"
  | "needs_requirement_reanalysis"
  | "needs_dev_fix"
  | "needs_design_update"
  | "needs_task_replan"
  | "needs_infrastructure_action";

const RUN_STATES = new Set<RunState>([
  "created",
  "infrastructure_checked",
  "project_analyzed",
  "requirement_analyzed",
  "designed",
  "orchestrating",
  "planned",
  "waiting_for_agent_output",
  "branch_prepared",
  "executing",
  "implementing",
  "integrating",
  "verifying",
  "reviewing",
  "committing",
  "pushing",
  "archiving",
  "completed",
  "blocked",
  "needs_requirement_reanalysis",
  "needs_dev_fix",
  "needs_design_update",
  "needs_task_replan",
  "needs_infrastructure_action"
]);

export type TaskState =
  | "planned"
  | "waiting"
  | "ready"
  | "ready_for_dev"
  | "implementing"
  | "patch_validated"
  | "patch_invalid"
  | "qa_passed"
  | "qa_failed"
  | "qa_blocked"
  | "review_approved"
  | "review_changes_requested"
  | "review_blocked"
  | "committed"
  | "completed"
  | "blocked"
  | "needs_dev_fix"
  | "implementation_blocked_by_design";

const TASK_STATES = new Set<TaskState>([
  "planned",
  "waiting",
  "ready",
  "ready_for_dev",
  "implementing",
  "patch_validated",
  "patch_invalid",
  "qa_passed",
  "qa_failed",
  "qa_blocked",
  "review_approved",
  "review_changes_requested",
  "review_blocked",
  "committed",
  "completed",
  "blocked",
  "needs_dev_fix",
  "implementation_blocked_by_design"
]);

export interface StateTransitionResult {
  accepted: boolean;
  from: string;
  to: string;
  reason?: string;
  blocker?: string;
}

export function assertTransitionAccepted(result: StateTransitionResult, label: string): void {
  if (result.accepted) return;
  throw new Error(`${label} rejected state transition ${result.from} -> ${result.to}: ${result.reason || "unknown reason"}${result.blocker ? ` (${result.blocker})` : ""}`);
}

export function isRunState(value: string): value is RunState {
  return RUN_STATES.has(value as RunState);
}

export function normalizeRunState(value: string | undefined): RunState {
  if (value && isRunState(value)) return value;
  return "blocked";
}

export function isTaskState(value: string): value is TaskState {
  return TASK_STATES.has(value as TaskState);
}

export function isRecoverableRunState(state: RunState): boolean {
  return state === "blocked"
    || state === "needs_requirement_reanalysis"
    || state === "needs_dev_fix"
    || state === "needs_design_update"
    || state === "needs_task_replan"
    || state === "needs_infrastructure_action";
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function appendJsonLine(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function recordBlocker(cwd: string, runId: string, blocker: Record<string, unknown>): string {
  const file = path.join(runDir(cwd, runId), "orchestration", "state-blockers.json");
  const current = fs.existsSync(file) ? readJson<{ blockers?: unknown[] }>(file) : { blockers: [] };
  const blockers = Array.isArray(current.blockers) ? current.blockers : [];
  blockers.push(blocker);
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    updated_at: new Date().toISOString(),
    blockers
  }, null, 2)}\n`);
  return file;
}

function completionEvidence(cwd: string, runId: string): { passed: boolean; reason?: string; blockerDetail?: Record<string, unknown> } {
  const dir = runDir(cwd, runId);
  const harnessFile = path.join(dir, "orchestration", "true-harness-evidence.json");
  if (!fs.existsSync(harnessFile)) {
    return {
      passed: false,
      reason: "missing true harness evidence",
      blockerDetail: { missing: harnessFile }
    };
  }
  let harness: { true_harness_passed?: unknown };
  try {
    harness = readJson<{ true_harness_passed?: unknown }>(harnessFile);
  } catch {
    return {
      passed: false,
      reason: "invalid true harness evidence",
      blockerDetail: { invalid: harnessFile }
    };
  }
  if (harness.true_harness_passed !== true) {
    return {
      passed: false,
      reason: "true harness evidence has not passed",
      blockerDetail: { evidence: harnessFile, true_harness_passed: harness.true_harness_passed }
    };
  }

  const archiveStatusFile = path.join(dir, "agents", "archive", "status.json");
  if (!fs.existsSync(archiveStatusFile)) {
    return {
      passed: false,
      reason: "missing archive status",
      blockerDetail: { missing: archiveStatusFile }
    };
  }
  const archiveStatus = readJson<{ status?: unknown }>(archiveStatusFile);
  if (archiveStatus.status !== "completed") {
    return {
      passed: false,
      reason: "archive status is not completed",
      blockerDetail: { status_file: archiveStatusFile, status: archiveStatus.status }
    };
  }

  const archiveValidation = validateAgentHandoff({ id: "archive", role: "archive" }, dir, runId);
  if (!archiveValidation.file) {
    return {
      passed: false,
      reason: "missing archive handoff",
      blockerDetail: { missing: path.join(dir, "agents", "archive", "handoff.json") }
    };
  }
  if (!archiveValidation.passed) {
    return {
      passed: false,
      reason: "invalid archive handoff",
      blockerDetail: { handoff_file: archiveValidation.file, errors: archiveValidation.errors }
    };
  }
  const archiveHandoff = readJson<{ status?: unknown }>(archiveValidation.file);
  if (archiveHandoff.status !== "completed") {
    return {
      passed: false,
      reason: "archive handoff is not completed",
      blockerDetail: { handoff_file: archiveValidation.file, status: archiveHandoff.status }
    };
  }

  return { passed: true };
}

function committerEvidence(cwd: string, runId: string): { passed: boolean; reason?: string; blockerDetail?: Record<string, unknown> } {
  const dir = runDir(cwd, runId);
  const validation = validateAgentHandoff({ id: "committer", role: "committer" }, dir, runId);
  if (!validation.file) {
    return {
      passed: false,
      reason: "missing committer handoff",
      blockerDetail: { missing: path.join(dir, "agents", "committer", "handoff.json") }
    };
  }
  if (!validation.passed) {
    return {
      passed: false,
      reason: "invalid committer handoff",
      blockerDetail: { handoff_file: validation.file, errors: validation.errors }
    };
  }
  const handoff = readJson<{ status?: unknown }>(validation.file);
  if (handoff.status !== "ready") {
    return {
      passed: false,
      reason: "committer handoff is not ready",
      blockerDetail: { handoff_file: validation.file, status: handoff.status }
    };
  }
  return { passed: true };
}

function archivingEvidence(cwd: string, runId: string): { passed: boolean; reason?: string; blockerDetail?: Record<string, unknown> } {
  const dir = runDir(cwd, runId);
  const run = readJson<{ commit_hashes?: unknown; commit_blocked_reason?: unknown; push_status?: unknown }>(path.join(dir, "run.json"));
  const testResults = path.join(dir, "evidence", "test-results.md");
  if (!fs.existsSync(testResults)) {
    return { passed: false, reason: "missing QA evidence", blockerDetail: { missing: testResults } };
  }
  const review = path.join(dir, "evidence", "review.md");
  if (!fs.existsSync(review)) {
    return { passed: false, reason: "missing review evidence", blockerDetail: { missing: review } };
  }
  const commitOutcomeKnown = Array.isArray(run.commit_hashes) && run.commit_hashes.length > 0 || typeof run.commit_blocked_reason === "string";
  if (!commitOutcomeKnown) {
    return { passed: false, reason: "missing commit outcome", blockerDetail: { run_file: path.join(dir, "run.json") } };
  }
  const push = path.join(dir, "evidence", "push.md");
  if (typeof run.push_status !== "string" || !fs.existsSync(push)) {
    return { passed: false, reason: "missing push outcome", blockerDetail: { evidence: push, push_status: run.push_status } };
  }
  return { passed: true };
}

function isLegalRunTransition(from: RunState, to: RunState): boolean {
  if (from === to) return true;
  if (from === "completed") return to === "completed";
  if (to === "archiving") return true;
  if (isRecoverableRunState(to)) return true;

  const allowed: Record<RunState, RunState[]> = {
    created: ["infrastructure_checked"],
    infrastructure_checked: ["project_analyzed", "requirement_analyzed"],
    project_analyzed: ["requirement_analyzed", "designed"],
    requirement_analyzed: ["designed", "orchestrating"],
    designed: ["orchestrating", "planned", "waiting_for_agent_output"],
    orchestrating: ["planned", "waiting_for_agent_output", "branch_prepared", "executing", "implementing"],
    planned: ["waiting_for_agent_output", "branch_prepared", "executing", "implementing"],
    waiting_for_agent_output: ["planned", "branch_prepared", "executing", "implementing"],
    branch_prepared: ["executing", "implementing"],
    executing: ["integrating", "verifying", "reviewing", "committing"],
    implementing: ["integrating", "verifying", "reviewing", "committing"],
    integrating: ["verifying", "reviewing", "committing"],
    verifying: ["reviewing"],
    reviewing: ["committing"],
    committing: ["pushing"],
    pushing: ["archiving"],
    archiving: ["completed"],
    completed: ["completed"],
    blocked: ["infrastructure_checked", "orchestrating", "planned", "branch_prepared", "executing", "implementing", "verifying", "reviewing", "committing", "pushing", "archiving"],
    needs_requirement_reanalysis: ["requirement_analyzed", "designed", "orchestrating", "planned"],
    needs_dev_fix: ["executing", "implementing", "verifying", "reviewing"],
    needs_design_update: ["designed", "orchestrating", "planned"],
    needs_task_replan: ["planned"],
    needs_infrastructure_action: ["infrastructure_checked", "orchestrating", "planned", "branch_prepared", "executing", "implementing"]
  };
  return allowed[from].includes(to);
}

function isLegalTaskTransition(from: TaskState, to: TaskState): boolean {
  if (from === to) return true;
  if (to === "blocked" || to === "needs_dev_fix") return true;
  if (from === "completed") return to === "completed";
  if (from === "committed") return to === "committed" || to === "completed";

  const allowed: Record<TaskState, TaskState[]> = {
    planned: ["waiting", "ready", "ready_for_dev", "implementing", "implementation_blocked_by_design"],
    waiting: ["ready", "ready_for_dev", "implementation_blocked_by_design"],
    ready: ["ready_for_dev", "implementing", "patch_validated", "patch_invalid", "implementation_blocked_by_design"],
    ready_for_dev: ["implementing", "patch_validated", "patch_invalid", "implementation_blocked_by_design"],
    implementing: ["patch_validated", "patch_invalid", "implementation_blocked_by_design"],
    patch_invalid: ["ready_for_dev", "implementing"],
    patch_validated: ["qa_passed", "qa_failed", "qa_blocked"],
    qa_failed: ["ready_for_dev", "implementing"],
    qa_blocked: ["ready_for_dev", "implementing"],
    qa_passed: ["review_approved", "review_changes_requested", "review_blocked"],
    review_changes_requested: ["ready_for_dev", "implementing"],
    review_blocked: ["ready_for_dev", "implementing"],
    review_approved: ["committed"],
    committed: ["completed"],
    completed: ["completed"],
    blocked: ["planned", "waiting", "ready", "ready_for_dev", "implementing", "patch_validated", "qa_passed", "review_approved"],
    needs_dev_fix: ["ready_for_dev", "implementing", "patch_validated"],
    implementation_blocked_by_design: ["planned", "waiting", "ready_for_dev"]
  };
  return allowed[from].includes(to);
}

export function transitionRunState(cwd: string, runId: string, to: string, extra: Record<string, unknown> = {}): StateTransitionResult {
  const dir = runDir(cwd, runId);
  const file = path.join(dir, "run.json");
  const current = readJson<Record<string, unknown>>(file);
  const from = typeof current.status === "string" ? current.status : "created";

  if (!isRunState(to)) {
    const blocker = recordBlocker(cwd, runId, {
      type: "illegal_run_state",
      from,
      to,
      reason: "target run state is not part of the imfine lifecycle",
      recorded_at: new Date().toISOString()
    });
    return { accepted: false, from, to, reason: "invalid target run state", blocker };
  }

  const normalizedFrom = normalizeRunState(from);
  if (!isLegalRunTransition(normalizedFrom, to)) {
    const blocker = recordBlocker(cwd, runId, {
      type: "illegal_run_transition",
      from,
      to,
      reason: "run transition violates lifecycle boundary",
      recorded_at: new Date().toISOString()
    });
    return { accepted: false, from, to, reason: "illegal run transition", blocker };
  }

  if (to === "committing") {
    const gate = committerEvidence(cwd, runId);
    if (!gate.passed) {
      const blocker = recordBlocker(cwd, runId, {
        type: "missing_committing_evidence",
        from,
        to,
        reason: gate.reason || "committing evidence gate failed",
        ...gate.blockerDetail,
        recorded_at: new Date().toISOString()
      });
      return { accepted: false, from, to, reason: gate.reason || "committing evidence gate failed", blocker };
    }
  }

  if (to === "archiving") {
    const gate = archivingEvidence(cwd, runId);
    if (!gate.passed) {
      const blocker = recordBlocker(cwd, runId, {
        type: "missing_archiving_evidence",
        from,
        to,
        reason: gate.reason || "archiving evidence gate failed",
        ...gate.blockerDetail,
        recorded_at: new Date().toISOString()
      });
      return { accepted: false, from, to, reason: gate.reason || "archiving evidence gate failed", blocker };
    }
  }

  if (to === "completed") {
    const gate = completionEvidence(cwd, runId);
    if (!gate.passed) {
      const blocker = recordBlocker(cwd, runId, {
        type: "missing_completion_evidence",
        from,
        to,
        reason: gate.reason || "completion evidence gate failed",
        ...gate.blockerDetail,
        recorded_at: new Date().toISOString()
      });
      return { accepted: false, from, to, reason: gate.reason || "completion evidence gate failed", blocker };
    }
  }

  const now = new Date().toISOString();
  writeText(file, `${JSON.stringify({ ...current, ...extra, status: to, updated_at: now }, null, 2)}\n`);
  appendJsonLine(path.join(dir, "orchestration", "state-transitions.jsonl"), {
    scope: "run",
    run_id: runId,
    from,
    to,
    accepted: true,
    recorded_at: now
  });
  return { accepted: true, from, to };
}

export function transitionTaskState(cwd: string, runId: string, taskId: string, to: string, extra: Record<string, unknown> = {}): StateTransitionResult {
  const dir = path.join(runDir(cwd, runId), "tasks", taskId);
  const file = path.join(dir, "status.json");
  const current = fs.existsSync(file) ? readJson<Record<string, unknown>>(file) : { task_id: taskId };
  const from = typeof current.status === "string" ? current.status : "planned";

  if (!isTaskState(to)) {
    const blocker = recordBlocker(cwd, runId, {
      type: "illegal_task_state",
      task_id: taskId,
      from,
      to,
      reason: "target task state is not part of the imfine task lifecycle",
      recorded_at: new Date().toISOString()
    });
    return { accepted: false, from, to, reason: "invalid target task state", blocker };
  }

  const normalizedFrom = isTaskState(from) ? from : "blocked";
  if (!isLegalTaskTransition(normalizedFrom, to)) {
    const blocker = recordBlocker(cwd, runId, {
      type: "illegal_task_transition",
      task_id: taskId,
      from,
      to,
      reason: "task transition violates lifecycle boundary",
      recorded_at: new Date().toISOString()
    });
    return { accepted: false, from, to, reason: "illegal task transition", blocker };
  }

  const now = new Date().toISOString();
  writeText(file, `${JSON.stringify({ ...current, ...extra, task_id: taskId, status: to, updated_at: now }, null, 2)}\n`);
  appendJsonLine(path.join(runDir(cwd, runId), "orchestration", "state-transitions.jsonl"), {
    scope: "task",
    run_id: runId,
    task_id: taskId,
    from,
    to,
    accepted: true,
    recorded_at: now
  });
  return { accepted: true, from, to };
}
