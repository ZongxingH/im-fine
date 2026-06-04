import fs from "node:fs";
import path from "node:path";
import { buildDispatchContracts, type DispatchContract } from "./dispatch.js";
import { ensureDir, writeText } from "./fs.js";
import { agentHandoffCandidates, validateAgentHandoff } from "./handoff-evidence.js";
import { isRunState, normalizeRunState, transitionRunState, type RunState } from "./state-machine.js";
import { writeTrueHarnessEvidence } from "./true-harness-evidence.js";
import type { ExecutionMode } from "./execution-mode.js";
import { writeBlockerSummary } from "./blocker-summary.js";
import { readProviderCapabilitySnapshot, writeProviderCapabilitySnapshot, writeProviderDispatchReceipt } from "./provider-evidence.js";
import { isRuntimeRole, normalizeRuntimeRole } from "./role-registry.js";
import { validateAgentSkills } from "./skill-registry.js";
import { appendRuntimeTraceEvent } from "./trace-events.js";

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
  actionId?: string;
  dispatchContractId?: string;
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
  executionType?: "native_agent_run";
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
    consistency: string;
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
  next_action?: unknown[];
  agent_runs?: AgentRun[];
  completion_preconditions?: {
    provider_receipts_complete?: boolean;
    handoffs_valid?: boolean;
    final_gates_pass?: boolean;
    true_harness_evidence_pass?: boolean;
    commit_push_archive_policy_satisfied?: boolean;
  };
}

type JsonObject = Record<string, unknown>;

type ParallelExecutionWaveStatus = "waiting_for_agent_output" | "dispatched" | "completed" | "blocked" | "failed";

interface ParallelExecutionWave {
  iteration: number;
  parallel_group: string;
  action_ids: string[];
  task_ids: string[];
  roles: string[];
  status: ParallelExecutionWaveStatus;
  reason: string;
  started_at: string;
  completed_at?: string;
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
  const role = typeof value.role === "string" ? value.role : "";
  if (kind === "agent" && role && !isRuntimeRole(role)) errors.push(`${pathName}.role is not a supported runtime agent role: ${role}`);
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
  const role = stringField(value, "role", pathName, errors);
  if (role && !isRuntimeRole(role)) errors.push(`${pathName}.role is not a supported runtime role: ${role}`);
  optionalStringField(value, "taskId", pathName, errors);
  optionalStringField(value, "workflowState", pathName, errors);
  const status = stringField(value, "status", pathName, errors);
  if (status && !["ready", "waiting", "planned", "completed"].includes(status)) {
    errors.push(`${pathName}.status must be ready, waiting, planned, or completed`);
  }
  const skills = stringArrayField(value, "skills", pathName, errors);
  if (role) errors.push(...validateAgentSkills(role, skills).map((error) => `${pathName}.${error}`));
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

function normalizeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeRoleOrOriginal(role: unknown): string {
  if (typeof role !== "string") return "";
  return normalizeRuntimeRole(role) || role;
}

function normalizeAction(value: unknown): unknown {
  if (!isObject(value)) return value;
  const role = normalizeRoleOrOriginal(value.role);
  const id = typeof value.id === "string" && value.id.trim() ? value.id : role ? `agent-${role}` : "";
  const description = typeof value.description === "string" ? value.description : undefined;
  return {
    ...value,
    id,
    kind: typeof value.kind === "string" ? value.kind : "agent",
    status: value.status === "completed" ? "done" : value.status || "ready",
    role,
    reason: typeof value.reason === "string" && value.reason.trim() ? value.reason : description || "orchestrator declared action",
    inputs: normalizeArray(value.inputs),
    outputs: normalizeArray(value.outputs),
    dependsOn: normalizeArray(value.dependsOn),
    parallelGroup: typeof value.parallelGroup === "string" && value.parallelGroup.trim() ? value.parallelGroup : role || "default"
  };
}

function normalizeAgentRun(value: unknown): unknown {
  if (!isObject(value)) return value;
  const role = normalizeRoleOrOriginal(value.role);
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id
    : typeof value.taskId === "string" && value.taskId.trim()
      ? value.taskId
      : role || "";
  return {
    ...value,
    id,
    role,
    status: value.status === "done" ? "completed" : value.status || "planned",
    skills: normalizeArray(value.skills),
    inputs: normalizeArray(value.inputs),
    outputs: normalizeArray(value.outputs),
    readScope: normalizeArray(value.readScope),
    writeScope: normalizeArray(value.writeScope),
    dependsOn: normalizeArray(value.dependsOn),
    parallelGroup: typeof value.parallelGroup === "string" && value.parallelGroup.trim() ? value.parallelGroup : role || "default"
  };
}

function normalizeSession(session: AgentAuthoredSession): { session: AgentAuthoredSession; changed: boolean } {
  const sourceActions = Array.isArray(session.next_actions)
    ? session.next_actions
    : Array.isArray(session.next_action)
      ? session.next_action
      : [];
  const normalized = {
    ...session,
    schema_version: session.schema_version || 1,
    next_actions: sourceActions.map(normalizeAction) as OrchestrationAction[],
    agent_runs: (Array.isArray(session.agent_runs) ? session.agent_runs : []).map(normalizeAgentRun) as AgentRun[]
  };
  delete normalized.next_action;
  return {
    session: normalized,
    changed: JSON.stringify(normalized) !== JSON.stringify(session)
  };
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
  if (session.status === "completed") {
    const preconditions = session.completion_preconditions;
    const required = [
      "provider_receipts_complete",
      "handoffs_valid",
      "final_gates_pass",
      "true_harness_evidence_pass",
      "commit_push_archive_policy_satisfied"
    ] as const;
    if (!preconditions) {
      errors.push("completion_preconditions is required when status is completed");
    } else {
      for (const field of required) {
        if (preconditions[field] !== true) errors.push(`completion_preconditions.${field} must be true when status is completed`);
      }
    }
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

function relativeToCwd(cwd: string, file: string): string {
  return path.isAbsolute(file) ? path.relative(cwd, file) : file;
}

function writeAgentNameMap(cwd: string, runId: string, runDirPath: string, agents: AgentRun[], actions: OrchestrationAction[], dispatchContracts: DispatchContract[]): string {
  const file = path.join(runDirPath, "orchestration", "agent-name-map.json");
  const mappings = agents.map((agent) => {
    const action = actions.find((item) => item.kind === "agent" && actionMatchesAgent(item, agent));
    const contract = dispatchContracts.find((item) => item.kind === "agent" && agentRunMatchesContract(agent, item));
    const actionId = agent.actionId || contract?.action_id || action?.id || `agent-${agent.id}`;
    const handoffPath = relativeToCwd(cwd, agent.handoffFile || contract?.expected_handoff_path || path.join(runDirPath, "agents", agent.id, "handoff.json"));
    const expectedOutput = relativeToCwd(cwd, contract?.expected_handoff_path || agent.outputs[0] || agent.handoffFile || path.join(runDirPath, "agents", agent.id, "handoff.json"));
    const receiptPath = relativeToCwd(cwd, contract?.expected_provider_receipt_path || path.join(runDirPath, "orchestration", "provider-receipts", `${actionId.replace(/[^a-zA-Z0-9_.-]+/g, "-")}.json`));
    return {
      provider_display_name: agent.instanceId || agent.id,
      action_id: actionId,
      agent_id: agent.id,
      dispatch_contract_id: agent.dispatchContractId || contract?.id || agent.id,
      role: agent.role,
      task_id: agent.taskId || null,
      parallel_group: agent.parallelGroup,
      started_at: agent.startedAt || null,
      expected_output: expectedOutput,
      handoff_path: handoffPath,
      provider_receipt_path: receiptPath,
      gate_ids: ["dispatch", "true_harness", agent.role === "qa" ? "qa" : agent.role === "reviewer" ? "review" : "recheck_fix_loop"]
    };
  });
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    mappings
  }, null, 2)}\n`);
  return file;
}

function writeOrchestratorRuntimeConsistency(file: string, runId: string, result: Omit<OrchestratorResult, "files">, dispatchContracts: DispatchContract[]): void {
  const blockers: string[] = [];
  if (result.nextActions.length > 0 && dispatchContracts.length === 0) blockers.push("session_actions_not_materialized");
  if (result.agentRuns.length > 0 && dispatchContracts.filter((contract) => contract.kind === "agent").length === 0) blockers.push("agent_runs_not_materialized");
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    status: blockers.length > 0 ? "blocked" : "pass",
    session_action_count: result.nextActions.length,
    session_agent_run_count: result.agentRuns.length,
    dispatch_contract_count: dispatchContracts.length,
    agent_dispatch_contract_count: dispatchContracts.filter((contract) => contract.kind === "agent").length,
    runtime_dispatch_contract_count: dispatchContracts.filter((contract) => contract.kind === "runtime").length,
    blockers
  }, null, 2)}\n`);
}

function actionIdsForContract(contract: DispatchContract): string[] {
  return [
    contract.action_id,
    contract.id,
    `agent-${contract.id}`,
    `agent-${contract.role}`,
    contract.task_id ? `agent-${contract.role}-${contract.task_id}` : undefined
  ].filter((item): item is string => Boolean(item));
}

function waveContainsContract(wave: unknown, contract: DispatchContract, status?: ParallelExecutionWaveStatus): boolean {
  if (!isObject(wave)) return false;
  if (status && wave.status !== status) return false;
  if (!Array.isArray(wave.action_ids)) return false;
  const actionIds = new Set(wave.action_ids.filter((item): item is string => typeof item === "string"));
  return actionIdsForContract(contract).some((id) => actionIds.has(id));
}

function waveStatusForContract(contract: DispatchContract): ParallelExecutionWaveStatus {
  if (contract.status === "done") return "completed";
  if (contract.status === "blocked") return "blocked";
  return "waiting_for_agent_output";
}

function materializeWaveHistory(existingExecution: { wave_history?: unknown[]; executed_parallel_groups?: string[]; blocked_parallel_groups?: string[] } | null, dispatchContracts: DispatchContract[]): {
  executed_parallel_groups: string[];
  blocked_parallel_groups: string[];
  wave_history: unknown[];
} {
  const waveHistory = Array.isArray(existingExecution?.wave_history) ? [...existingExecution.wave_history] : [];
  const executed = new Set(Array.isArray(existingExecution?.executed_parallel_groups) ? existingExecution.executed_parallel_groups : []);
  const blocked = new Set(Array.isArray(existingExecution?.blocked_parallel_groups) ? existingExecution.blocked_parallel_groups : []);
  const now = new Date().toISOString();
  const addWave = (contract: DispatchContract, status: ParallelExecutionWaveStatus, reason: string): void => {
    const wave: ParallelExecutionWave = {
      iteration: waveHistory.length + 1,
      parallel_group: contract.parallel_group,
      action_ids: [contract.action_id],
      task_ids: contract.task_id ? [contract.task_id] : [],
      roles: [contract.role],
      status,
      reason,
      started_at: now
    };
    if (status === "completed" || status === "blocked" || status === "failed") wave.completed_at = now;
    waveHistory.push(wave);
  };

  for (const contract of dispatchContracts) {
    if (!waveHistory.some((wave) => waveContainsContract(wave, contract))) {
      addWave(contract, "waiting_for_agent_output", `runtime materialized dispatch start for ${contract.action_id}`);
    }
    const status = waveStatusForContract(contract);
    if ((status === "completed" || status === "blocked") && !waveHistory.some((wave) => waveContainsContract(wave, contract, status))) {
      addWave(contract, status, `orchestrator session declared ${contract.action_id} ${contract.status}`);
    }
    if (status === "completed") {
      executed.add(contract.parallel_group);
      blocked.delete(contract.parallel_group);
    }
    if (status === "blocked") blocked.add(contract.parallel_group);
  }

  return {
    executed_parallel_groups: Array.from(executed).sort(),
    blocked_parallel_groups: Array.from(blocked).sort(),
    wave_history: waveHistory
  };
}

function agentRunMatchesContract(agent: AgentRun, contract: DispatchContract): boolean {
  return agent.id === contract.id
    || agent.actionId === contract.action_id
    || (agent.role === contract.role && (agent.taskId || "") === (contract.task_id || ""));
}

function adoptValidatedHandoffs(result: Omit<OrchestratorResult, "files">, dispatchContracts: DispatchContract[], runDirPath: string, runId: string): AgentRun[] {
  const agents = [...result.agentRuns];
  for (const contract of dispatchContracts.filter((item) => item.kind === "agent")) {
    const validation = validateAgentHandoff({
      id: contract.id,
      role: contract.role,
      taskId: contract.task_id,
      handoffFile: contract.expected_handoff_path || undefined
    }, runDirPath, runId);
    if (!validation.passed || !validation.file) continue;
    const existing = agents.find((agent) => agentRunMatchesContract(agent, contract));
    if (existing) {
      existing.status = "completed";
      existing.executionSource = "true_harness";
      existing.executedBy = "native_agent";
      existing.executionStatus = "completed";
      existing.handoffFile = validation.file;
      existing.actionId = contract.action_id;
      existing.dispatchContractId = contract.id;
      existing.completedAt = existing.completedAt || new Date().toISOString();
      continue;
    }
    agents.push({
      id: path.basename(path.dirname(validation.file)),
      actionId: contract.action_id,
      dispatchContractId: contract.id,
      role: contract.role,
      taskId: contract.task_id,
      workflowState: contract.workflow_state,
      status: "completed",
      executionSource: "true_harness",
      executedBy: "native_agent",
      executionStatus: "completed",
      outputDir: path.dirname(validation.file),
      handoffFile: validation.file,
      completedAt: new Date().toISOString(),
      executionType: "native_agent_run",
      skills: contract.skills,
      inputs: contract.inputs,
      outputs: contract.required_outputs,
      readScope: contract.read_scope,
      writeScope: contract.write_scope,
      dependsOn: contract.depends_on,
      parallelGroup: contract.parallel_group
    });
  }
  return agents;
}

function completeContractsWithAdoptedHandoffs(dispatchContracts: DispatchContract[], agentRuns: AgentRun[]): DispatchContract[] {
  return dispatchContracts.map((contract) => {
    if (contract.kind !== "agent") return contract;
    const adopted = agentRuns.some((agent) => agentRunMatchesContract(agent, contract)
      && agent.status === "completed"
      && agent.executionStatus === "completed"
      && typeof agent.handoffFile === "string"
      && agent.handoffFile.length > 0);
    return adopted ? { ...contract, status: "done" as const } : contract;
  });
}

function persist(cwd: string, runId: string, result: Omit<OrchestratorResult, "files">, options: { writeHarnessEvidence?: boolean } = {}): OrchestratorResult {
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
    consistency: path.join(orchestrationDir, "orchestrator-runtime-consistency.json"),
    timeline: path.join(orchestrationDir, "auto-timeline.md")
  };
  const initialDispatchContracts = exists(files.session) && result.nextActions.length > 0
    ? buildDispatchContracts(runId, runDirPath, files.session)
    : [];
  const adoptedAgentRuns = adoptValidatedHandoffs(result, initialDispatchContracts, runDirPath, runId);
  const dispatchContracts = completeContractsWithAdoptedHandoffs(initialDispatchContracts, adoptedAgentRuns);
  for (const contract of dispatchContracts.filter((item) => item.kind === "agent" && (item.status === "ready" || item.status === "waiting"))) {
    writeProviderDispatchReceipt(cwd, runId, {
      actionId: contract.action_id,
      agentId: contract.id,
      role: contract.role,
      taskId: contract.task_id,
      parallelGroup: contract.parallel_group,
      metadata: {
        dispatch_contract_id: contract.id,
        ready_reason: contract.ready_reason,
        required_outputs: contract.required_outputs
      }
    });
  }
  const actionable = result.nextActions.filter((action) => action.status !== "done");
  const existingExecution = optionalJson<{ wave_history?: unknown[]; executed_parallel_groups?: string[]; blocked_parallel_groups?: string[] }>(files.parallelExecution);
  const execution = materializeWaveHistory(existingExecution, dispatchContracts);

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
    executed_parallel_groups: execution.executed_parallel_groups,
    blocked_parallel_groups: execution.blocked_parallel_groups,
    wave_history: execution.wave_history
  }, null, 2)}\n`);
  writeTimeline(files.timeline, result);
  writeAgentNameMap(cwd, runId, runDirPath, adoptedAgentRuns, result.nextActions, dispatchContracts);
  const nativeAgents = adoptedAgentRuns.map((agent) => ({
    ...agent,
    executionType: "native_agent_run" as const
  }));
  const runtimeGates = result.nextActions
    .filter((action) => action.kind === "runtime")
    .map((action) => ({
      id: action.id,
      role: action.role,
      action_id: action.id,
      status: action.status,
      executionType: action.role === "orchestrator" ? "orchestrator_gate" : "runtime_gate",
      command: action.command,
      inputs: action.inputs,
      outputs: action.outputs,
      dependsOn: action.dependsOn,
      parallelGroup: action.parallelGroup
    }));
  writeText(files.agentRuns, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    agents: nativeAgents,
    runtime_gates: runtimeGates,
    execution_units: [...nativeAgents, ...runtimeGates]
  }, null, 2)}\n`);
  writeOrchestratorRuntimeConsistency(files.consistency, runId, { ...result, agentRuns: adoptedAgentRuns }, dispatchContracts);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.orchestrator",
    componentId: "runtime.ingest-orchestrator-session",
    actionId: "runtime.ingest_orchestrator_session",
    eventType: "ingest",
    status: result.status === "blocked" ? "blocked" : "recorded",
    reason: `orchestrator status=${result.status}; actions=${result.nextActions.length}; agents=${adoptedAgentRuns.length}`,
    inputArtifacts: [files.session],
    outputArtifacts: [
      files.state,
      files.queue,
      files.agentRuns,
      files.dispatchContracts,
      files.parallelPlan,
      files.parallelExecution,
      files.consistency,
      files.timeline
    ]
  });
  if (options.writeHarnessEvidence !== false) writeTrueHarnessEvidence(cwd, runId);
  return { ...result, agentRuns: adoptedAgentRuns, dispatchContracts, files };
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

function readRunStatus(cwd: string, runId: string): RunState {
  return normalizeRunState(readJson<RunMetadata>(path.join(runDir(cwd, runId), "run.json")).status);
}

function completedSnapshot(cwd: string, runId: string, mode: OrchestratorResult["mode"]): OrchestratorResult {
  const runDirPath = runDir(cwd, runId);
  const orchestrationDir = path.join(runDirPath, "orchestration");
  const files = {
    session: path.join(orchestrationDir, "orchestrator-session.json"),
    state: path.join(orchestrationDir, "state.json"),
    queue: path.join(orchestrationDir, "queue.json"),
    agentRuns: path.join(orchestrationDir, "agent-runs.json"),
    dispatchContracts: path.join(orchestrationDir, "dispatch-contracts.json"),
    parallelPlan: path.join(orchestrationDir, "parallel-plan.json"),
    parallelExecution: path.join(orchestrationDir, "parallel-execution.json"),
    consistency: path.join(orchestrationDir, "orchestrator-runtime-consistency.json"),
    timeline: path.join(orchestrationDir, "auto-timeline.md")
  };
  const session = optionalJson<AgentAuthoredSession>(files.session);
  const agents = optionalJson<{ agents?: AgentRun[] }>(files.agentRuns);
  const dispatch = optionalJson<{ contracts?: DispatchContract[] }>(files.dispatchContracts);
  return {
    runId,
    runDir: runDirPath,
    mode,
    status: "completed",
    executionMode: "true_harness",
    nextActions: Array.isArray(session?.next_actions) ? session.next_actions : [],
    agentRuns: Array.isArray(agents?.agents) ? agents.agents : [],
    dispatchContracts: Array.isArray(dispatch?.contracts) ? dispatch.contracts : [],
    parallelGroups: Array.isArray(session?.next_actions) ? groupActions(session.next_actions) : [],
    files
  };
}

function readOnlySnapshot(cwd: string, runId: string, mode: OrchestratorResult["mode"]): OrchestratorResult {
  const runDirPath = runDir(cwd, runId);
  const orchestrationDir = path.join(runDirPath, "orchestration");
  const files = {
    session: path.join(orchestrationDir, "orchestrator-session.json"),
    state: path.join(orchestrationDir, "state.json"),
    queue: path.join(orchestrationDir, "queue.json"),
    agentRuns: path.join(orchestrationDir, "agent-runs.json"),
    dispatchContracts: path.join(orchestrationDir, "dispatch-contracts.json"),
    parallelPlan: path.join(orchestrationDir, "parallel-plan.json"),
    parallelExecution: path.join(orchestrationDir, "parallel-execution.json"),
    consistency: path.join(orchestrationDir, "orchestrator-runtime-consistency.json"),
    timeline: path.join(orchestrationDir, "auto-timeline.md")
  };
  const session = optionalJson<AgentAuthoredSession>(files.session);
  const agents = optionalJson<{ agents?: AgentRun[] }>(files.agentRuns);
  const dispatch = optionalJson<{ contracts?: DispatchContract[] }>(files.dispatchContracts);
  const nextActions = Array.isArray(session?.next_actions) ? session.next_actions : [];
  const sessionAgents = Array.isArray(session?.agent_runs) ? session.agent_runs : [];
  const virtualDispatchContracts = fs.existsSync(files.session) && nextActions.length > 0 && sessionAgents.length > 0
    ? buildDispatchContracts(runId, runDirPath, files.session)
    : [];
  const currentStatus = readRunStatus(cwd, runId);
  const sessionStatus = typeof session?.status === "string" && isRunState(session.status) ? session.status : currentStatus;
  const status = currentStatus === "completed" || currentStatus === "blocked" ? currentStatus : sessionStatus;
  return {
    runId,
    runDir: runDirPath,
    mode,
    status,
    executionMode: "true_harness",
    nextActions,
    agentRuns: Array.isArray(agents?.agents) ? agents.agents : sessionAgents,
    dispatchContracts: Array.isArray(dispatch?.contracts) ? dispatch.contracts : virtualDispatchContracts,
    parallelGroups: nextActions.length > 0 ? groupActions(nextActions) : [],
    files
  };
}

function buildSessionDrivenDecision(cwd: string, runId: string, mode: OrchestratorResult["mode"]): Omit<OrchestratorResult, "files"> {
  const runDirPath = runDir(cwd, runId);
  const currentMetadata = readJson<RunMetadata>(path.join(runDirPath, "run.json"));
  const currentNormalizedStatus = normalizeRunState(currentMetadata.status);
  const sessionFile = path.join(runDirPath, "orchestration", "orchestrator-session.json");
  if (currentNormalizedStatus === "completed" && !exists(sessionFile)) {
    return {
      runId,
      runDir: runDirPath,
      mode,
      status: "completed",
      executionMode: "true_harness",
      nextActions: [],
      agentRuns: [],
      dispatchContracts: [],
      parallelGroups: []
    };
  }
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

  readProviderCapabilitySnapshot(cwd, runId) || writeProviderCapabilitySnapshot(cwd, runId);

  const rawSession = readJson<AgentAuthoredSession>(sessionFile);
  const normalized = normalizeSession(rawSession);
  const session = normalized.session;
  if (normalized.changed) {
    writeText(path.join(runDirPath, "orchestration", "orchestrator-session.normalization.json"), `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      status: "normalized",
      normalized_at: new Date().toISOString(),
      source_file: sessionFile
    }, null, 2)}\n`);
    writeText(sessionFile, `${JSON.stringify(session, null, 2)}\n`);
  }
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
    writeBlockerSummary(cwd, runId);
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

  const currentStatus = currentNormalizedStatus;
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
    writeBlockerSummary(cwd, runId);
    return {
      runId,
      runDir: runDirPath,
      mode,
      status: "blocked",
      executionMode: "true_harness",
      nextActions,
      agentRuns,
      dispatchContracts: [],
      parallelGroups: groupActions(nextActions)
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
  if (mode === "resume") return readOnlySnapshot(cwd, runId, mode);
  if (readRunStatus(cwd, runId) === "completed") return completedSnapshot(cwd, runId, mode);
  if (!exists(sessionFile)) return waitingForOrchestratorDecision(cwd, runId, mode);
  return persist(cwd, runId, buildSessionDrivenDecision(cwd, runId, mode));
}

export function ingestOrchestratorSession(cwd: string, runId: string, options: { writeHarnessEvidence?: boolean } = {}): OrchestratorResult {
  const status = readRunStatus(cwd, runId);
  if (status === "completed") return completedSnapshot(cwd, runId, "orchestrate");
  const sessionFile = path.join(runDir(cwd, runId), "orchestration", "orchestrator-session.json");
  if (!exists(sessionFile)) return readOnlySnapshot(cwd, runId, "orchestrate");
  return persist(cwd, runId, buildSessionDrivenDecision(cwd, runId, "orchestrate"), options);
}

export function resumeRun(cwd: string, runId: string): OrchestratorResult {
  return orchestrateRun(cwd, runId, "resume");
}
