import fs from "node:fs";
import path from "node:path";
import { buildDispatchContracts, type DispatchContract } from "./dispatch.js";
import { ensureDir, writeText } from "./fs.js";
import { isRunState, normalizeRunState, transitionRunState, type RunState } from "./state-machine.js";
import { writeTrueHarnessEvidence } from "./true-harness-evidence.js";
import type { ExecutionMode } from "./execution-mode.js";

export type OrchestrationActionKind = "runtime" | "agent";
export type OrchestrationActionStatus = "ready" | "waiting" | "blocked" | "done";

export interface OrchestrationAction {
  id: string;
  kind: OrchestrationActionKind;
  status: OrchestrationActionStatus;
  role: string;
  taskId?: string;
  command?: string;
  reason: string;
  inputs: string[];
  outputs: string[];
  dependsOn: string[];
  parallelGroup: string;
}

export interface AgentRun {
  id: string;
  instanceId?: string;
  role: string;
  taskId?: string;
  workflowState?: string;
  status: "ready" | "waiting" | "planned" | "completed";
  executionSource?: "true_harness";
  executedBy?: "native_agent";
  executionStatus?: "unprepared" | "prepared" | "waiting_for_agent_output" | "executed" | "failed" | "completed";
  outputDir?: string;
  handoffFile?: string;
  preparedAt?: string;
  startedAt?: string;
  completedAt?: string;
  skills: string[];
  inputs: string[];
  outputs: string[];
  readScope: string[];
  writeScope: string[];
  dependsOn: string[];
  parallelGroup: string;
}

export interface ParallelGroup {
  id: string;
  status: "ready" | "waiting" | "blocked" | "done";
  reason: string;
  actionIds: string[];
  readyActionIds: string[];
  taskIds: string[];
  roles: string[];
}

export interface OrchestratorResult {
  runId: string;
  runDir: string;
  mode: "orchestrate" | "resume";
  status: RunState;
  executionMode: ExecutionMode;
  nextActions: OrchestrationAction[];
  agentRuns: AgentRun[];
  dispatchContracts: DispatchContract[];
  parallelGroups: ParallelGroup[];
  files: {
    session: string;
    state: string;
    queue: string;
    agentRuns: string;
    dispatchContracts: string;
    parallelPlan: string;
    parallelExecution: string;
    timeline: string;
  };
}

interface RunMetadata {
  run_id: string;
  status?: string;
}

interface ExecutionMetadata {
  status?: string;
  prepared_at?: string;
  started_at?: string;
  completed_at?: string;
  output_dir?: string;
}

interface AgentAuthoredSession {
  schema_version?: number;
  run_id?: string;
  decision_source?: string;
  execution_mode?: string;
  harness_classification?: string;
  status?: string;
  summary?: string;
  next_actions?: OrchestrationAction[];
  agent_runs?: AgentRun[];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function optionalJson<T>(file: string): T | null {
  return fs.existsSync(file) ? readJson<T>(file) : null;
}

function exists(file: string): boolean {
  return fs.existsSync(file);
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!exists(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function executionMetadata(runDirPath: string, agentId: string): ExecutionMetadata | null {
  return optionalJson<ExecutionMetadata>(path.join(runDirPath, "agents", agentId, "execution", "execution-status.json"));
}

function withRuntimeExecution(agent: AgentRun, runDirPath: string): AgentRun {
  const metadata = executionMetadata(runDirPath, agent.id);
  return {
    ...agent,
    executionSource: "true_harness",
    executedBy: "native_agent",
    executionStatus: metadata?.status === "executed"
      ? "executed"
      : metadata?.status === "failed"
        ? "failed"
        : metadata?.status === "dry_run"
          ? "waiting_for_agent_output"
          : agent.status === "completed"
            ? "completed"
            : "waiting_for_agent_output",
    outputDir: metadata?.output_dir || agent.outputDir,
    handoffFile: agent.handoffFile || path.join(runDirPath, "agents", agent.id, "handoff.json"),
    preparedAt: metadata?.prepared_at || agent.preparedAt,
    startedAt: metadata?.started_at || agent.startedAt,
    completedAt: metadata?.completed_at || agent.completedAt
  };
}

function groupActions(actions: OrchestrationAction[]): ParallelGroup[] {
  const groups = new Map<string, OrchestrationAction[]>();
  for (const action of actions) {
    const existing = groups.get(action.parallelGroup) || [];
    existing.push(action);
    groups.set(action.parallelGroup, existing);
  }
  return Array.from(groups.entries()).map(([id, group]) => ({
    id,
    status: group.some((action) => action.status === "blocked")
      ? "blocked"
      : group.some((action) => action.status === "ready")
        ? "ready"
        : group.some((action) => action.status === "waiting")
          ? "waiting"
          : "done",
    reason: group.length > 1 ? "orchestrator agent declared this parallel boundary" : "single action boundary",
    actionIds: group.map((action) => action.id),
    readyActionIds: group.filter((action) => action.status === "ready").map((action) => action.id),
    taskIds: Array.from(new Set(group.map((action) => action.taskId).filter((value): value is string => Boolean(value)))),
    roles: Array.from(new Set(group.map((action) => action.role)))
  }));
}

function validateSession(session: AgentAuthoredSession, runId: string): void {
  if (session.decision_source !== "orchestrator_agent") {
    throw new Error("orchestrator-session.json must declare decision_source=orchestrator_agent");
  }
  if (session.run_id !== runId) {
    throw new Error(`orchestrator-session.json run_id mismatch: expected ${runId}`);
  }
  if (session.execution_mode !== "true_harness") {
    throw new Error("orchestrator-session.json must declare execution_mode=true_harness");
  }
  if (session.harness_classification !== "true_harness") {
    throw new Error("orchestrator-session.json must declare harness_classification=true_harness");
  }
  if (!session.status || !isRunState(session.status)) {
    throw new Error("orchestrator-session.json must declare a valid run status");
  }
  if (!Array.isArray(session.next_actions)) {
    throw new Error("orchestrator-session.json must define next_actions");
  }
  if (!Array.isArray(session.agent_runs)) {
    throw new Error("orchestrator-session.json must define agent_runs");
  }
}

function effectiveStatus(current: RunState, sessionStatus: RunState): RunState {
  const runtimeOwned = new Set<RunState>([
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
  return runtimeOwned.has(current) ? current : sessionStatus;
}

function writeTimeline(file: string, result: Omit<OrchestratorResult, "files">): void {
  const actionable = result.nextActions.filter((action) => action.status !== "done");
  writeText(file, [
    "# Orchestration Timeline",
    "",
    `- run: ${result.runId}`,
    `- mode: ${result.mode}`,
    `- execution mode: ${result.executionMode}`,
    `- status: ${result.status}`,
    `- next actions: ${actionable.length}`,
    "",
    "## Next Actions",
    "",
    actionable.length > 0
      ? actionable.map((action) => `- [${action.status}] ${action.id}: ${action.reason}`).join("\n")
      : "- none",
    "",
    "## Parallel Groups",
    "",
    result.parallelGroups.length > 0
      ? result.parallelGroups.map((group) => `- ${group.id}: ${group.actionIds.join(", ")}`).join("\n")
      : "- none"
  ].join("\n"));
}

function persist(cwd: string, runId: string, result: Omit<OrchestratorResult, "files">): OrchestratorResult {
  const runDirPath = runDir(cwd, runId);
  const orchestrationDir = path.join(runDirPath, "orchestration");
  ensureDir(orchestrationDir);
  const files = {
    session: path.join(orchestrationDir, "orchestrator-session.json"),
    state: path.join(orchestrationDir, "state.json"),
    queue: path.join(orchestrationDir, "queue.json"),
    agentRuns: path.join(orchestrationDir, "agent-runs.json"),
    dispatchContracts: path.join(orchestrationDir, "dispatch-contracts.json"),
    parallelPlan: path.join(orchestrationDir, "parallel-plan.json"),
    parallelExecution: path.join(orchestrationDir, "parallel-execution.json"),
    timeline: path.join(orchestrationDir, "auto-timeline.md")
  };
  const dispatchContracts = exists(files.session)
    ? buildDispatchContracts(cwd, runId, runDirPath, files.session)
    : [];
  const actionable = result.nextActions.filter((action) => action.status !== "done");
  const existingExecution = optionalJson<{ wave_history?: unknown[]; executed_parallel_groups?: string[]; blocked_parallel_groups?: string[] }>(files.parallelExecution);

  writeText(files.state, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    current_orchestrator: "orchestrator_agent",
    decision_source: "orchestrator_agent",
    status: result.status,
    execution_mode: result.executionMode,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`);
  writeText(files.queue, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    updated_at: new Date().toISOString(),
    actions: actionable,
    contracts: dispatchContracts.filter((item) => item.status !== "done")
  }, null, 2)}\n`);
  writeText(files.dispatchContracts, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    contracts: dispatchContracts
  }, null, 2)}\n`);
  writeText(files.parallelPlan, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    artifact_type: "planning",
    parallel_groups: result.parallelGroups
  }, null, 2)}\n`);
  writeText(files.parallelExecution, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    artifact_type: "execution",
    executed_parallel_groups: Array.isArray(existingExecution?.executed_parallel_groups) ? existingExecution.executed_parallel_groups : [],
    blocked_parallel_groups: Array.isArray(existingExecution?.blocked_parallel_groups) ? existingExecution.blocked_parallel_groups : [],
    wave_history: Array.isArray(existingExecution?.wave_history) ? existingExecution.wave_history : []
  }, null, 2)}\n`);
  writeTimeline(files.timeline, result);
  writeText(files.agentRuns, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    agents: result.agentRuns
  }, null, 2)}\n`);
  writeTrueHarnessEvidence(cwd, runId);
  return { ...result, dispatchContracts, files };
}

function waitingForOrchestratorDecision(cwd: string, runId: string, mode: OrchestratorResult["mode"]): OrchestratorResult {
  const runDirPath = runDir(cwd, runId);
  const result: Omit<OrchestratorResult, "files"> = {
    runId,
    runDir: runDirPath,
    mode,
    status: "waiting_for_agent_output",
    executionMode: "true_harness",
    nextActions: [],
    agentRuns: [],
    dispatchContracts: [],
    parallelGroups: []
  };
  return persist(cwd, runId, result);
}

function buildSessionDrivenDecision(cwd: string, runId: string, mode: OrchestratorResult["mode"]): Omit<OrchestratorResult, "files"> {
  const runDirPath = runDir(cwd, runId);
  const sessionFile = path.join(runDirPath, "orchestration", "orchestrator-session.json");
  if (!exists(sessionFile)) {
    return {
      runId,
      runDir: runDirPath,
      mode,
      status: "waiting_for_agent_output",
      executionMode: "true_harness",
      nextActions: [],
      agentRuns: [],
      dispatchContracts: [],
      parallelGroups: []
    };
  }

  const session = readJson<AgentAuthoredSession>(sessionFile);
  validateSession(session, runId);

  const metadata = readJson<RunMetadata>(path.join(runDirPath, "run.json"));
  const currentStatus = normalizeRunState(metadata.status);
  const sessionStatus = normalizeRunState(session.status);
  const status = effectiveStatus(currentStatus, sessionStatus);
  if (status !== currentStatus) {
    transitionRunState(cwd, runId, status, {
      orchestrator_decision_source: "orchestrator_agent"
    });
  }

  const nextActions = session.next_actions || [];
  const agentRuns = (session.agent_runs || []).map((agent) => withRuntimeExecution(agent, runDirPath));
  const parallelGroups = groupActions(nextActions);

  return {
    runId,
    runDir: runDirPath,
    mode,
    status,
    executionMode: "true_harness",
    nextActions,
    agentRuns,
    dispatchContracts: [],
    parallelGroups
  };
}

export function orchestrateRun(cwd: string, runId: string, mode: OrchestratorResult["mode"] = "orchestrate"): OrchestratorResult {
  const sessionFile = path.join(runDir(cwd, runId), "orchestration", "orchestrator-session.json");
  if (!exists(sessionFile)) return waitingForOrchestratorDecision(cwd, runId, mode);
  return persist(cwd, runId, buildSessionDrivenDecision(cwd, runId, mode));
}

export function resumeRun(cwd: string, runId: string): OrchestratorResult {
  return orchestrateRun(cwd, runId, "resume");
}
