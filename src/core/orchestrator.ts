import fs from "node:fs";
import path from "node:path";
import { dependencyInstallRequired } from "./dependencies.js";
import { doctor } from "./doctor.js";
import { ensureDir, writeText } from "./fs.js";
import { validateTaskGraph, type TaskGraph, type TaskGraphTask } from "./plan.js";
import { isActionCompleted } from "./reliability.js";
import { normalizeRunState, type RunState } from "./state-machine.js";

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
  role: string;
  taskId?: string;
  status: "ready" | "waiting" | "planned" | "completed";
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
  reason: string;
  actionIds: string[];
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
  parallelGroups: ParallelGroup[];
  files: {
    state: string;
    queue: string;
    infrastructureGate: string;
    agentRuns: string;
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

interface DoctorLikeCheck {
  id: string;
  label: string;
  status: string;
  detail: string;
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

function taskStatus(runDirPath: string, taskId: string): string | undefined {
  return optionalJson<{ status?: string }>(path.join(runDirPath, "tasks", taskId, "status.json"))?.status;
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
  return {
    id: role,
    role,
    status,
    skills: skillsForRole(role),
    inputs: [
      rel(cwd, path.join(runDirPath, "request", "normalized.md")),
      rel(cwd, path.join(runDirPath, "analysis", "project-context.md")),
      rel(cwd, path.join(runDirPath, "design", "technical-solution.md")),
      rel(cwd, path.join(runDirPath, "planning", "task-graph.json"))
    ],
    outputs: outputs.map((file) => rel(cwd, file)),
    readScope: [`.imfine/runs/${runId}/**`, ".imfine/project/**"],
    writeScope: outputs.map((file) => rel(cwd, file)),
    dependsOn: [],
    parallelGroup
  };
}

function makeAgentRun(cwd: string, runDirPath: string, task: TaskGraphTask, role: string, status: AgentRun["status"], parallelGroup: string): AgentRun {
  const id = role === "dev" || role === "technical-writer" ? task.id : `${role}-${task.id}`;
  return {
    id,
    role,
    taskId: task.id,
    status,
    skills: skillsForRole(role),
    inputs: [
      rel(cwd, path.join(runDirPath, "request", "normalized.md")),
      rel(cwd, path.join(runDirPath, "design", "technical-solution.md")),
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

function inferTaskActions(cwd: string, runId: string, runDirPath: string, graph: TaskGraph, hasWorktrees: boolean): { actions: OrchestrationAction[]; agents: AgentRun[] } {
  const actions: OrchestrationAction[] = [];
  const agents: AgentRun[] = [];

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
    const layer = `task-layer-${taskLayer(graph, task)}`;
    const role = roleForTask(task);
    const dependenciesReady = dependencyReady(runDirPath, task);
    const status = taskStatus(runDirPath, task.id);
    if ((status === "qa_failed" || status === "review_changes_requested" || status === "needs_dev_fix") && hasPendingFixTask(graph, runDirPath, task.id)) {
      continue;
    }
    if (!patchReady(runDirPath, task.id)) {
      const status = dependenciesReady ? "ready" : "waiting";
      agents.push(makeAgentRun(cwd, runDirPath, task, role, status === "ready" ? "ready" : "waiting", layer));
      actions.push(createAction(cwd, runDirPath, {
        id: `agent-${role}-${task.id}`,
        kind: "agent",
        status,
        role,
        taskId: task.id,
        reason: status === "ready" ? "task patch is missing or not validated" : "task dependencies are not ready",
        dependsOn: task.depends_on,
        parallelGroup: layer,
        inputs: [rel(cwd, path.join(runDirPath, "agents", task.id, "input.md"))],
        outputs: [rel(cwd, patchFile(runDirPath, task.id))]
      }));
      continue;
    }

    if (!qaPassed(runDirPath, task.id)) {
      agents.push(makeAgentRun(cwd, runDirPath, task, "qa", "ready", `qa-${layer}`));
      actions.push(createAction(cwd, runDirPath, {
        id: `agent-qa-${task.id}`,
        kind: "agent",
        status: "ready",
        role: "qa",
        taskId: task.id,
        command: `imfine verify ${runId} ${task.id}`,
        reason: "patch is ready but QA evidence is missing or not passing",
        dependsOn: [`agent-${role}-${task.id}`],
        parallelGroup: `qa-${layer}`,
        inputs: [rel(cwd, patchFile(runDirPath, task.id))],
        outputs: [rel(cwd, path.join(runDirPath, "agents", `qa-${task.id}`, "handoff.json"))]
      }));
      continue;
    }

    if (!reviewApproved(runDirPath, task.id)) {
      agents.push(makeAgentRun(cwd, runDirPath, task, "reviewer", "ready", `review-${layer}`));
      actions.push(createAction(cwd, runDirPath, {
        id: `agent-reviewer-${task.id}`,
        kind: "agent",
        status: "ready",
        role: "reviewer",
        taskId: task.id,
        command: `imfine review ${runId} ${task.id} --status approved|changes_requested|blocked`,
        reason: "QA passed but reviewer decision is missing",
        dependsOn: [`agent-qa-${task.id}`],
        parallelGroup: `review-${layer}`,
        inputs: [rel(cwd, path.join(runDirPath, "agents", `qa-${task.id}`, "handoff.json"))],
        outputs: [rel(cwd, path.join(runDirPath, "agents", `reviewer-${task.id}`, "handoff.json"))]
      }));
    }
  }

  return { actions, agents };
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
    reason: group.length > 1 ? "actions can run in parallel within this boundary" : "single action gate",
    actionIds: group.map((action) => action.id),
    taskIds: Array.from(new Set(group.map((action) => action.taskId).filter((value): value is string => Boolean(value)))),
    roles: Array.from(new Set(group.map((action) => action.role)))
  }));
}

function writeTimeline(file: string, result: Omit<OrchestratorResult, "files">): void {
  writeText(file, [
    `# Orchestration Timeline`,
    "",
    `- run: ${result.runId}`,
    `- mode: ${result.mode}`,
    `- inferred state: ${result.status}`,
    `- next actions: ${result.nextActions.length}`,
    "",
    "## Next Actions",
    "",
    result.nextActions.length > 0
      ? result.nextActions.map((action) => `- [${action.status}] ${action.id}: ${action.reason}`).join("\n")
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
  ensureDir(orchestrationDir);
  ensureDir(stateDir);

  const files = {
    state: path.join(orchestrationDir, "state.json"),
    queue: path.join(stateDir, "queue.json"),
    infrastructureGate: path.join(orchestrationDir, "infrastructure-gate.json"),
    agentRuns: path.join(orchestrationDir, "agent-runs.json"),
    parallelPlan: path.join(orchestrationDir, "parallel-plan.json"),
    timeline: path.join(orchestrationDir, "timeline.md")
  };

  writeText(files.state, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    mode: result.mode,
    status: result.status,
    updated_at: new Date().toISOString(),
    next_action_count: result.nextActions.length
  }, null, 2)}\n`);
  writeText(files.queue, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    updated_at: new Date().toISOString(),
    actions: result.nextActions
  }, null, 2)}\n`);
  writeText(files.agentRuns, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    agents: result.agentRuns
  }, null, 2)}\n`);
  writeText(files.parallelPlan, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    groups: result.parallelGroups
  }, null, 2)}\n`);
  writeTimeline(files.timeline, result);

  return { ...result, files };
}

export function orchestrateRun(cwd: string, runId: string, mode: OrchestratorResult["mode"] = "orchestrate"): OrchestratorResult {
  const runDirPath = runDir(cwd, runId);
  const metadata = readJson<RunMetadata>(path.join(runDirPath, "run.json"));
  const status = normalizeRunState(metadata.status);
  const graph = optionalJson<TaskGraph>(path.join(runDirPath, "planning", "task-graph.json"));
  const index = optionalJson<WorktreeIndex>(path.join(runDirPath, "worktrees", "index.json"));
  const archiveReport = path.join(runDirPath, "archive", "archive-report.md");
  const actions: OrchestrationAction[] = [];
  const agentRuns: AgentRun[] = [];

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
  } else if (!graph) {
    const discoveryAgents = [
      {
        role: "intake",
        outputs: [path.join(runDirPath, "agents", "intake", "handoff.json"), path.join(runDirPath, "request", "normalized.md")]
      },
      {
        role: "project-analyzer",
        outputs: [path.join(runDirPath, "agents", "project-analyzer", "handoff.json"), path.join(runDirPath, "analysis", "project-context.md")]
      },
      {
        role: "product-planner",
        outputs: [path.join(runDirPath, "agents", "product-planner", "handoff.json"), path.join(runDirPath, "analysis", "product-analysis.md")]
      },
      {
        role: "architect",
        outputs: [path.join(runDirPath, "agents", "architect", "handoff.json"), path.join(runDirPath, "design", "technical-solution.md")]
      }
    ];
    for (const item of discoveryAgents) {
      agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, item.role, "ready", "discovery", item.outputs));
      actions.push(createAction(cwd, runDirPath, {
        id: `agent-${item.role}`,
        kind: "agent",
        status: "ready",
        role: item.role,
        reason: "run is missing planning evidence; read-only discovery agents can refine requirement and project context in parallel",
        dependsOn: [],
        parallelGroup: "discovery",
        outputs: item.outputs.map((file) => rel(cwd, file))
      }));
    }
    const discoveryComplete = discoveryAgents.every((item) => isActionCompleted(cwd, runId, `agent-${item.role}`));
    agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "task-planner", discoveryComplete ? "ready" : "waiting", "planning", [
      path.join(runDirPath, "planning", "task-graph.json"),
      path.join(runDirPath, "planning", "execution-plan.md")
    ]));
    agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "risk-reviewer", discoveryComplete ? "ready" : "waiting", "planning", [
      path.join(runDirPath, "agents", "risk-reviewer", "handoff.json")
    ]));
    actions.push(createAction(cwd, runDirPath, {
      id: "agent-task-planner",
      kind: "agent",
      status: "ready",
      role: "task-planner",
      reason: "discovery and architecture evidence are ready for model task planning",
      dependsOn: discoveryAgents.map((item) => `agent-${item.role}`),
      parallelGroup: "planning",
      outputs: [rel(cwd, path.join(runDirPath, "planning", "task-graph.json"))]
    }));
    actions.push(createAction(cwd, runDirPath, {
      id: "agent-risk-reviewer",
      kind: "agent",
      status: "ready",
      role: "risk-reviewer",
      reason: "planning risk can be reviewed alongside task planning",
      dependsOn: discoveryAgents.map((item) => `agent-${item.role}`),
      parallelGroup: "planning",
      outputs: [rel(cwd, path.join(runDirPath, "agents", "risk-reviewer", "handoff.json"))]
    }));
    actions.push(createAction(cwd, runDirPath, {
      id: "runtime-plan",
      kind: "runtime",
      status: "ready",
      role: "task-planner",
      command: `imfine plan ${runId}`,
      reason: "task graph is missing",
      dependsOn: ["agent-task-planner"],
      parallelGroup: "planning-finalize"
    }));
  } else if (status === "archived" || exists(archiveReport)) {
    // No next action.
  } else if (status === "needs_conflict_resolution") {
    agentRuns.push({
      id: "conflict-resolver",
      role: "conflict-resolver",
      status: "ready",
      skills: skillsForRole("conflict-resolver"),
      inputs: [rel(cwd, path.join(runDirPath, "agents", "conflict-resolver", "input.md"))],
      outputs: [rel(cwd, path.join(runDirPath, "agents", "conflict-resolver", "handoff.json"))],
      readScope: [`.imfine/runs/${runId}/**`],
      writeScope: ["run worktree conflict files"],
      dependsOn: [],
      parallelGroup: "conflict-resolution"
    });
    actions.push(createAction(cwd, runDirPath, {
      id: "agent-conflict-resolver",
      kind: "agent",
      status: "ready",
      role: "conflict-resolver",
      reason: "run is waiting for conflict resolution",
      dependsOn: [],
      parallelGroup: "conflict-resolution",
      inputs: [rel(cwd, path.join(runDirPath, "agents", "conflict-resolver", "input.md"))],
      outputs: [rel(cwd, path.join(runDirPath, "agents", "conflict-resolver", "handoff.json"))]
    }));
  } else {
    const validation = validateTaskGraph(graph);
    if (!validation.passed) {
      agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "task-planner", "ready", "replan", [
        path.join(runDirPath, "planning", "task-graph.json"),
        path.join(runDirPath, "planning", "execution-plan.md")
      ]));
      actions.push(createAction(cwd, runDirPath, {
        id: "agent-task-planner-replan",
        kind: "agent",
        status: "ready",
        role: "task-planner",
        reason: `task graph needs re-planning: ${validation.errors.join("; ")}`,
        dependsOn: [],
        parallelGroup: "replan",
        outputs: [rel(cwd, path.join(runDirPath, "planning", "task-graph.json"))]
      }));
      return persist(cwd, runId, {
        runId,
        runDir: runDirPath,
        mode,
        status: "needs_task_replan",
        nextActions: actions,
        agentRuns,
        parallelGroups: groupActions(actions)
      });
    }

    const inferred = inferTaskActions(cwd, runId, runDirPath, graph, Boolean(index));
    actions.push(...inferred.actions);
    agentRuns.push(...inferred.agents);

    if (index && actions.some((action) => action.kind === "agent" && (action.role === "dev" || action.role === "technical-writer"))) {
      agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "risk-reviewer", "ready", "planning-risk-review", [
        path.join(runDirPath, "agents", "risk-reviewer", "handoff.json")
      ]));
      actions.push(createAction(cwd, runDirPath, {
        id: "agent-risk-reviewer",
        kind: "agent",
        status: "ready",
        role: "risk-reviewer",
        reason: "implementation boundary and parallelization risk can be reviewed while task agents work",
        dependsOn: [],
        parallelGroup: "planning-risk-review",
        outputs: [rel(cwd, path.join(runDirPath, "agents", "risk-reviewer", "handoff.json"))]
      }));
    }

    if (actions.length === 0 && graph.tasks.every((task) => reviewApproved(runDirPath, task.id) || taskCommitted(runDirPath, task.id))) {
      const hasCommits = Array.isArray(metadata.commit_hashes) && metadata.commit_hashes.length > 0;
      if (!hasCommits) {
        agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "committer", "ready", "commit", [
          path.join(runDirPath, "agents", "committer", "handoff.json")
        ]));
        actions.push(createAction(cwd, runDirPath, {
          id: "agent-committer",
          kind: "agent",
          status: "ready",
          role: "committer",
          reason: "commit readiness and mode can be reviewed before runtime materializes git commits",
          dependsOn: graph.tasks.map((task) => `agent-reviewer-${task.id}`),
          parallelGroup: "commit",
          outputs: [rel(cwd, path.join(runDirPath, "agents", "committer", "handoff.json"))]
        }));
        actions.push(createAction(cwd, runDirPath, {
          id: "runtime-commit-run",
          kind: "runtime",
          status: "ready",
          role: "orchestrator",
          command: `imfine commit run ${runId} --mode task`,
          reason: "all tasks have QA and Review approval but no run commits are recorded",
          dependsOn: ["agent-committer"],
          parallelGroup: "commit"
        }));
      } else if (!metadata.push_status) {
        actions.push(createAction(cwd, runDirPath, {
          id: "runtime-push-run",
          kind: "runtime",
          status: "ready",
          role: "orchestrator",
          command: `imfine push ${runId}`,
          reason: "commits exist but push status is missing",
          dependsOn: ["runtime-commit-run"],
          parallelGroup: "push"
        }));
      } else {
        agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "technical-writer", "ready", "archive", [
          path.join(runDirPath, "agents", "technical-writer", "handoff.json"),
          path.join(runDirPath, "archive", "final-summary.md")
        ]));
        agentRuns.push(makeRunLevelAgent(cwd, runDirPath, runId, "project-knowledge-updater", "ready", "archive", [
          path.join(runDirPath, "agents", "project-knowledge-updater", "handoff.json"),
          path.join(cwd, ".imfine", "project", "capabilities")
        ]));
        agentRuns.push({
          id: "archive",
          role: "archive",
          status: "waiting",
          skills: skillsForRole("archive"),
          inputs: [rel(cwd, path.join(runDirPath, "run.json")), rel(cwd, path.join(runDirPath, "evidence"))],
          outputs: [rel(cwd, archiveReport)],
          readScope: [`.imfine/runs/${runId}/**`],
          writeScope: [`.imfine/runs/${runId}/archive/**`, ".imfine/project/**", `.imfine/reports/${runId}.md`],
          dependsOn: ["runtime-push-run"],
          parallelGroup: "archive"
        });
        actions.push(createAction(cwd, runDirPath, {
          id: "agent-technical-writer-archive",
          kind: "agent",
          status: "ready",
          role: "technical-writer",
          reason: "technical summary can be prepared after push evidence exists",
          dependsOn: ["runtime-push-run"],
          parallelGroup: "archive",
          outputs: [rel(cwd, path.join(runDirPath, "archive", "final-summary.md"))]
        }));
        actions.push(createAction(cwd, runDirPath, {
          id: "agent-project-knowledge-updater",
          kind: "agent",
          status: "ready",
          role: "project-knowledge-updater",
          reason: "project knowledge update can be prepared after push evidence exists",
          dependsOn: ["runtime-push-run"],
          parallelGroup: "archive",
          outputs: [rel(cwd, path.join(cwd, ".imfine", "project", "capabilities"))]
        }));
        actions.push(createAction(cwd, runDirPath, {
          id: "agent-archive",
          kind: "agent",
          status: "ready",
          role: "archive",
          command: `imfine archive ${runId}`,
          reason: "push status exists and archive has not completed",
          dependsOn: ["runtime-push-run", "agent-technical-writer-archive", "agent-project-knowledge-updater"],
          parallelGroup: "archive",
          outputs: [rel(cwd, archiveReport)]
        }));
      }
    }
  }

  const parallelGroups = groupActions(actions);
  return persist(cwd, runId, {
    runId,
    runDir: runDirPath,
    mode,
    status,
    nextActions: actions,
    agentRuns,
    parallelGroups
  });
}

export function resumeRun(cwd: string, runId: string): OrchestratorResult {
  return orchestrateRun(cwd, runId, "resume");
}
