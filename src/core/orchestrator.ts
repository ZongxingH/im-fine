import fs from "node:fs";
import path from "node:path";
import { buildDispatchContracts, type DispatchContract } from "./dispatch.js";
import { ensureDir, writeText } from "./fs.js";
import { agentHandoffCandidates, validateAgentHandoff } from "./handoff-evidence.js";
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

type JsonObject = Record<string, unknown>;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function optionalJson<T>(file: string): T | null {
  return fs.existsSync(file) ? readJson<T>(file) : null;
}

function exists(file: string): boolean {
  return fs.existsSync(file);
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!exists(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: JsonObject, field: string, pathName: string, errors: string[]): string | undefined {
  const item = value[field];
  if (typeof item !== "string" || item.trim().length === 0) {
    errors.push(`${pathName}.${field} is required`);
    return undefined;
  }
  return item;
}

function optionalStringField(value: JsonObject, field: string, pathName: string, errors: string[]): string | undefined {
  const item = value[field];
  if (item === undefined) return undefined;
  if (typeof item !== "string" || item.trim().length === 0) {
    errors.push(`${pathName}.${field} must be a non-empty string`);
    return undefined;
  }
  return item;
}

function stringArrayField(value: JsonObject, field: string, pathName: string, errors: string[]): string[] {
  const item = value[field];
  if (!Array.isArray(item)) {
    errors.push(`${pathName}.${field} is required`);
    return [];
  }
  const strings = item.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  if (strings.length !== item.length) errors.push(`${pathName}.${field} must contain only non-empty strings`);
  return strings;
}

function validateAction(value: unknown, index: number, ids: Set<string>, errors: string[]): OrchestrationAction | null {
  const pathName = `next_actions[${index}]`;
  if (!isObject(value)) {
    errors.push(`${pathName} must be an object`);
    return null;
  }
  const id = stringField(value, "id", pathName, errors);
  if (id) {
    if (ids.has(id)) errors.push(`${pathName}.id duplicates ${id}`);
    ids.add(id);
  }
  const kind = stringField(value, "kind", pathName, errors);
  if (kind && kind !== "runtime" && kind !== "agent") errors.push(`${pathName}.kind must be runtime or agent`);
  const status = stringField(value, "status", pathName, errors);
  if (status && !["ready", "waiting", "blocked", "done"].includes(status)) {
    errors.push(`${pathName}.status must be ready, waiting, blocked, or done`);
  }
  stringField(value, "role", pathName, errors);
  optionalStringField(value, "taskId", pathName, errors);
  optionalStringField(value, "command", pathName, errors);
  stringField(value, "reason", pathName, errors);
  stringArrayField(value, "inputs", pathName, errors);
  stringArrayField(value, "outputs", pathName, errors);
  stringArrayField(value, "dependsOn", pathName, errors);
  stringField(value, "parallelGroup", pathName, errors);
  return value as unknown as OrchestrationAction;
}

function validateAgentRun(value: unknown, index: number, ids: Set<string>, errors: string[]): AgentRun | null {
  const pathName = `agent_runs[${index}]`;
  if (!isObject(value)) {
    errors.push(`${pathName} must be an object`);
    return null;
  }
  const id = stringField(value, "id", pathName, errors);
  if (id) {
    if (ids.has(id)) errors.push(`${pathName}.id duplicates ${id}`);
    ids.add(id);
  }
  stringField(value, "role", pathName, errors);
  optionalStringField(value, "taskId", pathName, errors);
  optionalStringField(value, "workflowState", pathName, errors);
  const status = stringField(value, "status", pathName, errors);
  if (status && !["ready", "waiting", "planned", "completed"].includes(status)) {
    errors.push(`${pathName}.status must be ready, waiting, planned, or completed`);
  }
  stringArrayField(value, "skills", pathName, errors);
  stringArrayField(value, "inputs", pathName, errors);
  stringArrayField(value, "outputs", pathName, errors);
  stringArrayField(value, "readScope", pathName, errors);
  stringArrayField(value, "writeScope", pathName, errors);
  stringArrayField(value, "dependsOn", pathName, errors);
  stringField(value, "parallelGroup", pathName, errors);
  return value as unknown as AgentRun;
}

function actionMatchesAgent(action: OrchestrationAction, agent: AgentRun): boolean {
  const derivedId = action.taskId
    ? action.role === "dev" || action.role === "technical-writer"
      ? action.taskId
      : `${action.role}-${action.taskId}`
    : action.role;
  return action.role === agent.role
    && (action.taskId || "") === (agent.taskId || "")
    && (action.parallelGroup === agent.parallelGroup || derivedId === agent.id);
}

function executionMetadata(runDirPath: string, agentId: string): ExecutionMetadata | null {
  return optionalJson<ExecutionMetadata>(path.join(runDirPath, "agents", agentId, "execution", "execution-status.json"));
}

function withRuntimeExecution(agent: AgentRun, runDirPath: string, runId: string): AgentRun {
  const metadata = executionMetadata(runDirPath, agent.id);
  const handoff = validateAgentHandoff(agent, runDirPath, runId);
  const hasHandoff = handoff.passed;
  const status = agent.status === "completed" || hasHandoff ? "completed" : agent.status;
  return {
    ...agent,
    status,
    executionSource: "true_harness",
    executedBy: "native_agent",
    executionStatus: metadata?.status === "executed"
      ? "executed"
      : metadata?.status === "failed"
        ? "failed"
        : metadata?.status === "dry_run"
          ? "waiting_for_agent_output"
          : status === "completed"
            ? "completed"
            : "waiting_for_agent_output",
    outputDir: metadata?.output_dir || agent.outputDir,
    handoffFile: agent.handoffFile || path.join(runDirPath, "agents", agent.id, "handoff.json"),
    preparedAt: metadata?.prepared_at || agent.preparedAt,
    startedAt: metadata?.started_at || agent.startedAt,
    completedAt: metadata?.completed_at || agent.completedAt
  };
}

function invalidExistingHandoffs(nextActions: OrchestrationAction[], agentRuns: AgentRun[], runDirPath: string, runId: string): string[] {
  const errors: string[] = [];
  for (const action of nextActions) {
    if (action.kind !== "agent" || action.status !== "done") continue;
    const agent = agentRuns.find((item) => actionMatchesAgent(action, item));
    if (!agent) continue;
    const validation = validateAgentHandoff(agent, runDirPath, runId);
    if (!validation.passed) {
      errors.push(`next_actions.${action.id}.handoff is required for done agent action: ${validation.errors.join("; ")}`);
    }
  }
  for (const agent of agentRuns) {
    const hasFile = agentHandoffCandidates(agent, runDirPath).some((file) => fs.existsSync(file));
    if (!hasFile) {
      if (agent.status === "completed" || agent.executionStatus === "completed") {
        errors.push(`agent_runs.${agent.id}.handoff is required for completed agent`);
      }
      continue;
    }
    const validation = validateAgentHandoff(agent, runDirPath, runId);
    if (!validation.passed) {
      errors.push(`agent_runs.${agent.id}.handoff invalid at ${validation.file || "missing"}: ${validation.errors.join("; ")}`);
    }
  }
  return errors;
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

function validateSession(session: AgentAuthoredSession, runId: string): string[] {
  const errors: string[] = [];
  if (session.decision_source !== "orchestrator_agent") {
    errors.push("decision_source must be orchestrator_agent");
  }
  if (session.run_id !== runId) {
    errors.push(`run_id mismatch: expected ${runId}`);
  }
  if (session.execution_mode !== "true_harness") {
    errors.push("execution_mode must be true_harness");
  }
  if (session.harness_classification !== "true_harness") {
    errors.push("harness_classification must be true_harness");
  }
  if (!session.status || !isRunState(session.status)) {
    errors.push("status must be a valid run state");
  }
  if (!Array.isArray(session.next_actions)) {
    errors.push("next_actions is required");
  }
  if (!Array.isArray(session.agent_runs)) {
    errors.push("agent_runs is required");
  }

  const actionIds = new Set<string>();
  const actions = Array.isArray(session.next_actions)
    ? session.next_actions.map((action, index) => validateAction(action, index, actionIds, errors)).filter((item): item is OrchestrationAction => Boolean(item))
    : [];
  const agentIds = new Set<string>();
  const agents = Array.isArray(session.agent_runs)
    ? session.agent_runs.map((agent, index) => validateAgentRun(agent, index, agentIds, errors)).filter((item): item is AgentRun => Boolean(item))
    : [];

  for (const action of actions) {
    for (const dependency of action.dependsOn) {
      if (!actionIds.has(dependency)) errors.push(`next_actions.${action.id}.dependsOn references unknown action ${dependency}`);
    }
    if (action.kind === "agent" && !agents.some((agent) => actionMatchesAgent(action, agent))) {
      errors.push(`next_actions.${action.id} has no matching agent_run`);
    }
  }

  for (const agent of agents) {
    for (const dependency of agent.dependsOn) {
      if (!actionIds.has(dependency) && !agentIds.has(dependency)) {
        errors.push(`agent_runs.${agent.id}.dependsOn references unknown action or agent ${dependency}`);
      }
    }
    if (!actions.some((action) => action.kind === "agent" && actionMatchesAgent(action, agent))) {
      errors.push(`agent_runs.${agent.id} has no matching agent action`);
    }
  }
  return errors;
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
  const dispatchContracts = exists(files.session) && result.nextActions.length > 0 && result.agentRuns.length > 0
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
  const validationErrors = validateSession(session, runId);
  if (validationErrors.length > 0) {
    writeText(path.join(runDirPath, "orchestration", "session-validation.json"), `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      status: "blocked",
      errors: validationErrors,
      validated_at: new Date().toISOString()
    }, null, 2)}\n`);
    transitionRunState(cwd, runId, "blocked", {
      blocked_at: new Date().toISOString(),
      blocked_reason: "orchestrator-session schema validation failed",
      session_validation_errors: validationErrors
    });
    return {
      runId,
      runDir: runDirPath,
      mode,
      status: "blocked",
      executionMode: "true_harness",
      nextActions: [],
      agentRuns: [],
      dispatchContracts: [],
      parallelGroups: []
    };
  }

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
  const agentRuns = (session.agent_runs || []).map((agent) => withRuntimeExecution(agent, runDirPath, runId));
  const handoffErrors = invalidExistingHandoffs(nextActions, agentRuns, runDirPath, runId);
  if (handoffErrors.length > 0) {
    writeText(path.join(runDirPath, "orchestration", "handoff-validation.json"), `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      status: "blocked",
      errors: handoffErrors,
      validated_at: new Date().toISOString()
    }, null, 2)}\n`);
    transitionRunState(cwd, runId, "blocked", {
      blocked_at: new Date().toISOString(),
      blocked_reason: "agent handoff schema validation failed",
      handoff_validation_errors: handoffErrors
    });
    return {
      runId,
      runDir: runDirPath,
      mode,
      status: "blocked",
      executionMode: "true_harness",
      nextActions: [],
      agentRuns: [],
      dispatchContracts: [],
      parallelGroups: []
    };
  }
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
