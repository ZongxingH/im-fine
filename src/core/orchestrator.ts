import fs from "node:fs";
import path from "node:path";
import { buildDispatchContracts, type DispatchContract } from "./dispatch.js";
import { dependencyInstallRequired } from "./dependencies.js";
import { detectTrueHarnessCapability, doctor } from "./doctor.js";
import { materializeFixLoopPattern, readFixLoopDesignReworkState, readFixLoopRoleActionState } from "./fix-loop.js";
import { ensureDir, writeText } from "./fs.js";
import { validateTaskGraph, type TaskGraph, type TaskGraphTask } from "./plan.js";
import { isActionCompleted } from "./reliability.js";
import { normalizeRunState, transitionRunState, type RunState } from "./state-machine.js";
import { writeTrueHarnessEvidence } from "./true-harness-evidence.js";
import { workflowState } from "./workflows.js";

export type OrchestrationActionKind = "runtime" | "agent" | "gate";
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
  executionStatus?: "unprepared" | "prepared" | "waiting_for_model" | "executed" | "failed" | "completed";
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
  nextActions: OrchestrationAction[];
  agentRuns: AgentRun[];
  dispatchContracts: DispatchContract[];
  parallelGroups: ParallelGroup[];
  files: {
    state: string;
    queue: string;
    infrastructureGate: string;
    agentRuns: string;
    dispatchContracts: string;
    parallelPlan: string;
    timeline: string;
  };
}

interface RunMetadata {
  run_id: string;
  status?: string;
  project_kind?: string;
  push_status?: string;
  commit_hashes?: string[];
  archive_status?: string;
}

interface WorktreeIndex {
  run_worktree?: string;
  tasks?: Array<{ task_id: string; path: string }>;
}

interface AgentStatus {
  status?: string;
  validation?: {
    passed?: boolean;
  };
}

interface ExecutionMetadata {
  agent_id?: string;
  status?: string;
  prepared_at?: string;
  updated_at?: string;
  started_at?: string;
  completed_at?: string;
  output_dir?: string;
}

interface DoctorLikeCheck {
  id: string;
  label: string;
  status: string;
  detail: string;
}

interface ParallelPlanEvidence {
  serialReason: string | null;
  replanRecommended: boolean;
  parallelismBlockedBy: "none" | "task_graph" | "boundary_conflict" | "provider_capability";
}

interface ExistingProjectNoTaskGraphWorkflow {
  discovery_roles: string[];
  planning_roles: string[];
  planning_runtime_action: string;
  parallel_groups: {
    discovery: string;
    planning: string;
    planning_finalize: string;
  };
}

interface NewProjectWaitingWorkflow {
  roles: Record<string, {
    status: "ready" | "waiting";
    action_id: string;
    parallel_group: string;
    depends_on?: string[];
    skills: string[];
    allowed_transitions: string[];
    ready_reason?: string;
    blocked_reason?: string;
  }>;
  notes: string[];
}

interface ExistingProjectActiveDeliveryWorkflow {
  task_pipeline: {
    states: {
      implementation_ready: {
        roles: string[];
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
      implementation_waiting: {
        roles: string[];
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
      implementation_done: {
        roles: string[];
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
      qa_ready: {
        role: string;
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
      qa_waiting: {
        role: string;
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
      qa_done: {
        role: string;
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
      review_ready: {
        role: string;
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
      review_waiting: {
        role: string;
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
      review_done: {
        role: string;
        action_id_pattern: string;
        parallel_group_pattern: string;
        reason: string;
      };
    };
  };
  risk_review_role: string;
  risk_review_parallel_group: string;
  risk_review_reason: string;
}

type TaskPipelineConfig = ExistingProjectActiveDeliveryWorkflow["task_pipeline"];
type TaskPipelineWorkflowState =
  | "implementation_ready"
  | "implementation_waiting"
  | "implementation_done"
  | "qa_ready"
  | "qa_waiting"
  | "qa_done"
  | "review_ready"
  | "review_waiting"
  | "review_done";

interface TaskPipelineMaterialized {
  workflowState: TaskPipelineWorkflowState;
  role: string;
  actionId: string;
  parallelGroup: string;
  reason: string;
}

interface ExistingProjectReadyToCommitWorkflow {
  review_role: string;
  review_action_id: string;
  runtime_action_id: string;
  parallel_group: string;
  review_reason: string;
  runtime_reason: string;
}

interface ExistingProjectReadyToPushWorkflow {
  runtime_action_id: string;
  parallel_group: string;
  runtime_reason: string;
  depends_on: string[];
}

interface ExistingProjectReadyToArchiveWorkflow {
  roles: string[];
  parallel_group: string;
  depends_on: string[];
  technical_writer_action_id: string;
  project_knowledge_action_id: string;
  archive_action_id: string;
  technical_writer_reason: string;
  project_knowledge_reason: string;
  archive_reason: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function optionalJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return readJson<T>(file);
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function exists(file: string): boolean {
  return fs.existsSync(file);
}

function agentStatus(runDirPath: string, agentId: string): AgentStatus | null {
  return optionalJson<AgentStatus>(path.join(runDirPath, "agents", agentId, "status.json"));
}

function executionMetadata(runDirPath: string, agentId: string): ExecutionMetadata | null {
  return optionalJson<ExecutionMetadata>(path.join(runDirPath, "agents", agentId, "execution", "execution-status.json"))
    || optionalJson<ExecutionMetadata>(path.join(runDirPath, "agents", agentId, "execution", "execution.json"));
}

function executionLifecycle(runDirPath: string, agentId: string): Pick<AgentRun, "instanceId" | "executionStatus" | "outputDir" | "handoffFile" | "preparedAt" | "startedAt" | "completedAt"> {
  const metadata = executionMetadata(runDirPath, agentId);
  const handoff = path.join(runDirPath, "agents", agentId, "handoff.json");
  const handoffFile = exists(handoff) ? handoff : undefined;
  const normalizedStatus = metadata?.status === "dry_run"
    ? "waiting_for_model"
    : metadata?.status === "prepared"
      ? "prepared"
      : metadata?.status === "started"
        ? "prepared"
      : metadata?.status === "executed"
        ? handoffFile ? "completed" : "executed"
        : metadata?.status === "failed"
          ? "failed"
          : metadata?.prepared_at
            ? "prepared"
            : "unprepared";
  return {
    instanceId: metadata?.agent_id || agentId,
    executionStatus: normalizedStatus,
    outputDir: metadata?.output_dir,
    handoffFile,
    preparedAt: metadata?.prepared_at,
    startedAt: metadata?.started_at,
    completedAt: metadata?.completed_at || metadata?.updated_at
  };
}

function patchFile(runDirPath: string, taskId: string): string {
  return path.join(runDirPath, "agents", taskId, "patch.diff");
}

function patchReady(runDirPath: string, taskId: string): boolean {
  const status = agentStatus(runDirPath, taskId);
  return exists(patchFile(runDirPath, taskId))
    && status?.status === "patch_validated"
    && status.validation?.passed === true;
}

function qaPassed(runDirPath: string, taskId: string): boolean {
  return agentStatus(runDirPath, `qa-${taskId}`)?.status === "pass";
}

function reviewApproved(runDirPath: string, taskId: string): boolean {
  return agentStatus(runDirPath, `reviewer-${taskId}`)?.status === "approved";
}

function taskCommitted(runDirPath: string, taskId: string): boolean {
  const taskStatus = optionalJson<{ status?: string; commit_hash?: string }>(path.join(runDirPath, "tasks", taskId, "status.json"));
  return taskStatus?.status === "committed" || typeof taskStatus?.commit_hash === "string";
}

function taskRoleStatus(runDirPath: string, task: TaskGraphTask, role: string, dependenciesReady: boolean): "ready" | "waiting" | "completed" {
  if (role === "qa") {
    if (qaPassed(runDirPath, task.id)) return "completed";
    return patchReady(runDirPath, task.id) ? "ready" : "waiting";
  }
  if (role === "reviewer") {
    if (reviewApproved(runDirPath, task.id)) return "completed";
    return qaPassed(runDirPath, task.id) ? "ready" : "waiting";
  }
  if (patchReady(runDirPath, task.id)) return "completed";
  return dependenciesReady ? "ready" : "waiting";
}

function runLevelAgentStatus(runDirPath: string, role: string, readyWhenTrue: boolean): "ready" | "waiting" | "completed" {
  const handoffFile = path.join(runDirPath, "agents", role, "handoff.json");
  const statusFile = path.join(runDirPath, "agents", role, "status.json");
  if (exists(handoffFile) || exists(statusFile)) return "completed";
  return readyWhenTrue ? "ready" : "waiting";
}

function taskStatus(runDirPath: string, taskId: string): string | undefined {
  return optionalJson<{ status?: string }>(path.join(runDirPath, "tasks", taskId, "status.json"))?.status;
}

function tasksWithStatus(graph: TaskGraph, runDirPath: string, status: string): TaskGraphTask[] {
  return graph.tasks.filter((task) => taskStatus(runDirPath, task.id) === status);
}

function hasPendingFixTask(graph: TaskGraph, runDirPath: string, taskId: string): boolean {
  const prefix = `FIX-${taskId}-`;
  return graph.tasks.some((task) => task.id.startsWith(prefix) && !taskCommitted(runDirPath, task.id) && !reviewApproved(runDirPath, task.id));
}

function dependencySatisfiedForFix(runDirPath: string, taskId: string): boolean {
  const status = taskStatus(runDirPath, taskId);
  return status === "qa_failed" || status === "review_changes_requested" || status === "needs_dev_fix";
}

function dependencyReady(runDirPath: string, task: TaskGraphTask): boolean {
  const isFixTask = task.id.startsWith("FIX-");
  return task.depends_on.every((dep) => taskCommitted(runDirPath, dep) || reviewApproved(runDirPath, dep) || isFixTask && dependencySatisfiedForFix(runDirPath, dep));
}

function roleForTask(task: TaskGraphTask): string {
  if (task.type === "docs") return "technical-writer";
  return task.type;
}

function skillsForRole(role: string): string[] {
  if (role === "qa") return ["tdd", "systematic-debugging"];
  if (role === "reviewer") return ["code-review"];
  if (role === "archive") return ["archive-confirmation"];
  if (role === "intake") return ["clarify"];
  if (role === "project-analyzer") return ["project-analysis"];
  if (role === "product-planner") return ["clarify", "write-delivery-plan"];
  if (role === "risk-reviewer") return ["code-review", "parallel-agent-dispatch"];
  if (role === "project-knowledge-updater") return ["archive-confirmation"];
  if (role === "committer") return ["execute-task-plan", "code-review"];
  if (role === "technical-writer") return ["execute-task-plan"];
  if (role === "conflict-resolver") return ["systematic-debugging", "execute-task-plan", "code-review"];
  return ["execute-task-plan", "tdd", "systematic-debugging"];
}

function makeRunLevelAgent(cwd: string, runDirPath: string, runId: string, role: string, status: AgentRun["status"], parallelGroup: string, outputs: string[]): AgentRun {
  const lifecycle = executionLifecycle(runDirPath, role);
  return {
    id: role,
    ...lifecycle,
    role,
    status,
    skills: skillsForRole(role),
    inputs: [
      rel(cwd, path.join(runDirPath, "request", "normalized.md")),
      rel(cwd, path.join(runDirPath, "analysis", "project-context.md")),
      rel(cwd, path.join(runDirPath, "orchestration", "context.json")),
      rel(cwd, path.join(runDirPath, "planning", "task-graph.json"))
    ],
    outputs: outputs.map((file) => rel(cwd, file)),
    readScope: [`.imfine/runs/${runId}/**`, ".imfine/project/**"],
    writeScope: outputs.map((file) => rel(cwd, file)),
    dependsOn: [],
    parallelGroup
  };
}

function makeAgentRun(
  cwd: string,
  runDirPath: string,
  task: TaskGraphTask,
  role: string,
  status: AgentRun["status"],
  parallelGroup: string,
  workflowState?: TaskPipelineWorkflowState
): AgentRun {
  const id = role === "dev" || role === "technical-writer" ? task.id : `${role}-${task.id}`;
  const lifecycle = executionLifecycle(runDirPath, id);
  return {
    id,
    ...lifecycle,
    role,
    taskId: task.id,
    workflowState,
    status,
    skills: skillsForRole(role),
    inputs: [
      rel(cwd, path.join(runDirPath, "request", "normalized.md")),
      rel(cwd, path.join(runDirPath, "orchestration", "context.json")),
      rel(cwd, path.join(runDirPath, "tasks", task.id, "task.md")),
      rel(cwd, path.join(runDirPath, "agents", task.id, "input.md"))
    ],
    outputs: role === "qa"
      ? [rel(cwd, path.join(runDirPath, "agents", `qa-${task.id}`, "handoff.json"))]
      : role === "reviewer"
        ? [rel(cwd, path.join(runDirPath, "agents", `reviewer-${task.id}`, "handoff.json"))]
        : [rel(cwd, path.join(runDirPath, "agents", task.id, "patch.diff"))],
    readScope: task.read_scope,
    writeScope: role === "qa" || role === "reviewer" ? [] : task.write_scope,
    dependsOn: task.depends_on,
    parallelGroup
  };
}

function makeNamedAgentRun(
  cwd: string,
  runDirPath: string,
  runId: string,
  agentId: string,
  role: string,
  status: AgentRun["status"],
  parallelGroup: string,
  inputs: string[],
  outputs: string[],
  dependsOn: string[] = [],
  workflowState?: string,
  skillsOverride?: string[]
): AgentRun {
  const lifecycle = executionLifecycle(runDirPath, agentId);
  return {
    id: agentId,
    ...lifecycle,
    role,
    workflowState,
    status,
    skills: skillsOverride || skillsForRole(role),
    inputs,
    outputs,
    readScope: [`.imfine/runs/${runId}/**`, ".imfine/project/**"],
    writeScope: outputs,
    dependsOn,
    parallelGroup
  };
}

function taskLayer(graph: TaskGraph, task: TaskGraphTask): number {
  const tasksById = new Map(graph.tasks.map((item) => [item.id, item]));
  const seen = new Set<string>();

  function depth(current: TaskGraphTask): number {
    if (seen.has(current.id)) return 0;
    seen.add(current.id);
    if (current.depends_on.length === 0) return 0;
    return 1 + Math.max(...current.depends_on.map((dep) => {
      const depTask = tasksById.get(dep);
      return depTask ? depth(depTask) : 0;
    }));
  }

  return depth(task);
}

function createAction(
  cwd: string,
  runDirPath: string,
  action: Omit<OrchestrationAction, "inputs" | "outputs"> & { inputs?: string[]; outputs?: string[] }
): OrchestrationAction {
  return {
    ...action,
    inputs: action.inputs || [rel(cwd, path.join(runDirPath, "run.json"))],
    outputs: action.outputs || []
  };
}

function writeInfrastructureEvidence(cwd: string, runId: string, runDirPath: string, checks: DoctorLikeCheck[]): string {
  const file = path.join(runDirPath, "evidence", "infrastructure.md");
  const blockers = checks.filter((item) => item.status === "fail");
  const warnings = checks.filter((item) => item.status === "warn");
  writeText(file, `# Infrastructure Gate Evidence

## Status

- blockers: ${blockers.length}
- warnings: ${warnings.length}

## Blockers

${blockers.length > 0 ? blockers.map((item) => `- ${item.id}: ${item.detail}`).join("\n") : "- none"}

## Warnings

${warnings.length > 0 ? warnings.map((item) => `- ${item.id}: ${item.detail}`).join("\n") : "- none"}

## User Follow-Up

${blockers.length > 0 ? blockers.map((item) => `- Resolve ${item.label}: ${item.detail}`).join("\n") : "- none required"}
`);
  return rel(cwd, file);
}

function writeCapabilityEvidence(cwd: string, runId: string, runDirPath: string, reason: string): string {
  const file = path.join(runDirPath, "evidence", "subagent-capability.md");
  writeText(file, `# True Harness Capability Gate

## Status

- run: ${runId}
- gate: blocked
- reason: ${reason}

## Required Recovery

- Resume this run from the real provider session that is acting as Orchestrator.
- Ensure \`IMFINE_PROVIDER\` is set to \`codex\` or \`claude\`.
- Ensure \`IMFINE_SUBAGENT_SUPPORTED=true\` is only declared when native subagent/spawn is actually available.
- Re-run \`imfine doctor\` and then \`imfine resume ${runId}\`.
`);
  return rel(cwd, file);
}

function outputsForDiscoveryRole(runDirPath: string, role: string): string[] {
  if (role === "intake") return [path.join(runDirPath, "agents", "intake", "handoff.json"), path.join(runDirPath, "request", "normalized.md")];
  if (role === "project-analyzer") return [path.join(runDirPath, "agents", "project-analyzer", "handoff.json"), path.join(runDirPath, "analysis", "project-context.md")];
  if (role === "product-planner") return [path.join(runDirPath, "agents", "product-planner", "handoff.json"), path.join(runDirPath, "analysis", "product-analysis.md")];
  if (role === "architect") return [path.join(runDirPath, "agents", "architect", "handoff.json"), path.join(runDirPath, "design", "technical-solution.md")];
  return [path.join(runDirPath, "agents", role, "handoff.json")];
}

function outputsForNewProjectRole(runDirPath: string, role: string): string[] {
  if (role === "architect") {
    return [
      path.join(runDirPath, "design", "stack-decision.json"),
      path.join(runDirPath, "design", "technical-solution.md"),
      path.join(runDirPath, "design", "architecture-decisions.md"),
      path.join(runDirPath, "agents", "architect", "handoff.json")
    ];
  }
  return [
    path.join(runDirPath, "planning", "task-graph.json"),
    path.join(runDirPath, "planning", "ownership.json"),
    path.join(runDirPath, "planning", "execution-plan.md"),
    path.join(runDirPath, "planning", "commit-plan.md"),
    path.join(runDirPath, "agents", "task-planner", "handoff.json")
  ];
}

function taskPipelineWorkflow(): ExistingProjectActiveDeliveryWorkflow["task_pipeline"] {
  return workflowState<ExistingProjectActiveDeliveryWorkflow>("existing-project-delivery", "active_delivery").task_pipeline;
}

function taskPipelineState(config: TaskPipelineConfig, workflowStateId: TaskPipelineWorkflowState) {
  return config.states[workflowStateId];
}

function materializePattern(pattern: string, params: Record<string, string | number>): string {
  return pattern.replace(/\{([^}]+)\}/g, (_match, key) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing task pipeline pattern param: ${key}`);
    return String(value);
  });
}

function materializeTaskPipelineState(
  config: TaskPipelineConfig,
  workflowStateId: TaskPipelineWorkflowState,
  taskId: string,
  layer: number,
  roleOverride?: string
): TaskPipelineMaterialized {
  const state = taskPipelineState(config, workflowStateId);
  const role = roleOverride || ("role" in state ? state.role : state.roles[0]);
  return {
    workflowState: workflowStateId,
    role,
    actionId: materializePattern(state.action_id_pattern, { role, task_id: taskId, layer }),
    parallelGroup: materializePattern(state.parallel_group_pattern, { role, task_id: taskId, layer }),
    reason: state.reason
  };
}

function taskLayerNumber(graph: TaskGraph, task: TaskGraphTask): number {
  return taskLayer(graph, task);
}

function implementationRoleStatus(runDirPath: string, task: TaskGraphTask, role: string, dependenciesReady: boolean): "ready" | "waiting" | "completed" {
  return taskRoleStatus(runDirPath, task, role, dependenciesReady);
}

function qaRoleStatus(runDirPath: string, taskId: string): "ready" | "waiting" | "completed" {
  if (qaPassed(runDirPath, taskId)) return "completed";
  return patchReady(runDirPath, taskId) ? "ready" : "waiting";
}

function reviewRoleStatus(runDirPath: string, taskId: string): "ready" | "waiting" | "completed" {
  if (reviewApproved(runDirPath, taskId)) return "completed";
  return qaPassed(runDirPath, taskId) ? "ready" : "waiting";
}

function implementationWorkflowState(status: "ready" | "waiting" | "completed"): TaskPipelineWorkflowState {
  if (status === "ready") return "implementation_ready";
  if (status === "waiting") return "implementation_waiting";
  return "implementation_done";
}

function qaWorkflowState(status: "ready" | "waiting" | "completed"): TaskPipelineWorkflowState {
  if (status === "ready") return "qa_ready";
  if (status === "waiting") return "qa_waiting";
  return "qa_done";
}

function reviewWorkflowState(status: "ready" | "waiting" | "completed"): TaskPipelineWorkflowState {
  if (status === "ready") return "review_ready";
  if (status === "waiting") return "review_waiting";
  return "review_done";
}

function addImplementationStage(
  actions: OrchestrationAction[],
  agents: AgentRun[],
  cwd: string,
  runDirPath: string,
  task: TaskGraphTask,
  role: string,
  status: "ready" | "waiting" | "completed",
  layer: number,
  config: TaskPipelineConfig
): void {
  const materialized = materializeTaskPipelineState(config, implementationWorkflowState(status), task.id, layer, role);
  agents.push(makeAgentRun(cwd, runDirPath, task, role, status, materialized.parallelGroup, materialized.workflowState));
  actions.push(createAction(cwd, runDirPath, {
    id: materialized.actionId,
    kind: "agent",
    status: status === "completed" ? "done" : status,
    role,
    taskId: task.id,
    reason: materialized.reason,
    dependsOn: task.depends_on,
    parallelGroup: materialized.parallelGroup,
    inputs: [rel(cwd, path.join(runDirPath, "agents", task.id, "input.md"))],
    outputs: [rel(cwd, patchFile(runDirPath, task.id))]
  }));
}

function addQaStage(
  actions: OrchestrationAction[],
  agents: AgentRun[],
  cwd: string,
  runId: string,
  runDirPath: string,
  task: TaskGraphTask,
  status: "ready" | "waiting" | "completed",
  layer: number,
  config: TaskPipelineConfig
): void {
  const materialized = materializeTaskPipelineState(config, qaWorkflowState(status), task.id, layer);
  agents.push(makeAgentRun(cwd, runDirPath, task, materialized.role, status, materialized.parallelGroup, materialized.workflowState));
  if (status === "completed") return;
  const implementation = materializeTaskPipelineState(config, "implementation_done", task.id, layer, roleForTask(task));
  actions.push(createAction(cwd, runDirPath, {
    id: materialized.actionId,
    kind: "agent",
    status,
    role: materialized.role,
    taskId: task.id,
    command: `imfine verify ${runId} ${task.id}`,
    reason: materialized.reason,
    dependsOn: [implementation.actionId],
    parallelGroup: materialized.parallelGroup,
    inputs: [rel(cwd, patchFile(runDirPath, task.id))],
    outputs: [rel(cwd, path.join(runDirPath, "agents", `qa-${task.id}`, "handoff.json"))]
  }));
}

function addReviewStage(
  actions: OrchestrationAction[],
  agents: AgentRun[],
  cwd: string,
  runId: string,
  runDirPath: string,
  task: TaskGraphTask,
  status: "ready" | "waiting" | "completed",
  layer: number,
  config: TaskPipelineConfig
): void {
  const materialized = materializeTaskPipelineState(config, reviewWorkflowState(status), task.id, layer);
  agents.push(makeAgentRun(cwd, runDirPath, task, materialized.role, status, materialized.parallelGroup, materialized.workflowState));
  if (status === "completed") return;
  const qa = materializeTaskPipelineState(config, "qa_done", task.id, layer);
  actions.push(createAction(cwd, runDirPath, {
    id: materialized.actionId,
    kind: "agent",
    status,
    role: materialized.role,
    taskId: task.id,
    command: `imfine review ${runId} ${task.id} --status approved|changes_requested|blocked`,
    reason: materialized.reason,
    dependsOn: [qa.actionId],
    parallelGroup: materialized.parallelGroup,
    inputs: [rel(cwd, path.join(runDirPath, "agents", `qa-${task.id}`, "handoff.json"))],
    outputs: [rel(cwd, path.join(runDirPath, "agents", `reviewer-${task.id}`, "handoff.json"))]
  }));
}

function addDesignReworkActions(
  actions: OrchestrationAction[],
  agents: AgentRun[],
  cwd: string,
  runId: string,
  runDirPath: string,
  graph: TaskGraph
): void {
  const workflow = readFixLoopDesignReworkState();
  const blockedTasks = tasksWithStatus(graph, runDirPath, "implementation_blocked_by_design");

  for (const task of blockedTasks) {
    const architectActionId = materializeFixLoopPattern(workflow.architect.action_id_pattern, { task_id: task.id });
    const plannerActionId = materializeFixLoopPattern(workflow.task_planner.action_id_pattern, { task_id: task.id });
    const architectParallelGroup = materializeFixLoopPattern(workflow.architect.parallel_group_pattern, { task_id: task.id });
    const plannerParallelGroup = materializeFixLoopPattern(workflow.task_planner.parallel_group_pattern, { task_id: task.id });
    const plannerDependsOn = materializeFixLoopPattern(workflow.task_planner.depends_on_pattern, { task_id: task.id });
    const architectAgentId = `architect-${task.id}`;
    const plannerAgentId = `task-planner-${task.id}`;
    const architectInput = rel(cwd, path.join(runDirPath, "agents", architectAgentId, "input.md"));
    const plannerInput = rel(cwd, path.join(runDirPath, "agents", plannerAgentId, "input.md"));
    const architectOutputs = [
      rel(cwd, path.join(runDirPath, "agents", architectAgentId, "handoff.json")),
      rel(cwd, path.join(runDirPath, "design", "technical-solution.md")),
      rel(cwd, path.join(runDirPath, "design", "architecture-decisions.md"))
    ];
    const plannerOutputs = [
      rel(cwd, path.join(runDirPath, "agents", plannerAgentId, "handoff.json")),
      rel(cwd, path.join(runDirPath, "planning", "task-graph.json")),
      rel(cwd, path.join(runDirPath, "planning", "execution-plan.md")),
      rel(cwd, path.join(runDirPath, "planning", "commit-plan.md"))
    ];
    const architectCompleted = isActionCompleted(cwd, runId, architectActionId);
    const plannerCompleted = isActionCompleted(cwd, runId, plannerActionId);
    const architectStatus: AgentRun["status"] = architectCompleted ? "completed" : "ready";
    const plannerStatus: AgentRun["status"] = plannerCompleted ? "completed" : architectCompleted ? "ready" : "waiting";

    agents.push(makeNamedAgentRun(
      cwd,
      runDirPath,
      runId,
      architectAgentId,
      workflow.architect.role,
      architectStatus,
      architectParallelGroup,
      [architectInput],
      architectOutputs,
      [],
      "implementation_blocked_by_design"
    ));
    actions.push(createAction(cwd, runDirPath, {
      id: architectActionId,
      kind: "agent",
      status: architectCompleted ? "done" : "ready",
      role: workflow.architect.role,
      taskId: task.id,
      reason: workflow.architect.reason,
      dependsOn: [],
      parallelGroup: architectParallelGroup,
      inputs: [architectInput],
      outputs: architectOutputs
    }));

    agents.push(makeNamedAgentRun(
      cwd,
      runDirPath,
      runId,
      plannerAgentId,
      workflow.task_planner.role,
      plannerStatus,
      plannerParallelGroup,
      [plannerInput],
      plannerOutputs,
      [plannerDependsOn],
      "implementation_blocked_by_design"
    ));
    actions.push(createAction(cwd, runDirPath, {
      id: plannerActionId,
      kind: "agent",
      status: plannerCompleted ? "done" : architectCompleted ? "ready" : "waiting",
      role: workflow.task_planner.role,
      taskId: task.id,
      reason: workflow.task_planner.reason,
      dependsOn: [plannerDependsOn],
      parallelGroup: plannerParallelGroup,
      inputs: [plannerInput],
      outputs: plannerOutputs
    }));
  }
}

function inferParallelPlanEvidence(runDirPath: string, actions: OrchestrationAction[]): ParallelPlanEvidence {
  if (actions.some((action) => action.id === "gate-subagent-capability")) {
    return {
      serialReason: "provider_capability: current session does not expose native subagent/spawn support",
      replanRecommended: false,
      parallelismBlockedBy: "provider_capability"
    };
  }
  const taskGraphFile = path.join(runDirPath, "planning", "task-graph.json");
  if (!exists(taskGraphFile)) {
    return {
      serialReason: "task_graph: task graph is missing, so parallel readiness cannot be computed yet",
      replanRecommended: false,
      parallelismBlockedBy: "task_graph"
    };
  }
  const validation = validateTaskGraph(readJson<TaskGraph>(taskGraphFile));
  if (validation.errors.some((error) => error.includes("overlapping write_scope"))) {
    return {
      serialReason: validation.serialReason,
      replanRecommended: true,
      parallelismBlockedBy: "boundary_conflict"
    };
  }
  if (validation.serialReason) {
    return {
      serialReason: validation.serialReason,
      replanRecommended: validation.replanRecommended,
      parallelismBlockedBy: "task_graph"
    };
  }
  return {
    serialReason: null,
    replanRecommended: false,
    parallelismBlockedBy: "none"
  };
}

function inferTaskActions(cwd: string, runId: string, runDirPath: string, graph: TaskGraph, hasWorktrees: boolean): { actions: OrchestrationAction[]; agents: AgentRun[] } {
  const actions: OrchestrationAction[] = [];
  const agents: AgentRun[] = [];
  const pipeline = taskPipelineWorkflow();

  if (!hasWorktrees) {
    const needsDependencyInstall = dependencyInstallRequired(cwd) && !isActionCompleted(cwd, runId, "runtime-dependency-install");
    if (needsDependencyInstall) {
      actions.push(createAction(cwd, runDirPath, {
        id: "runtime-dependency-install",
        kind: "runtime",
        status: "ready",
        role: "orchestrator",
        command: `imfine dependency install ${runId}`,
        reason: "project dependency markers require an internal dependency install attempt before worktree execution",
        dependsOn: [],
        parallelGroup: "bootstrap",
        outputs: [rel(cwd, path.join(runDirPath, "evidence", "dependency-install.md"))]
      }));
    }
    actions.push(createAction(cwd, runDirPath, {
      id: "runtime-worktree-prepare",
      kind: "runtime",
      status: needsDependencyInstall ? "waiting" : "ready",
      role: "orchestrator",
      command: `imfine worktree prepare ${runId}`,
      reason: needsDependencyInstall ? "run worktrees wait for dependency install evidence" : "run has a task graph but no prepared run/task worktrees",
      dependsOn: needsDependencyInstall ? ["runtime-dependency-install"] : [],
      parallelGroup: "bootstrap",
      outputs: [rel(cwd, path.join(runDirPath, "worktrees", "index.json"))]
    }));
    return { actions, agents };
  }

  for (const task of graph.tasks) {
    const layer = taskLayerNumber(graph, task);
    const role = roleForTask(task);
    const dependenciesReady = dependencyReady(runDirPath, task);
    const status = taskStatus(runDirPath, task.id);
    if ((status === "qa_failed" || status === "review_changes_requested" || status === "needs_dev_fix") && hasPendingFixTask(graph, runDirPath, task.id)) {
      continue;
    }
    if (!patchReady(runDirPath, task.id)) {
      addImplementationStage(actions, agents, cwd, runDirPath, task, role, implementationRoleStatus(runDirPath, task, role, dependenciesReady), layer, pipeline);
      continue;
    }

    addImplementationStage(actions, agents, cwd, runDirPath, task, role, "completed", layer, pipeline);

    const qaStatus = qaRoleStatus(runDirPath, task.id);
    if (qaStatus !== "completed") {
      addQaStage(actions, agents, cwd, runId, runDirPath, task, qaStatus, layer, pipeline);
      continue;
    }

    addQaStage(actions, agents, cwd, runId, runDirPath, task, "completed", layer, pipeline);

    const reviewerStatus = reviewRoleStatus(runDirPath, task.id);
    if (reviewerStatus !== "completed") {
      addReviewStage(actions, agents, cwd, runId, runDirPath, task, reviewerStatus, layer, pipeline);
      continue;
    }

    addReviewStage(actions, agents, cwd, runId, runDirPath, task, "completed", layer, pipeline);
  }

  return { actions, agents };
}

function groupActions(actions: OrchestrationAction[], agentRuns: AgentRun[] = []): ParallelGroup[] {
  const groups = new Map<string, OrchestrationAction[]>();
  for (const action of actions) {
    const existing = groups.get(action.parallelGroup) || [];
    existing.push(action);
    groups.set(action.parallelGroup, existing);
  }
  const actionGroups: ParallelGroup[] = Array.from(groups.entries()).map(([id, group]) => ({
    id,
    status: group.some((action) => action.status === "blocked")
      ? "blocked"
      : group.some((action) => action.status === "ready")
        ? "ready"
        : group.some((action) => action.status === "waiting")
          ? "waiting"
          : "done",
    reason: group.length > 1 ? "actions can run in parallel within this boundary" : "single action gate",
    actionIds: group.map((action) => action.id),
    readyActionIds: group.filter((action) => action.status === "ready").map((action) => action.id),
    taskIds: Array.from(new Set(group.map((action) => action.taskId).filter((value): value is string => Boolean(value)))),
    roles: Array.from(new Set(group.map((action) => action.role)))
  }));

  const agentGroups = new Map<string, AgentRun[]>();
  for (const agent of agentRuns) {
    const existing = agentGroups.get(agent.parallelGroup) || [];
    existing.push(agent);
    agentGroups.set(agent.parallelGroup, existing);
  }
  const missingAgentGroups: ParallelGroup[] = Array.from(agentGroups.entries())
    .filter(([id]) => !groups.has(id))
    .map(([id, group]) => ({
      id,
      status: group.some((agent) => agent.status === "ready")
        ? "ready"
        : group.some((agent) => agent.status === "waiting" || agent.status === "planned")
          ? "waiting"
          : "done",
      reason: group.length > 1 ? "agents ran in parallel within this boundary" : "single agent boundary",
      actionIds: group.map((agent) => agent.id),
      readyActionIds: group.filter((agent) => agent.status === "ready").map((agent) => agent.id),
      taskIds: Array.from(new Set(group.map((agent) => agent.taskId).filter((value): value is string => Boolean(value)))),
      roles: Array.from(new Set(group.map((agent) => agent.role)))
    }));

  return [...actionGroups, ...missingAgentGroups];
}

function writeTimeline(file: string, result: Omit<OrchestratorResult, "files">): void {
  const actionable = result.nextActions.filter((action) => action.status !== "done");
  writeText(file, [
    `# Orchestration Timeline`,
    "",
    `- run: ${result.runId}`,
    `- mode: ${result.mode}`,
    `- inferred state: ${result.status}`,
    `- next actions: ${actionable.length}`,
    "",
    "## Next Actions",
    "",
    actionable.length > 0
      ? actionable.map((action) => `- [${action.status}] ${action.id}: ${action.reason}`).join("\n")
      : "- none; run appears complete or blocked without a runtime-safe action",
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
  const stateDir = path.join(cwd, ".imfine", "state");
  const runState = normalizeRunState(readJson<RunMetadata>(path.join(runDirPath, "run.json")).status);
  const actionable = result.nextActions.filter((action) => action.status !== "done");
  ensureDir(orchestrationDir);
  ensureDir(stateDir);

  const files = {
    state: path.join(orchestrationDir, "state.json"),
    queue: path.join(stateDir, "queue.json"),
    infrastructureGate: path.join(orchestrationDir, "infrastructure-gate.json"),
    agentRuns: path.join(orchestrationDir, "agent-runs.json"),
    dispatchContracts: path.join(orchestrationDir, "dispatch-contracts.json"),
    parallelPlan: path.join(orchestrationDir, "parallel-plan.json"),
    timeline: path.join(orchestrationDir, "timeline.md")
  };
  const dispatchContracts = buildDispatchContracts(cwd, runId, runDirPath, result.nextActions, result.agentRuns);
  const parallelEvidence = inferParallelPlanEvidence(runDirPath, result.nextActions);
  const existingParallelPlan = exists(files.parallelPlan)
    ? readJson<{
      executed_parallel_groups?: string[];
      blocked_parallel_groups?: string[];
      wave_history?: unknown[];
    }>(files.parallelPlan)
    : null;

  writeText(files.state, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    mode: result.mode,
    status: runState,
    inferred_status: result.status,
    updated_at: new Date().toISOString(),
    next_action_count: actionable.length,
    ready_action_ids: actionable.filter((action) => action.status === "ready").map((action) => action.id),
    blocked_action_ids: actionable.filter((action) => action.status === "blocked").map((action) => action.id),
    ready_roles: dispatchContracts.filter((item) => item.status === "ready").map((item) => item.role),
    waiting_roles: dispatchContracts.filter((item) => item.status === "waiting").map((item) => item.role),
    completed_roles: dispatchContracts.filter((item) => item.status === "done").map((item) => item.role),
    blocked_roles: dispatchContracts.filter((item) => item.status === "blocked").map((item) => item.role),
    ready_contract_ids: dispatchContracts.filter((item) => item.status === "ready").map((item) => item.id),
    parallel_group_count: result.parallelGroups.length
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
    groups: result.parallelGroups,
    serial_reason: parallelEvidence.serialReason,
    replan_recommended: parallelEvidence.replanRecommended,
    parallelism_blocked_by: parallelEvidence.parallelismBlockedBy,
    executed_parallel_groups: Array.isArray(existingParallelPlan?.executed_parallel_groups) ? existingParallelPlan.executed_parallel_groups : [],
    blocked_parallel_groups: Array.isArray(existingParallelPlan?.blocked_parallel_groups) ? existingParallelPlan.blocked_parallel_groups : [],
    wave_history: Array.isArray(existingParallelPlan?.wave_history) ? existingParallelPlan.wave_history : []
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

export function orchestrateRun(cwd: string, runId: string, mode: OrchestratorResult["mode"] = "orchestrate"): OrchestratorResult {
  const runDirPath = runDir(cwd, runId);
  const metadata = readJson<RunMetadata>(path.join(runDirPath, "run.json"));
  const status = normalizeRunState(metadata.status);
  const graph = optionalJson<TaskGraph>(path.join(runDirPath, "planning", "task-graph.json"));
  const index = optionalJson<WorktreeIndex>(path.join(runDirPath, "worktrees", "index.json"));
  const archiveReport = path.join(runDirPath, "archive", "archive-report.md");
  const archiveComplete = status === "archived" || exists(archiveReport);
  const actions: OrchestrationAction[] = [];
  const agentRuns: AgentRun[] = [];
  const capability = detectTrueHarnessCapability();

  if (!capability.ready) {
    const capabilityGate = path.join(runDirPath, "orchestration", "subagent-capability-gate.json");
    const infrastructureGate = path.join(runDirPath, "orchestration", "infrastructure-gate.json");
    ensureDir(path.dirname(capabilityGate));
    writeText(infrastructureGate, `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      status: "skipped_for_provider_capability_gate",
      checked_at: new Date().toISOString(),
      summary: { pass: 0, warn: 0, fail: 1 },
      checks: []
    }, null, 2)}\n`);
    writeText(capabilityGate, `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      status: "blocked",
      checked_at: new Date().toISOString(),
      provider: capability.provider,
      subagent_support: capability.subagentSupport,
      entry_installed: capability.entryInstalled,
      reason: capability.reason
    }, null, 2)}\n`);
    transitionRunState(cwd, runId, "blocked", {
      blocked_at: new Date().toISOString(),
      blocked_reason: "true_harness_subagent_capability_missing",
      blocked_provider: capability.provider,
      blocked_subagent_support: capability.subagentSupport,
      blocked_evidence: capabilityGate
    });
    actions.push(createAction(cwd, runDirPath, {
      id: "gate-subagent-capability",
      kind: "gate",
      status: "blocked",
      role: "orchestrator",
      reason: capability.reason,
      dependsOn: [],
      parallelGroup: "provider-capability",
      outputs: [rel(cwd, infrastructureGate), rel(cwd, capabilityGate), writeCapabilityEvidence(cwd, runId, runDirPath, capability.reason)]
    }));
    const parallelGroups = groupActions(actions, agentRuns);
    return persist(cwd, runId, {
      runId,
      runDir: runDirPath,
      mode,
      status: "blocked",
      nextActions: actions,
      agentRuns,
      dispatchContracts: [],
      parallelGroups
    });
  }

  const report = doctor(cwd);
  const gateStatus = report.summary.fail > 0 ? "blocked" : report.summary.warn > 0 ? "ready_with_warnings" : "ready";
  const infrastructureGate = path.join(runDirPath, "orchestration", "infrastructure-gate.json");
  writeText(infrastructureGate, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: gateStatus,
    checked_at: report.checkedAt,
    summary: report.summary,
    checks: report.checks
  }, null, 2)}\n`);

  if (report.summary.fail > 0) {
    const evidence = writeInfrastructureEvidence(cwd, runId, runDirPath, report.checks);
    actions.push(createAction(cwd, runDirPath, {
      id: "gate-infrastructure",
      kind: "gate",
      status: "blocked",
      role: "orchestrator",
      reason: "doctor reported failed infrastructure checks",
      dependsOn: [],
      parallelGroup: "infrastructure",
      outputs: [rel(cwd, infrastructureGate), evidence]
    }));
  } else if (!graph && status !== "needs_design_update" && status !== "needs_conflict_resolution" && status !== "needs_task_replan" && metadata.project_kind === "new_project") {
    const workflow = workflowState<NewProjectWaitingWorkflow>("new-project-delivery", "waiting_for_model");
    const architectConfig = workflow.roles.architect;
    const plannerConfig = workflow.roles["task-planner"];
    const architectCompleted = runLevelAgentStatus(runDirPath, "architect", true) === "completed";
    const plannerCompleted = runLevelAgentStatus(runDirPath, "task-planner", false) === "completed";
    const architectStatus: AgentRun["status"] = architectCompleted ? "completed" : "ready";
    const plannerStatus: AgentRun["status"] = plannerCompleted ? "completed" : architectCompleted ? "ready" : "waiting";
    const planningReady = plannerCompleted;

    agentRuns.push(makeNamedAgentRun(
      cwd,
      runDirPath,
      runId,
      "architect",
      "architect",
      architectStatus,
      architectConfig.parallel_group,
      [
        rel(cwd, path.join(runDirPath, "request", "normalized.md")),
        rel(cwd, path.join(runDirPath, "analysis", "project-context.md")),
        rel(cwd, path.join(runDirPath, "orchestration", "context.json"))
      ],
      outputsForNewProjectRole(runDirPath, "architect").map((file) => rel(cwd, file)),
      architectConfig.depends_on || [],
      "waiting_for_model",
      architectConfig.skills
    ));
    actions.push(createAction(cwd, runDirPath, {
      id: architectConfig.action_id,
      kind: "agent",
      status: architectCompleted ? "done" : "ready",
      role: "architect",
      reason: architectConfig.ready_reason || "runtime context is materialized; Architect must choose stack and produce design artifacts",
      dependsOn: architectConfig.depends_on || [],
      parallelGroup: architectConfig.parallel_group,
      outputs: outputsForNewProjectRole(runDirPath, "architect").map((file) => rel(cwd, file))
    }));

    agentRuns.push(makeNamedAgentRun(
      cwd,
      runDirPath,
      runId,
      "task-planner",
      "task-planner",
      plannerStatus,
      plannerConfig.parallel_group,
      [
        rel(cwd, path.join(runDirPath, "request", "normalized.md")),
        rel(cwd, path.join(runDirPath, "analysis", "project-context.md")),
        rel(cwd, path.join(runDirPath, "orchestration", "context.json")),
        rel(cwd, path.join(runDirPath, "design", "technical-solution.md")),
        rel(cwd, path.join(runDirPath, "design", "architecture-decisions.md"))
      ],
      outputsForNewProjectRole(runDirPath, "task-planner").map((file) => rel(cwd, file)),
      plannerConfig.depends_on || [],
      "waiting_for_model",
      plannerConfig.skills
    ));
    actions.push(createAction(cwd, runDirPath, {
      id: plannerConfig.action_id,
      kind: "agent",
      status: plannerCompleted ? "done" : architectCompleted ? "ready" : "waiting",
      role: "task-planner",
      reason: architectCompleted
        ? (plannerConfig.ready_reason || "architect outputs are ready for task planning")
        : (plannerConfig.blocked_reason || "waiting for Architect stack decision and design outputs"),
      dependsOn: plannerConfig.depends_on || [],
      parallelGroup: plannerConfig.parallel_group,
      outputs: outputsForNewProjectRole(runDirPath, "task-planner").map((file) => rel(cwd, file))
    }));

    actions.push(createAction(cwd, runDirPath, {
      id: "runtime-plan",
      kind: "runtime",
      status: planningReady ? "ready" : "waiting",
      role: "task-planner",
      command: `imfine plan ${runId}`,
      reason: planningReady
        ? "model planning outputs are ready for runtime validation and task materialization"
        : "waiting for model planning outputs before runtime validates the task graph",
      dependsOn: ["agent-task-planner"],
      parallelGroup: "new-project-plan-finalize",
      outputs: [rel(cwd, path.join(runDirPath, "planning", "task-graph.json"))]
    }));
  } else if (!graph && status !== "needs_design_update" && status !== "needs_conflict_resolution" && status !== "needs_task_replan") {
    const workflow = workflowState<ExistingProjectNoTaskGraphWorkflow>("existing-project-delivery", "no_task_graph");
    const discoveryAgents = workflow.discovery_roles.map((role) => ({
      role,
      outputs: outputsForDiscoveryRole(runDirPath, role)
    }));
    for (const item of discoveryAgents) {
      const status = runLevelAgentStatus(runDirPath, item.role, true);
      agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, item.role, status, workflow.parallel_groups.discovery, item.outputs));
      actions.push(createAction(cwd, runDirPath, {
        id: `agent-${item.role}`,
        kind: "agent",
        status: status === "completed" ? "done" : "ready",
        role: item.role,
        reason: "run is missing planning evidence; read-only discovery agents can refine requirement and project context in parallel",
        dependsOn: [],
        parallelGroup: workflow.parallel_groups.discovery,
        outputs: item.outputs.map((file) => rel(cwd, file))
      }));
    }
    const discoveryComplete = discoveryAgents.every((item) => isActionCompleted(cwd, runId, `agent-${item.role}`));
    const plannerCompleted = runLevelAgentStatus(runDirPath, workflow.planning_roles[0], false) === "completed";
    const riskCompleted = runLevelAgentStatus(runDirPath, workflow.planning_roles[1], false) === "completed";
    agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, workflow.planning_roles[0], plannerCompleted ? "completed" : discoveryComplete ? "ready" : "waiting", workflow.parallel_groups.planning, [
      path.join(runDirPath, "planning", "task-graph.json"),
      path.join(runDirPath, "planning", "execution-plan.md")
    ]));
    agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, workflow.planning_roles[1], riskCompleted ? "completed" : discoveryComplete ? "ready" : "waiting", workflow.parallel_groups.planning, [
      path.join(runDirPath, "agents", "risk-reviewer", "handoff.json")
    ]));
    actions.push(createAction(cwd, runDirPath, {
      id: "agent-task-planner",
      kind: "agent",
      status: plannerCompleted ? "done" : discoveryComplete ? "ready" : "waiting",
      role: workflow.planning_roles[0],
      reason: "discovery and architecture evidence are ready for model task planning",
      dependsOn: discoveryAgents.map((item) => `agent-${item.role}`),
      parallelGroup: workflow.parallel_groups.planning,
      outputs: [rel(cwd, path.join(runDirPath, "planning", "task-graph.json"))]
    }));
    actions.push(createAction(cwd, runDirPath, {
      id: "agent-risk-reviewer",
      kind: "agent",
      status: riskCompleted ? "done" : discoveryComplete ? "ready" : "waiting",
      role: workflow.planning_roles[1],
      reason: "planning risk can be reviewed alongside task planning",
      dependsOn: discoveryAgents.map((item) => `agent-${item.role}`),
      parallelGroup: workflow.parallel_groups.planning,
      outputs: [rel(cwd, path.join(runDirPath, "agents", "risk-reviewer", "handoff.json"))]
    }));
    actions.push(createAction(cwd, runDirPath, {
      id: workflow.planning_runtime_action,
      kind: "runtime",
      status: plannerCompleted ? "ready" : "waiting",
      role: workflow.planning_roles[0],
      command: `imfine plan ${runId}`,
      reason: plannerCompleted
        ? "model planning outputs are ready for runtime validation and task materialization"
        : "task graph is missing until Task Planner outputs are written",
      dependsOn: ["agent-task-planner"],
      parallelGroup: workflow.parallel_groups.planning_finalize
    }));
  } else if (status === "needs_design_update") {
    if (!graph) throw new Error(`Run ${runId} is in needs_design_update without a task graph.`);
    addDesignReworkActions(actions, agentRuns, cwd, runId, runDirPath, graph);
  } else if (status === "needs_conflict_resolution") {
    const workflow = readFixLoopRoleActionState("needs_conflict_resolution");
    agentRuns.push({
      id: workflow.role,
      role: workflow.role,
      status: "ready",
      skills: skillsForRole(workflow.role),
      inputs: [rel(cwd, path.join(runDirPath, "agents", workflow.role, "input.md"))],
      outputs: [rel(cwd, path.join(runDirPath, "agents", workflow.role, "handoff.json"))],
      readScope: [`.imfine/runs/${runId}/**`],
      writeScope: ["run worktree conflict files"],
      dependsOn: [],
      parallelGroup: workflow.parallel_group
    });
    actions.push(createAction(cwd, runDirPath, {
      id: workflow.action_id,
      kind: "agent",
      status: "ready",
      role: workflow.role,
      reason: workflow.reason,
      dependsOn: [],
      parallelGroup: workflow.parallel_group,
      inputs: [rel(cwd, path.join(runDirPath, "agents", workflow.role, "input.md"))],
      outputs: [rel(cwd, path.join(runDirPath, "agents", workflow.role, "handoff.json"))]
    }));
  } else if (status === "needs_task_replan") {
    const workflow = readFixLoopRoleActionState("needs_task_replan");
    agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, workflow.role, "ready", workflow.parallel_group, [
      path.join(runDirPath, "planning", "task-graph.json"),
      path.join(runDirPath, "planning", "ownership.json"),
      path.join(runDirPath, "planning", "execution-plan.md"),
      path.join(runDirPath, "planning", "commit-plan.md"),
      path.join(runDirPath, "agents", workflow.role, "handoff.json")
    ]));
    actions.push(createAction(cwd, runDirPath, {
      id: workflow.action_id,
      kind: "agent",
      status: "ready",
      role: workflow.role,
      reason: workflow.reason,
      dependsOn: [],
      parallelGroup: workflow.parallel_group,
      inputs: [rel(cwd, path.join(runDirPath, "agents", "task-planner-replan", "input.md"))],
      outputs: [rel(cwd, path.join(runDirPath, "planning", "task-graph.json"))]
    }));
  } else {
    if (!graph) throw new Error(`Run ${runId} is missing a task graph for active delivery orchestration.`);
    const validation = validateTaskGraph(graph);
    if (!validation.passed) {
      const workflow = readFixLoopRoleActionState("needs_task_replan");
      agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, workflow.role, "ready", workflow.parallel_group, [
        path.join(runDirPath, "planning", "task-graph.json"),
        path.join(runDirPath, "planning", "execution-plan.md")
      ]));
      actions.push(createAction(cwd, runDirPath, {
        id: workflow.action_id,
        kind: "agent",
        status: "ready",
        role: workflow.role,
        reason: `task graph needs re-planning: ${validation.errors.join("; ")}`,
        dependsOn: [],
        parallelGroup: workflow.parallel_group,
        outputs: [rel(cwd, path.join(runDirPath, "planning", "task-graph.json"))]
      }));
      return persist(cwd, runId, {
        runId,
        runDir: runDirPath,
        mode,
        status: "needs_task_replan",
        nextActions: actions,
        agentRuns,
        dispatchContracts: [],
        parallelGroups: groupActions(actions, agentRuns)
      });
    }

    const inferred = inferTaskActions(cwd, runId, runDirPath, graph, Boolean(index));
    actions.push(...inferred.actions);
    agentRuns.push(...inferred.agents);

    if (index && inferred.agents.some((agent) => agent.role === "dev" || agent.role === "technical-writer")) {
      const workflow = workflowState<ExistingProjectActiveDeliveryWorkflow>("existing-project-delivery", "active_delivery");
      const riskReviewerStatus = runLevelAgentStatus(runDirPath, workflow.risk_review_role, true);
      agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, workflow.risk_review_role, riskReviewerStatus, workflow.risk_review_parallel_group, [
        path.join(runDirPath, "agents", workflow.risk_review_role, "handoff.json")
      ]));
      actions.push(createAction(cwd, runDirPath, {
        id: "agent-risk-reviewer",
        kind: "agent",
        status: riskReviewerStatus === "completed" ? "done" : riskReviewerStatus,
        role: workflow.risk_review_role,
        reason: workflow.risk_review_reason,
        dependsOn: [],
        parallelGroup: workflow.risk_review_parallel_group,
        outputs: [rel(cwd, path.join(runDirPath, "agents", workflow.risk_review_role, "handoff.json"))]
      }));
    }

    const hasOpenTaskActions = actions.some((action) => action.taskId && action.status !== "done");
    if (!hasOpenTaskActions && graph.tasks.every((task) => reviewApproved(runDirPath, task.id) || taskCommitted(runDirPath, task.id))) {
      const hasCommits = Array.isArray(metadata.commit_hashes) && metadata.commit_hashes.length > 0;
      if (!hasCommits) {
        const workflow = workflowState<ExistingProjectReadyToCommitWorkflow>("existing-project-delivery", "ready_to_commit");
        const committerStatus = runLevelAgentStatus(runDirPath, workflow.review_role, true);
        agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, workflow.review_role, committerStatus, workflow.parallel_group, [
          path.join(runDirPath, "agents", workflow.review_role, "handoff.json")
        ]));
        actions.push(createAction(cwd, runDirPath, {
          id: workflow.review_action_id,
          kind: "agent",
          status: committerStatus === "completed" ? "done" : committerStatus,
          role: workflow.review_role,
          reason: workflow.review_reason,
          dependsOn: graph.tasks.map((task) => `agent-reviewer-${task.id}`),
          parallelGroup: workflow.parallel_group,
          outputs: [rel(cwd, path.join(runDirPath, "agents", workflow.review_role, "handoff.json"))]
        }));
        actions.push(createAction(cwd, runDirPath, {
          id: workflow.runtime_action_id,
          kind: "runtime",
          status: "ready",
          role: "orchestrator",
          command: `imfine commit run ${runId} --mode task`,
          reason: workflow.runtime_reason,
          dependsOn: [workflow.review_action_id],
          parallelGroup: workflow.parallel_group
        }));
      } else if (!metadata.push_status && !archiveComplete) {
        const workflow = workflowState<ExistingProjectReadyToPushWorkflow>("existing-project-delivery", "ready_to_push");
        agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "committer", "completed", "commit", [
          path.join(runDirPath, "agents", "committer", "handoff.json")
        ]));
        actions.push(createAction(cwd, runDirPath, {
          id: workflow.runtime_action_id,
          kind: "runtime",
          status: "ready",
          role: "orchestrator",
          command: `imfine push ${runId}`,
          reason: workflow.runtime_reason,
          dependsOn: workflow.depends_on,
          parallelGroup: workflow.parallel_group
        }));
      } else {
        const workflow = workflowState<ExistingProjectReadyToArchiveWorkflow>("existing-project-delivery", "ready_to_archive");
        agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "committer", "completed", "commit", [
          path.join(runDirPath, "agents", "committer", "handoff.json")
        ]));
        const technicalWriterStatus = archiveComplete ? "completed" : runLevelAgentStatus(runDirPath, "technical-writer", true);
        const projectKnowledgeStatus = archiveComplete ? "completed" : runLevelAgentStatus(runDirPath, "project-knowledge-updater", true);
        agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, workflow.roles[0], technicalWriterStatus, workflow.parallel_group, [
          path.join(runDirPath, "agents", "technical-writer", "handoff.json"),
          path.join(runDirPath, "archive", "final-summary.md")
        ]));
        agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, workflow.roles[1], projectKnowledgeStatus, workflow.parallel_group, [
          path.join(runDirPath, "agents", "project-knowledge-updater", "handoff.json"),
          path.join(cwd, ".imfine", "project", "capabilities")
        ]));
        agentRuns.push({
          id: workflow.roles[2],
          role: workflow.roles[2],
          status: exists(path.join(runDirPath, "agents", "archive", "handoff.json")) || archiveComplete ? "completed" : "waiting",
          skills: skillsForRole(workflow.roles[2]),
          inputs: [rel(cwd, path.join(runDirPath, "run.json")), rel(cwd, path.join(runDirPath, "evidence"))],
          outputs: [rel(cwd, archiveReport)],
          readScope: [`.imfine/runs/${runId}/**`],
          writeScope: [`.imfine/runs/${runId}/archive/**`, ".imfine/project/**", `.imfine/reports/${runId}.md`],
          dependsOn: workflow.depends_on,
          parallelGroup: workflow.parallel_group
        });
        if (!archiveComplete) {
          actions.push(createAction(cwd, runDirPath, {
            id: workflow.technical_writer_action_id,
            kind: "agent",
            status: technicalWriterStatus === "completed" ? "done" : technicalWriterStatus,
            role: workflow.roles[0],
            reason: workflow.technical_writer_reason,
            dependsOn: workflow.depends_on,
            parallelGroup: workflow.parallel_group,
            outputs: [rel(cwd, path.join(runDirPath, "archive", "final-summary.md"))]
          }));
          actions.push(createAction(cwd, runDirPath, {
            id: workflow.project_knowledge_action_id,
            kind: "agent",
            status: projectKnowledgeStatus === "completed" ? "done" : projectKnowledgeStatus,
            role: workflow.roles[1],
            reason: workflow.project_knowledge_reason,
            dependsOn: workflow.depends_on,
            parallelGroup: workflow.parallel_group,
            outputs: [rel(cwd, path.join(cwd, ".imfine", "project", "capabilities"))]
          }));
          actions.push(createAction(cwd, runDirPath, {
            id: workflow.archive_action_id,
            kind: "agent",
            status: "ready",
            role: workflow.roles[2],
            command: `imfine archive ${runId}`,
            reason: workflow.archive_reason,
            dependsOn: [...workflow.depends_on, workflow.technical_writer_action_id, workflow.project_knowledge_action_id],
            parallelGroup: workflow.parallel_group,
            outputs: [rel(cwd, archiveReport)]
          }));
        }
      }
    }
  }

  const parallelGroups = groupActions(actions, agentRuns);
  return persist(cwd, runId, {
    runId,
    runDir: runDirPath,
    mode,
    status,
    nextActions: actions,
    agentRuns,
    dispatchContracts: [],
    parallelGroups
  });
}

export function resumeRun(cwd: string, runId: string): OrchestratorResult {
  return orchestrateRun(cwd, runId, "resume");
}
