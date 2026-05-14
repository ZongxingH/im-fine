import fs from "node:fs";
import path from "node:path";
import { archiveRun } from "./archive.js";
import { installDependencies } from "./dependencies.js";
import { writeText } from "./fs.js";
import { commitRun, pushRun } from "./gitflow.js";
import { validateHandoff, type HandoffRole } from "./handoff-validator.js";
import { acquireLock, isActionCompleted, readLatestCheckpoint, releaseLock, writeCheckpoint } from "./reliability.js";
import { resumeRun, type OrchestrationAction, type OrchestratorResult } from "./orchestrator.js";
import { materializeTaskGraphArtifacts } from "./plan.js";
import { reviewTask, type ReviewDecision, type VerificationStatus, verifyTask } from "./quality.js";
import { transitionRunState } from "./state-machine.js";
import { collectPatch, prepareWorktrees, taskHasPendingWorktreeChanges } from "./worktree.js";

export interface AutoOrchestratorStep {
  iteration: number;
  actionId: string;
  kind: string;
  status: "completed" | "waiting_for_agent_output" | "blocked" | "failed";
  detail: string;
  artifacts: string[];
}

export interface AutoOrchestratorResult {
  runId: string;
  status: "completed" | "waiting_for_agent_output" | "blocked" | "max_iterations";
  iterations: number;
  steps: AutoOrchestratorStep[];
  lastOrchestration: OrchestratorResult;
  timeline: string;
}

export interface AutoOrchestratorOptions {
  dryRun: boolean;
  maxIterations: number;
}

interface Handoff {
  status?: string;
  summary?: string;
  task_id?: string;
  merged_files?: string[];
  resolved_files?: string[];
  commands?: string[];
  evidence?: string[];
}

interface ParallelExecutionWave {
  iteration: number;
  parallel_group: string;
  action_ids: string[];
  task_ids: string[];
  roles: string[];
  status: "waiting_for_agent_output" | "dispatched" | "completed" | "blocked" | "failed";
  reason: string;
  started_at: string;
  completed_at?: string;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function parallelPlanFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "orchestration", "parallel-execution.json");
}

function recordParallelWave(cwd: string, runId: string, wave: ParallelExecutionWave): void {
  const file = parallelPlanFile(cwd, runId);
  const current = fs.existsSync(file)
    ? readJson<{
      schema_version?: number;
      run_id?: string;
      wave_history?: ParallelExecutionWave[];
      executed_parallel_groups?: string[];
      blocked_parallel_groups?: string[];
    }>(file)
    : { schema_version: 1, run_id: runId };
  const waveHistory = Array.isArray(current.wave_history) ? current.wave_history : [];
  const executed = new Set(Array.isArray(current.executed_parallel_groups) ? current.executed_parallel_groups : []);
  const blocked = new Set(Array.isArray(current.blocked_parallel_groups) ? current.blocked_parallel_groups : []);
  waveHistory.push(wave);
  if (wave.status === "completed") {
    executed.add(wave.parallel_group);
    blocked.delete(wave.parallel_group);
  }
  if (wave.status === "blocked" || wave.status === "failed") {
    blocked.add(wave.parallel_group);
  }
  writeText(file, `${JSON.stringify({
    schema_version: current.schema_version || 1,
    run_id: current.run_id || runId,
    artifact_type: "execution",
    executed_parallel_groups: Array.from(executed),
    blocked_parallel_groups: Array.from(blocked),
    wave_history: waveHistory
  }, null, 2)}\n`);
}

function updateRunStatus(cwd: string, runId: string, status: string, extra: Record<string, unknown>): void {
  const transition = transitionRunState(cwd, runId, status, extra);
  if (!transition.accepted) {
    transitionRunState(cwd, runId, "blocked", {
      blocked_at: new Date().toISOString(),
      blocked_reason: transition.reason,
      blocked_evidence: transition.blocker
    });
  }
}

function handoffFile(runDirPath: string, role: string, taskId: string): string {
  if (role === "qa") return path.join(runDirPath, "agents", `qa-${taskId}`, "handoff.json");
  if (role === "reviewer") return path.join(runDirPath, "agents", `reviewer-${taskId}`, "handoff.json");
  if (role === "merge-agent") return path.join(runDirPath, "agents", `merge-agent-${taskId}`, "handoff.json");
  return path.join(runDirPath, "agents", taskId, "handoff.json");
}

function readHandoff(file: string): Handoff | null {
  if (!fs.existsSync(file)) return null;
  return readJson<Handoff>(file);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function runLevelHandoffFile(runDirPath: string, role: string): string {
  return path.join(runDirPath, "agents", role, "handoff.json");
}

function agentActionReadyForProcessing(cwd: string, runId: string, runDirPath: string, action: OrchestrationAction): boolean {
  if (action.role === "dev" || action.role === "technical-writer") {
    if (action.taskId) {
      return taskHasPendingWorktreeChanges(cwd, runId, action.taskId)
        || fs.existsSync(path.join(runDirPath, "agents", action.taskId, "handoff.json"));
    }
    return fs.existsSync(runLevelHandoffFile(runDirPath, action.role));
  }

  if (action.role === "qa" || action.role === "reviewer") {
    return action.taskId ? fs.existsSync(handoffFile(runDirPath, action.role, action.taskId)) : false;
  }

  if (action.role === "merge-agent") {
    return action.taskId ? fs.existsSync(handoffFile(runDirPath, action.role, action.taskId)) : false;
  }

  return fs.existsSync(runLevelHandoffFile(runDirPath, action.role));
}

function validateRoleHandoff(role: HandoffRole, handoff: Handoff | null, runId: string, taskId?: string): { handoff: Handoff; errors: string[] } | { handoff: null; errors: string[] } {
  if (!handoff) return { handoff: null, errors: [`${role} handoff is missing`] };
  const validation = validateHandoff(role, handoff, runId, taskId);
  return { handoff, errors: validation.errors };
}

function isVerificationStatus(value: string | undefined): value is VerificationStatus {
  return value === "pass" || value === "fail" || value === "blocked";
}

function isReviewDecision(value: string | undefined): value is ReviewDecision {
  return value === "approved" || value === "changes_requested" || value === "blocked";
}

function dependencyEvidenceSatisfied(runDirPath: string, dependency: string): boolean {
  if (dependency === "runtime-commit-run") {
    const run = readJson<Record<string, unknown>>(path.join(runDirPath, "run.json"));
    return Array.isArray(run.commit_hashes) && run.commit_hashes.length > 0;
  }
  if (dependency === "runtime-push-run") {
    const run = readJson<Record<string, unknown>>(path.join(runDirPath, "run.json"));
    return typeof run.push_status === "string" && run.push_status.length > 0;
  }
  const qa = dependency.match(/^agent-qa-(.+)$/);
  if (qa) {
    const file = path.join(runDirPath, "agents", `qa-${qa[1]}`, "status.json");
    return fs.existsSync(file) && readJson<{ status?: string }>(file).status === "pass";
  }
  const reviewer = dependency.match(/^agent-reviewer-(.+)$/);
  if (reviewer) {
    const file = path.join(runDirPath, "agents", `reviewer-${reviewer[1]}`, "status.json");
    return fs.existsSync(file) && readJson<{ status?: string }>(file).status === "approved";
  }
  const taskAgent = dependency.match(/^agent-(dev|technical-writer)-(.+)$/);
  if (taskAgent) {
    const file = path.join(runDirPath, "agents", taskAgent[2], "status.json");
    if (!fs.existsSync(file)) return false;
    const status = readJson<{ status?: string; validation?: { passed?: boolean } }>(file);
    return status.status === "patch_validated" && status.validation?.passed === true;
  }
  const taskStatusFile = path.join(runDirPath, "tasks", dependency, "status.json");
  if (fs.existsSync(taskStatusFile)) {
    const task = readJson<{ status?: string; commit_hash?: string }>(taskStatusFile);
    return task.status === "committed"
      || typeof task.commit_hash === "string"
      || dependencyEvidenceSatisfied(runDirPath, `agent-reviewer-${dependency}`);
  }
  return false;
}

function dependenciesCompleted(cwd: string, runId: string, orchestration: OrchestratorResult, action: OrchestrationAction): boolean {
  return action.dependsOn.every((dependency) => isActionCompleted(cwd, runId, dependency) || dependencyEvidenceSatisfied(orchestration.runDir, dependency));
}

function firstReadyAction(cwd: string, runId: string, orchestration: OrchestratorResult): OrchestrationAction | undefined {
  return orchestration.nextActions.find((action) => action.status === "blocked")
    || orchestration.nextActions.find((action) => action.status === "ready" && !isActionCompleted(cwd, runId, action.id) && dependenciesCompleted(cwd, runId, orchestration, action));
}

function readyActionBatch(cwd: string, runId: string, orchestration: OrchestratorResult, seed: OrchestrationAction): OrchestrationAction[] {
  if (seed.status === "blocked") return [seed];
  if (seed.kind !== "agent") return [seed];
  return orchestration.nextActions.filter((action) =>
    action.kind === "agent"
    && (action.parallelGroup === seed.parallelGroup || !action.taskId)
    && action.status === "ready"
    && !isActionCompleted(cwd, runId, action.id)
    && dependenciesCompleted(cwd, runId, orchestration, action)
  );
}

function executeRuntimeAction(cwd: string, runId: string, action: OrchestrationAction): AutoOrchestratorStep {
  if (action.id === "runtime-materialize-planning") {
    const result = materializeTaskGraphArtifacts(cwd, runId);
    return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: "validated orchestrator-provided task graph and materialized planning artifacts", artifacts: result.artifacts };
  }
  if (action.id === "runtime-worktree-prepare") {
    const result = prepareWorktrees(cwd, runId);
    return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: "prepared worktrees", artifacts: [path.join(runDir(cwd, runId), "worktrees", "index.json"), ...result.tasks.map((task) => task.agent_input)] };
  }
  if (action.id === "runtime-dependency-install") {
    const result = installDependencies(cwd, runId);
    return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: `dependency install status: ${result.status}`, artifacts: [result.evidence] };
  }
  if (action.id === "runtime-commit-run") {
    const result = commitRun(cwd, runId, "task");
    return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: "committed run", artifacts: [result.evidence] };
  }
  if (action.id === "runtime-push-run") {
    const result = pushRun(cwd, runId);
    return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: `push status: ${result.status}`, artifacts: [result.evidence] };
  }
  if (action.id === "agent-archive") {
    const result = archiveRun(cwd, runId, {
      archiveAction: {
        id: action.id,
        role: action.role,
        taskId: action.taskId,
        parallelGroup: action.parallelGroup
      }
    });
    const archiveHandoff = readHandoff(path.join(runDir(cwd, runId), "agents", "archive", "handoff.json"));
    const gate = validateRoleHandoff("archive", archiveHandoff, runId);
    if (gate.errors.length > 0) {
      updateRunStatus(cwd, runId, "blocked", { archive_handoff_errors: gate.errors, archive_handoff_blocked_at: new Date().toISOString() });
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `archive handoff invalid: ${gate.errors.join("; ")}`, artifacts: [result.archiveReport, result.userReport] };
    }
    return { iteration: 0, actionId: action.id, kind: action.kind, status: result.status === "completed" ? "completed" : "blocked", detail: `archive status: ${result.status}`, artifacts: [result.archiveReport, result.userReport] };
  }
  return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `unsupported runtime action: ${action.id}`, artifacts: [] };
}

function writeDevHandoff(cwd: string, runId: string, taskId: string, patch: string, changedFiles: string[], passed: boolean): Handoff {
  const file = path.join(runDir(cwd, runId), "agents", taskId, "handoff.json");
  const handoff = {
    run_id: runId,
    task_id: taskId,
    role: "dev",
    from: "dev",
    to: "qa",
    status: passed ? "ready" : "blocked",
    summary: passed ? "Patch collected and validated by runtime" : "Patch collection failed runtime validation",
    files_changed: changedFiles,
    commands: ["git add -N .", "git diff --binary HEAD", "git diff --name-only HEAD"],
    verification: [],
    evidence: [patch],
    next_state: passed ? "verifying" : "blocked"
  };
  writeText(file, `${JSON.stringify(handoff, null, 2)}\n`);
  return handoff;
}

function processExecutedAgent(cwd: string, runId: string, runDirPath: string, action: OrchestrationAction): AutoOrchestratorStep {
  if (!action.taskId) {
    if (action.role === "committer") {
      const file = runLevelHandoffFile(runDirPath, "committer");
      const gate = validateRoleHandoff("committer", readHandoff(file), runId);
      if (gate.errors.length > 0 || !gate.handoff) {
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "waiting_for_agent_output", detail: `Committer handoff invalid: ${gate.errors.join("; ")}`, artifacts: [file] };
      }
      if (gate.handoff.status === "blocked") {
        updateRunStatus(cwd, runId, "blocked", { committer_blocked_at: new Date().toISOString(), committer_summary: gate.handoff.summary || "", committer_handoff: file });
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `Committer blocked: ${gate.handoff.summary || "blocked"}`, artifacts: [file] };
      }
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: "Committer handoff approved commit readiness", artifacts: [file] };
    }

    if (action.role === "risk-reviewer") {
      const file = runLevelHandoffFile(runDirPath, "risk-reviewer");
      const gate = validateRoleHandoff("risk-reviewer", readHandoff(file), runId);
      if (gate.errors.length > 0 || !gate.handoff) {
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "waiting_for_agent_output", detail: `Risk Reviewer handoff invalid: ${gate.errors.join("; ")}`, artifacts: [file] };
      }
      if (gate.handoff.status === "blocked") {
        updateRunStatus(cwd, runId, "blocked", { risk_reviewer_blocked_at: new Date().toISOString(), risk_reviewer_summary: gate.handoff.summary || "", risk_reviewer_handoff: file });
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `Risk Reviewer blocked: ${gate.handoff.summary || "blocked"}`, artifacts: [file] };
      }
      if (gate.handoff.status === "needs_replan") {
        updateRunStatus(cwd, runId, "needs_task_replan", { risk_reviewer_replan_at: new Date().toISOString(), risk_reviewer_summary: gate.handoff.summary || "", risk_reviewer_handoff: file });
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `Risk Reviewer requested replan: ${gate.handoff.summary || "needs replan"}`, artifacts: [file] };
      }
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: "Risk Reviewer handoff accepted", artifacts: [file] };
    }

    if (action.role === "technical-writer") {
      const file = runLevelHandoffFile(runDirPath, "technical-writer");
      const gate = validateRoleHandoff("technical-writer", readHandoff(file), runId);
      if (gate.errors.length > 0 || !gate.handoff) {
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "waiting_for_agent_output", detail: `Technical Writer handoff invalid: ${gate.errors.join("; ")}`, artifacts: [file] };
      }
      if (gate.handoff.status === "blocked") {
        updateRunStatus(cwd, runId, "blocked", { technical_writer_blocked_at: new Date().toISOString(), technical_writer_summary: gate.handoff.summary || "", technical_writer_handoff: file });
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `Technical Writer blocked: ${gate.handoff.summary || "blocked"}`, artifacts: [file] };
      }
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: `Technical Writer handoff status: ${gate.handoff.status}`, artifacts: [file] };
    }

    if (action.role === "project-knowledge-updater") {
      const file = runLevelHandoffFile(runDirPath, "project-knowledge-updater");
      const gate = validateRoleHandoff("project-knowledge-updater", readHandoff(file), runId);
      if (gate.errors.length > 0 || !gate.handoff) {
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "waiting_for_agent_output", detail: `Project Knowledge Updater handoff invalid: ${gate.errors.join("; ")}`, artifacts: [file] };
      }
      if (gate.handoff.status === "blocked") {
        updateRunStatus(cwd, runId, "blocked", { project_knowledge_blocked_at: new Date().toISOString(), project_knowledge_summary: gate.handoff.summary || "", project_knowledge_handoff: file });
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `Project Knowledge Updater blocked: ${gate.handoff.summary || "blocked"}`, artifacts: [file] };
      }
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: "Project Knowledge Updater handoff accepted", artifacts: [file] };
    }

    return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: "run-level agent execution recorded", artifacts: [] };
  }

  if (action.role === "dev" || action.role === "technical-writer") {
    const existingHandoffFile = path.join(runDirPath, "agents", action.taskId, "handoff.json");
    if (fs.existsSync(existingHandoffFile)) {
      const existing = readHandoff(existingHandoffFile);
      const existingGate = validateRoleHandoff("dev", existing, runId, action.taskId);
      if (existingGate.errors.length > 0) {
        updateRunStatus(cwd, runId, "blocked", { dev_handoff_errors: existingGate.errors, dev_handoff_blocked_at: new Date().toISOString() });
        return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `Dev handoff invalid: ${existingGate.errors.join("; ")}`, artifacts: [existingHandoffFile] };
      }
    }
    const result = collectPatch(cwd, runId, action.taskId);
    const handoff = writeDevHandoff(cwd, runId, action.taskId, result.patch, result.validation.changedFiles, result.validation.passed);
    const gate = validateRoleHandoff("dev", handoff, runId, action.taskId);
    if (gate.errors.length > 0) {
      updateRunStatus(cwd, runId, "blocked", { dev_handoff_errors: gate.errors, dev_handoff_blocked_at: new Date().toISOString() });
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `Dev handoff invalid: ${gate.errors.join("; ")}`, artifacts: [result.patch, result.evidence] };
    }
    return { iteration: 0, actionId: action.id, kind: action.kind, status: result.validation.passed ? "completed" : "blocked", detail: `patch validation: ${result.validation.passed ? "pass" : "fail"}`, artifacts: [result.patch, result.evidence] };
  }

  if (action.role === "qa") {
    const handoff = readHandoff(handoffFile(runDirPath, "qa", action.taskId));
    const gate = validateRoleHandoff("qa", handoff, runId, action.taskId);
    if (gate.errors.length > 0 || !gate.handoff || !isVerificationStatus(gate.handoff.status)) {
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "waiting_for_agent_output", detail: `QA handoff invalid: ${gate.errors.join("; ")}`, artifacts: [] };
    }
    const result = verifyTask(cwd, runId, action.taskId, gate.handoff.status, gate.handoff.summary || "");
    return {
      iteration: 0,
      actionId: action.id,
      kind: action.kind,
      status: result.status === "blocked" ? "blocked" : "completed",
      detail: result.fixTaskId ? `QA status: ${result.status}; fix task: ${result.fixTaskId}` : `QA status: ${result.status}`,
      artifacts: [result.evidence]
    };
  }

  if (action.role === "reviewer") {
    const handoff = readHandoff(handoffFile(runDirPath, "reviewer", action.taskId));
    const gate = validateRoleHandoff("reviewer", handoff, runId, action.taskId);
    if (gate.errors.length > 0 || !gate.handoff || !isReviewDecision(gate.handoff.status)) {
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "waiting_for_agent_output", detail: `Reviewer handoff invalid: ${gate.errors.join("; ")}`, artifacts: [] };
    }
    const result = reviewTask(cwd, runId, action.taskId, gate.handoff.status, gate.handoff.summary || "");
    return {
      iteration: 0,
      actionId: action.id,
      kind: action.kind,
      status: result.status === "blocked" ? "blocked" : "completed",
      detail: result.fixTaskId ? `Review status: ${result.status}; fix task: ${result.fixTaskId}` : `Review status: ${result.status}`,
      artifacts: [result.evidence]
    };
  }
  if (action.role === "merge-agent") {
    const handoff = readHandoff(handoffFile(runDirPath, "merge-agent", action.taskId));
    const gate = validateRoleHandoff("merge-agent", handoff, runId, action.taskId);
    if (gate.errors.length > 0 || !gate.handoff) {
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "waiting_for_agent_output", detail: `Merge Agent handoff invalid: ${gate.errors.join("; ")}`, artifacts: [] };
    }
    if (gate.handoff.status === "blocked") {
      updateRunStatus(cwd, runId, "blocked", { merge_agent_blocked_at: new Date().toISOString(), merge_agent_summary: gate.handoff.summary || "", merge_agent_task_id: action.taskId });
      return { iteration: 0, actionId: action.id, kind: action.kind, status: "blocked", detail: `Merge Agent blocked: ${gate.handoff.summary || "blocked"}`, artifacts: stringList(gate.handoff.evidence) };
    }
    return {
      iteration: 0,
      actionId: action.id,
      kind: action.kind,
      status: "completed",
      detail: `merge ready for commit: ${action.taskId}`,
      artifacts: stringList(gate.handoff.evidence)
    };
  }
  return { iteration: 0, actionId: action.id, kind: action.kind, status: "completed", detail: `agent execution recorded for role ${action.role}`, artifacts: [] };
}

function writeAutoTimeline(cwd: string, runId: string, steps: AutoOrchestratorStep[], status: AutoOrchestratorResult["status"]): string {
  const file = path.join(runDir(cwd, runId), "orchestration", "auto-timeline.md");
  writeText(file, [
    "# Auto Orchestration Timeline",
    "",
    `- run: ${runId}`,
    `- status: ${status}`,
    `- steps: ${steps.length}`,
    "",
    ...steps.map((step) => `- ${step.iteration}: [${step.status}] ${step.actionId} - ${step.detail}`)
  ].join("\n"));
  return file;
}

export async function runAutoOrchestrator(cwd: string, runId: string, options: AutoOrchestratorOptions): Promise<AutoOrchestratorResult> {
  const steps: AutoOrchestratorStep[] = [];
  let last = resumeRun(cwd, runId);
  const runLock = acquireLock(cwd, runId, "run");
  if (!runLock.acquired) {
    const step = {
      iteration: 0,
      actionId: "run-lock",
      kind: "runtime",
      status: "blocked" as const,
      detail: runLock.reason || "run lock is held",
      artifacts: [runLock.file]
    };
    steps.push(step);
    writeCheckpoint(cwd, runId, step.actionId, "after", "blocked", step.detail, step.artifacts);
    const timeline = writeAutoTimeline(cwd, runId, steps, "blocked");
    return { runId, status: "blocked", iterations: 0, steps, lastOrchestration: last, timeline };
  }

  try {
    const latestCheckpoint = readLatestCheckpoint(cwd, runId);
    if (latestCheckpoint) {
      steps.push({
        iteration: 0,
        actionId: "resume-from-checkpoint",
        kind: "runtime",
        status: "completed",
        detail: `resuming after ${latestCheckpoint.action_id} ${latestCheckpoint.status}`,
        artifacts: [latestCheckpoint.file]
      });
    }
    for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
      last = resumeRun(cwd, runId);
      const action = firstReadyAction(cwd, runId, last);
      if (!action) {
        const status: AutoOrchestratorResult["status"] = last.status === "completed" ? "completed" : "waiting_for_agent_output";
        const waitingOnDependencies = last.nextActions.some((candidate) => candidate.status === "ready" && !isActionCompleted(cwd, runId, candidate.id));
        writeCheckpoint(cwd, runId, "orchestrator-idle", "after", status === "completed" ? "completed" : "waiting_for_agent_output", waitingOnDependencies ? "ready actions are waiting for completed dependencies" : `no ready action; run state is ${last.status}`, []);
        const timeline = writeAutoTimeline(cwd, runId, steps, status);
        return { runId, status, iterations: iteration - 1, steps, lastOrchestration: last, timeline };
      }

      const batch = readyActionBatch(cwd, runId, last, action);
      if (action.status === "blocked") {
        const step = { iteration, actionId: action.id, kind: action.kind, status: "blocked" as const, detail: action.reason, artifacts: action.outputs };
        steps.push(step);
        writeCheckpoint(cwd, runId, action.id, "after", "blocked", action.reason, action.outputs);
        updateRunStatus(cwd, runId, "needs_infrastructure_action", { auto_blocked_at: new Date().toISOString(), auto_blocked_reason: action.reason });
        const timeline = writeAutoTimeline(cwd, runId, steps, "blocked");
        return { runId, status: "blocked", iterations: iteration, steps, lastOrchestration: last, timeline };
      }

      const actionLock = acquireLock(cwd, runId, "action", action.id);
      if (!actionLock.acquired) {
        const step = { iteration, actionId: action.id, kind: action.kind, status: "blocked" as const, detail: actionLock.reason || "action lock is held", artifacts: [actionLock.file] };
        steps.push(step);
        writeCheckpoint(cwd, runId, action.id, "after", "blocked", step.detail, step.artifacts);
        const timeline = writeAutoTimeline(cwd, runId, steps, "blocked");
        return { runId, status: "blocked", iterations: iteration, steps, lastOrchestration: last, timeline };
      }

      try {
        writeCheckpoint(cwd, runId, action.id, "before", "started", action.reason, action.inputs);
      if (action.kind === "runtime" || action.id === "agent-archive") {
        const step = { ...executeRuntimeAction(cwd, runId, action), iteration };
        steps.push(step);
        writeCheckpoint(cwd, runId, action.id, "after", step.status === "completed" ? "completed" : step.status, step.detail, step.artifacts);
        if (step.status === "blocked") {
          const timeline = writeAutoTimeline(cwd, runId, steps, "blocked");
          return { runId, status: "blocked", iterations: iteration, steps, lastOrchestration: resumeRun(cwd, runId), timeline };
        }
        continue;
      }

      if (action.kind === "agent") {
        const waveStartedAt = new Date().toISOString();
        const readyForProcessing = batch.every((item) => agentActionReadyForProcessing(cwd, runId, last.runDir, item));
        if (options.dryRun || !readyForProcessing) {
          const latest = resumeRun(cwd, runId);
          recordParallelWave(cwd, runId, {
            iteration,
            parallel_group: action.parallelGroup,
            action_ids: batch.map((item) => item.id),
            task_ids: batch.map((item) => item.taskId).filter((item): item is string => Boolean(item)),
            roles: Array.from(new Set(batch.map((item) => item.role))),
            status: "waiting_for_agent_output",
            reason: options.dryRun
              ? "dry-run stopped before provider dispatch"
              : "current session must dispatch this ready batch with native subagents and write back handoff or worktree results",
            started_at: waveStartedAt,
            completed_at: new Date().toISOString()
          });
          const step = {
            iteration,
            actionId: action.id,
            kind: action.kind,
            status: "waiting_for_agent_output" as const,
            detail: options.dryRun
              ? `dry-run stopped at dispatch contracts for ${batch.length} agent(s)`
              : `waiting for current session to dispatch ${batch.length} agent(s) and write handoff/worktree output`,
            artifacts: [latest.files.dispatchContracts]
          };
          steps.push(step);
          writeCheckpoint(cwd, runId, action.id, "after", "waiting_for_agent_output", step.detail, step.artifacts);
          const timeline = writeAutoTimeline(cwd, runId, steps, "waiting_for_agent_output");
          return { runId, status: "waiting_for_agent_output", iterations: iteration, steps, lastOrchestration: latest, timeline };
        }

        const processedBatchStatuses: Array<"completed" | "waiting_for_agent_output" | "blocked" | "failed"> = [];
        for (const batchAction of batch) {
          const processed = { ...processExecutedAgent(cwd, runId, last.runDir, batchAction), iteration };
          steps.push(processed);
          writeCheckpoint(cwd, runId, batchAction.id, "after", processed.status, processed.detail, processed.artifacts);
          processedBatchStatuses.push(processed.status);
          if (processed.status === "blocked" || processed.status === "waiting_for_agent_output") {
            recordParallelWave(cwd, runId, {
              iteration,
              parallel_group: action.parallelGroup,
              action_ids: batch.map((item) => item.id),
              task_ids: batch.map((item) => item.taskId).filter((item): item is string => Boolean(item)),
              roles: Array.from(new Set(batch.map((item) => item.role))),
              status: processed.status,
              reason: processed.detail,
              started_at: waveStartedAt,
              completed_at: new Date().toISOString()
            });
            const status = processed.status === "blocked" ? "blocked" : "waiting_for_agent_output";
            const timeline = writeAutoTimeline(cwd, runId, steps, status);
            return { runId, status, iterations: iteration, steps, lastOrchestration: resumeRun(cwd, runId), timeline };
          }
        }
        recordParallelWave(cwd, runId, {
          iteration,
          parallel_group: action.parallelGroup,
          action_ids: batch.map((item) => item.id),
          task_ids: batch.map((item) => item.taskId).filter((item): item is string => Boolean(item)),
          roles: Array.from(new Set(batch.map((item) => item.role))),
          status: processedBatchStatuses.every((item) => item === "completed") ? "completed" : "blocked",
          reason: processedBatchStatuses.every((item) => item === "completed")
            ? `ready batch completed with ${processedBatchStatuses.length} processed agent result(s)`
            : "one or more agent results did not complete cleanly",
          started_at: waveStartedAt,
          completed_at: new Date().toISOString()
        });
      }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        steps.push({ iteration, actionId: action.id, kind: action.kind, status: "failed", detail, artifacts: [] });
        writeCheckpoint(cwd, runId, action.id, "after", "failed", detail, []);
        updateRunStatus(cwd, runId, "blocked", { auto_failed_at: new Date().toISOString(), auto_failed_reason: detail });
        const timeline = writeAutoTimeline(cwd, runId, steps, "blocked");
        return { runId, status: "blocked", iterations: iteration, steps, lastOrchestration: resumeRun(cwd, runId), timeline };
      } finally {
        releaseLock(cwd, actionLock);
      }
    }

    const timeline = writeAutoTimeline(cwd, runId, steps, "max_iterations");
    writeCheckpoint(cwd, runId, "orchestrator-max-iterations", "after", "blocked", "max iterations reached", [timeline]);
    return { runId, status: "max_iterations", iterations: options.maxIterations, steps, lastOrchestration: resumeRun(cwd, runId), timeline };
  } finally {
    releaseLock(cwd, runLock);
  }
}
