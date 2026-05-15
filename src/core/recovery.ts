import fs from "node:fs";
import path from "node:path";
import { readFixLoopRecoveryState } from "./fix-loop.js";
import { writeText } from "./fs.js";
import { refreshOrchestrationSnapshot } from "./orchestration-sync.js";
import { assertTransitionAccepted, isRunState, isTaskState, transitionRunState, transitionTaskState, type RunState, type TaskState } from "./state-machine.js";

export interface RecoveryResult {
  runId: string;
  taskId: string;
  fromTaskState: string;
  toTaskState: TaskState;
  fromRunState: string;
  toRunState: RunState;
  status: "recovered";
  audit: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function currentTaskState(cwd: string, runId: string, taskId: string): string {
  const file = path.join(runDir(cwd, runId), "tasks", taskId, "status.json");
  if (!fs.existsSync(file)) throw new Error(`Task not found: ${taskId}`);
  const parsed = readJson<{ status?: unknown }>(file);
  return typeof parsed.status === "string" ? parsed.status : "planned";
}

function currentRunState(cwd: string, runId: string): string {
  const parsed = readJson<{ status?: unknown }>(path.join(runDir(cwd, runId), "run.json"));
  return typeof parsed.status === "string" ? parsed.status : "created";
}

function canTransitionToPlanned(fromRunState: string): boolean {
  return fromRunState === "planned"
    || fromRunState === "blocked"
    || fromRunState === "needs_requirement_reanalysis"
    || fromRunState === "needs_design_update"
    || fromRunState === "needs_task_replan"
    || fromRunState === "needs_infrastructure_action";
}

function inferDevRecoveryRun(fromRunState: string): RunState {
  if (fromRunState === "implementing" || fromRunState === "integrating" || fromRunState === "verifying" || fromRunState === "reviewing") {
    return fromRunState;
  }
  if (fromRunState === "planned" || fromRunState === "waiting_for_agent_output" || fromRunState === "branch_prepared") {
    return "implementing";
  }
  if (fromRunState === "blocked" || fromRunState === "needs_dev_fix" || fromRunState === "needs_infrastructure_action") {
    return "implementing";
  }
  return "needs_dev_fix";
}

function inferRecovery(taskState: string, fromRunState: string): { task: TaskState; run: RunState } {
  if (taskState === "patch_invalid") return { task: "ready_for_dev", run: inferDevRecoveryRun(fromRunState) };
  if (taskState === "qa_failed") {
    const workflow = readFixLoopRecoveryState("qa_failed");
    return { task: workflow.recovery_task_state, run: inferDevRecoveryRun(fromRunState) };
  }
  if (taskState === "qa_blocked") return { task: "ready_for_dev", run: inferDevRecoveryRun(fromRunState) };
  if (taskState === "review_changes_requested") {
    const workflow = readFixLoopRecoveryState("review_changes_requested");
    return { task: workflow.recovery_task_state, run: inferDevRecoveryRun(fromRunState) };
  }
  if (taskState === "review_blocked") return { task: "ready_for_dev", run: inferDevRecoveryRun(fromRunState) };
  if (taskState === "needs_dev_fix" || taskState === "blocked") return { task: "ready_for_dev", run: inferDevRecoveryRun(fromRunState) };
  if (taskState === "implementation_blocked_by_design") {
    const workflow = readFixLoopRecoveryState("implementation_blocked_by_design");
    return {
      task: workflow.recovery_task_state,
      run: canTransitionToPlanned(fromRunState) ? "planned" : "needs_design_update"
    };
  }
  throw new Error(`Task ${taskState} does not have a formal recovery path`);
}

export function recoverTask(cwd: string, runId: string, taskId: string): RecoveryResult {
  const fromTaskState = currentTaskState(cwd, runId, taskId);
  if (!isTaskState(fromTaskState)) throw new Error(`Task ${taskId} has unknown state: ${fromTaskState}`);
  const fromRunState = currentRunState(cwd, runId);
  if (!isRunState(fromRunState)) throw new Error(`Run ${runId} has unknown state: ${fromRunState}`);
  const target = inferRecovery(fromTaskState, fromRunState);
  const audit = path.join(runDir(cwd, runId), "orchestration", `recovery-${taskId}.json`);
  writeText(audit, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    task_id: taskId,
    from_task_state: fromTaskState,
    to_task_state: target.task,
    from_run_state: fromRunState,
    to_run_state: target.run,
    reason: "formal recovery path selected by current task/run state",
    recorded_at: new Date().toISOString()
  }, null, 2)}\n`);
  assertTransitionAccepted(transitionTaskState(cwd, runId, taskId, target.task, {
    recovered_at: new Date().toISOString(),
    recovered_from: fromTaskState
  }), `recover task ${taskId}`);
  assertTransitionAccepted(transitionRunState(cwd, runId, target.run, {
    recovered_at: new Date().toISOString(),
    recovered_task_id: taskId,
    recovered_from: fromRunState
  }), `recover run ${runId}`);
  refreshOrchestrationSnapshot(cwd, runId);
  return {
    runId,
    taskId,
    fromTaskState,
    toTaskState: target.task,
    fromRunState,
    toRunState: target.run,
    status: "recovered",
    audit
  };
}
