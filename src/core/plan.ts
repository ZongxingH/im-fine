import fs from "node:fs";
import path from "node:path";
import { writeText } from "./fs.js";
import { assertTransitionAccepted, transitionRunState, transitionTaskState } from "./state-machine.js";

export interface TaskGraphTask {
  id: string;
  title: string;
  type: "dev" | "docs" | "qa" | "qa_gate" | "review" | "review_gate" | "archive" | "delivery_gate";
  depends_on: string[];
  read_scope: string[];
  write_scope: string[];
  acceptance: string[];
  dev_plan: string[];
  test_plan: string[];
  review_plan: string[];
  verification: string[];
  commit: {
    mode: "task" | "integration";
    message: string;
  };
}

export interface TaskGraph {
  run_id: string;
  strategy: "parallel" | "serial" | "conflict_resolution";
  artifact_type?: "planning";
  execution_status?: "not_executed";
  tasks: TaskGraphTask[];
}

export interface TaskGraphValidation {
  passed: boolean;
  errors: string[];
  parallelGroups: string[][];
  serialTasks: string[];
  serialReason: string | null;
  replanRecommended: boolean;
}

export interface TaskGraphValidationOptions {
  expectedRunId?: string;
  orchestratorSession?: {
    next_actions?: Array<{ kind?: string; role?: string; taskId?: string; id?: string }>;
    agent_runs?: Array<{ role?: string; taskId?: string; id?: string }>;
  };
}

export interface PlanResult {
  runId: string;
  runDir: string;
  taskGraph: string;
  ownership: string;
  executionPlan: string;
  commitPlan: string;
  validation: TaskGraphValidation;
  artifacts: string[];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function ensureRunDir(cwd: string, runId: string): string {
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(runDir, "run.json"))) {
    throw new Error(`Run not found: ${runId}`);
  }
  return runDir;
}

function graphTaskSummary(graph: TaskGraph): Array<{ id: string; title: string; type: string; write_scope: string[]; acceptance: string[] }> {
  return graph.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    type: task.type,
    write_scope: task.write_scope,
    acceptance: task.acceptance
  }));
}

function writeSpecDeltaTasks(runDir: string, graph: TaskGraph): string {
  const file = path.join(runDir, "spec-delta", "tasks.md");
  writeText(file, `# Task Delta

${graphTaskSummary(graph).map((task) => `## ${task.id}: ${task.title}\n\n- type: ${task.type}\n- write scope: ${task.write_scope.join(", ")}\n- acceptance: ${task.acceptance.join("; ")}`).join("\n\n")}
`);
  return file;
}

function scopeOverlaps(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

const TASK_TYPES = new Set(["dev", "docs", "qa", "qa_gate", "review", "review_gate", "archive", "delivery_gate"]);
const ARRAY_FIELDS = ["depends_on", "read_scope", "write_scope", "acceptance", "dev_plan", "test_plan", "review_plan", "verification"] as const;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function taskField(task: unknown, field: string): unknown {
  return task && typeof task === "object" ? (task as Record<string, unknown>)[field] : undefined;
}

function detectCycles(tasks: Array<{ id: string; depends_on: string[] }>): string[] {
  const errors: string[] = [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(task: { id: string; depends_on: string[] }, pathIds: string[]): void {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) {
      errors.push(`Task dependency cycle detected: ${[...pathIds, task.id].join(" -> ")}`);
      return;
    }
    visiting.add(task.id);
    for (const dep of task.depends_on) {
      const next = byId.get(dep);
      if (next) visit(next, [...pathIds, task.id]);
    }
    visiting.delete(task.id);
    visited.add(task.id);
  }

  for (const task of tasks) visit(task, []);
  return errors;
}

function validateSessionAlignment(tasks: Array<{ id: string; type: string }>, options: TaskGraphValidationOptions, errors: string[]): void {
  const session = options.orchestratorSession;
  if (!session) return;
  const taskIds = new Set(tasks.map((task) => task.id));
  const agentActions = Array.isArray(session.next_actions) ? session.next_actions.filter((action) => action.kind === "agent") : [];
  const agentRuns = Array.isArray(session.agent_runs) ? session.agent_runs : [];
  for (const action of agentActions) {
    if (action.taskId && !taskIds.has(action.taskId)) errors.push(`Agent action ${action.id || action.role || "unknown"} references unknown task ${action.taskId}`);
  }
  for (const agent of agentRuns) {
    if (agent.taskId && !taskIds.has(agent.taskId)) errors.push(`Agent run ${agent.id || agent.role || "unknown"} references unknown task ${agent.taskId}`);
  }
  for (const task of tasks.filter((item) => item.type !== "archive" && item.type !== "delivery_gate")) {
    if (!agentActions.some((action) => action.taskId === task.id) && !agentRuns.some((agent) => agent.taskId === task.id)) {
      errors.push(`Task ${task.id} has no matching orchestrator action or agent run`);
    }
  }
}

export function validateTaskGraph(graph: TaskGraph, options: TaskGraphValidationOptions = {}): TaskGraphValidation {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (!graph || typeof graph !== "object") {
    return {
      passed: false,
      errors: ["Task graph must be an object"],
      parallelGroups: [],
      serialTasks: [],
      serialReason: null,
      replanRecommended: true
    };
  }

  if (options.expectedRunId && graph.run_id !== options.expectedRunId) {
    errors.push(`Task graph run_id mismatch: expected ${options.expectedRunId}, got ${graph.run_id || "missing"}`);
  }
  if (!Array.isArray(graph.tasks)) errors.push("Task graph tasks must be an array");

  const normalizedTasks = Array.isArray(graph.tasks)
    ? graph.tasks.map((task) => ({
      id: typeof taskField(task, "id") === "string" ? taskField(task, "id") as string : "",
      type: typeof taskField(task, "type") === "string" ? taskField(task, "type") as string : "",
      depends_on: stringArray(taskField(task, "depends_on")),
      read_scope: stringArray(taskField(task, "read_scope")),
      write_scope: stringArray(taskField(task, "write_scope")),
      acceptance: stringArray(taskField(task, "acceptance")),
      dev_plan: stringArray(taskField(task, "dev_plan")),
      test_plan: stringArray(taskField(task, "test_plan")),
      review_plan: stringArray(taskField(task, "review_plan")),
      verification: stringArray(taskField(task, "verification")),
      commit: taskField(task, "commit")
    }))
    : [];

  for (const [index, task] of normalizedTasks.entries()) {
    const label = task.id || `tasks[${index}]`;
    if (!task.id) errors.push(`Task ${index} missing id`);
    if (task.id && ids.has(task.id)) errors.push(`Duplicate task id: ${task.id}`);
    if (task.id) ids.add(task.id);
    if (!TASK_TYPES.has(task.type)) errors.push(`Task ${label} has unsupported type: ${task.type || "missing"}`);
    const original = Array.isArray(graph.tasks) ? graph.tasks[index] as unknown : {};
    for (const field of ARRAY_FIELDS) {
      if (!Array.isArray(taskField(original, field))) errors.push(`Task ${label} ${field} must be an array`);
    }
    if (task.write_scope.length === 0) errors.push(`Task ${label} missing write_scope`);
    if (task.read_scope.length === 0) errors.push(`Task ${label} missing read_scope`);
    if (task.acceptance.length === 0) errors.push(`Task ${label} missing acceptance`);
    if (task.dev_plan.length === 0) errors.push(`Task ${label} missing dev_plan`);
    if (task.test_plan.length === 0) errors.push(`Task ${label} missing test_plan`);
    if (task.review_plan.length === 0) errors.push(`Task ${label} missing review_plan`);
    if (task.verification.length === 0) errors.push(`Task ${label} missing verification`);
    const commit = task.commit;
    if (!commit || typeof commit !== "object" || typeof (commit as { message?: unknown }).message !== "string" || !(commit as { message: string }).message.trim()) {
      errors.push(`Task ${label} missing commit message`);
    }
  }

  for (const task of normalizedTasks) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) errors.push(`Task ${task.id} depends on unknown task ${dep}`);
    }
  }
  errors.push(...detectCycles(normalizedTasks.filter((task) => task.id)));
  validateSessionAlignment(normalizedTasks.filter((task) => task.id), options, errors);

  const parallelCandidates = normalizedTasks.filter((task) => task.depends_on.length === 0 && task.id);
  for (let i = 0; i < parallelCandidates.length; i += 1) {
    for (let j = i + 1; j < parallelCandidates.length; j += 1) {
      const left = parallelCandidates[i];
      const right = parallelCandidates[j];
      const overlaps = left.write_scope.some((a) => right.write_scope.some((b) => scopeOverlaps(a, b)));
      if (overlaps) errors.push(`Parallel tasks ${left.id} and ${right.id} have overlapping write_scope`);
    }
  }

  const serialReason = errors.some((error) => error.includes("overlapping write_scope"))
    ? "boundary_conflict: overlapping write_scope prevents safe same-wave execution"
    : graph.strategy === "serial"
      ? "task_graph: strategy is serial, so runtime cannot truthfully claim parallel delivery"
      : graph.strategy === "conflict_resolution"
        ? "task_graph: conflict resolution flow is intentionally serialized until conflicts are resolved"
        : parallelCandidates.length <= 1 && graph.tasks.length > 1
          ? "task_graph: dependencies leave no independently runnable batch"
          : null;
  const replanRecommended = graph.strategy === "serial" && graph.tasks.length > 1
    || errors.some((error) => error.includes("overlapping write_scope"));

  return {
    passed: errors.length === 0,
    errors,
    parallelGroups: parallelCandidates.length > 1 && errors.length === 0 ? [parallelCandidates.map((task) => task.id)] : [],
    serialTasks: normalizedTasks.filter((task) => task.depends_on.length > 0 || graph.strategy !== "parallel").map((task) => task.id).filter(Boolean),
    serialReason,
    replanRecommended
  };
}

function writeTaskPlans(cwd: string, runDir: string, graph: TaskGraph, artifacts: string[]): void {
  for (const task of graph.tasks) {
    const taskDir = path.join(runDir, "tasks", task.id);
    const content = `# ${task.id}: ${task.title}\n\n## Goal\n\n${task.title}\n\n## Read Scope\n\n${task.read_scope.map((item) => `- ${item}`).join("\n")}\n\n## Write Scope\n\n${task.write_scope.map((item) => `- ${item}`).join("\n")}\n\n## Dependencies\n\n${task.depends_on.length > 0 ? task.depends_on.map((item) => `- ${item}`).join("\n") : "- none"}\n\n## Acceptance\n\n${task.acceptance.map((item) => `- ${item}`).join("\n")}\n\n## Dev Plan\n\n${task.dev_plan.map((item) => `- ${item}`).join("\n")}\n\n## Test Plan\n\n${task.test_plan.map((item) => `- ${item}`).join("\n")}\n\n## Review Plan\n\n${task.review_plan.map((item) => `- ${item}`).join("\n")}\n\n## Commit Plan\n\n- Mode: ${task.commit.mode}\n- Message: ${task.commit.message}\n`;
    for (const [name, body] of Object.entries({
      "task.md": content,
      "dev-plan.md": `# Dev Plan\n\n${task.dev_plan.map((item) => `- ${item}`).join("\n")}\n`,
      "test-plan.md": `# Test Plan\n\n${task.test_plan.map((item) => `- ${item}`).join("\n")}\n`,
      "review-plan.md": `# Review Plan\n\n${task.review_plan.map((item) => `- ${item}`).join("\n")}\n`,
      "evidence.md": "# Evidence\n\nNo execution evidence yet. Phase 4 stops before implementation.\n"
    })) {
      const file = path.join(taskDir, name);
      writeText(file, body);
      artifacts.push(file);
    }
    assertTransitionAccepted(transitionTaskState(cwd, graph.run_id, task.id, "planned"), `plan task ${task.id}`);
    artifacts.push(path.join(taskDir, "status.json"));
  }
}

function materializePlanningFiles(cwd: string, runId: string, runDir: string, graph: TaskGraph): PlanResult {
  const validation = validateTaskGraph(graph, { expectedRunId: runId });
  if (!validation.passed) {
    throw new Error(`Task graph validation failed for run ${runId}: ${validation.errors.join("; ")}`);
  }

  const artifacts: string[] = [];
  const planningDir = path.join(runDir, "planning");
  const taskGraphFile = path.join(planningDir, "task-graph.json");
  const ownershipFile = path.join(planningDir, "ownership.json");
  const executionPlanFile = path.join(planningDir, "execution-plan.md");
  const commitPlanFile = path.join(planningDir, "commit-plan.md");

  writeText(taskGraphFile, `${JSON.stringify({
    artifact_type: "planning",
    execution_status: "not_executed",
    ...graph
  }, null, 2)}\n`);
  artifacts.push(taskGraphFile);
  writeText(ownershipFile, `${JSON.stringify({
    artifact_type: "planning",
    execution_status: "not_executed",
    run_id: runId,
    tasks: graph.tasks.map((task) => ({
      task_id: task.id,
      agent_type: task.type === "docs" ? "technical-writer" : task.type,
      read_scope: task.read_scope,
      write_scope: task.write_scope
    }))
  }, null, 2)}\n`);
  artifacts.push(ownershipFile);

  writeText(executionPlanFile, `# Execution Plan

## Artifact Boundary

- artifact_type: planning
- execution_status: not_executed
- note: this file describes intended dispatch order only; it is not proof that any agent ran

## Strategy

${graph.strategy}

## Parallel Groups

${validation.parallelGroups.length > 0 ? validation.parallelGroups.map((group) => `- ${group.join(", ")}`).join("\n") : "- none"}

## Serial Tasks

${validation.serialTasks.length > 0 ? validation.serialTasks.map((task) => `- ${task}`).join("\n") : "- none"}

## Parallelism Evidence

- serial_reason: ${validation.serialReason || "none"}
- replan_recommended: ${validation.replanRecommended}

## Runtime Validation

- passed: ${validation.passed}
${validation.errors.map((error) => `- ${error}`).join("\n")}
`);
  artifacts.push(executionPlanFile);

  writeText(commitPlanFile, `# Commit Plan

## Artifact Boundary

- artifact_type: planning
- execution_status: not_executed
- note: commit messages here are planned outputs, not completed commit evidence

${graph.tasks.map((task) => `## ${task.id}\n\n- Mode: ${task.commit.mode}\n- Message: ${task.commit.message}`).join("\n\n")}
`);
  artifacts.push(commitPlanFile);

  writeTaskPlans(cwd, runDir, graph, artifacts);
  artifacts.push(writeSpecDeltaTasks(runDir, graph));
  assertTransitionAccepted(transitionRunState(cwd, runId, "planned", { planned_at: new Date().toISOString() }), `plan run ${runId}`);

  return {
    runId,
    runDir,
    taskGraph: taskGraphFile,
    ownership: ownershipFile,
    executionPlan: executionPlanFile,
    commitPlan: commitPlanFile,
    validation,
    artifacts
  };
}

export function materializeTaskGraphArtifacts(cwd: string, runId: string): PlanResult {
  const runDir = ensureRunDir(cwd, runId);
  const graphFile = path.join(runDir, "planning", "task-graph.json");
  if (!fs.existsSync(graphFile)) {
    throw new Error(`Missing model-produced task graph for run: ${runId}`);
  }
  const graph = readJson<TaskGraph>(graphFile);
  const sessionFile = path.join(runDir, "orchestration", "orchestrator-session.json");
  const session = fs.existsSync(sessionFile)
    ? readJson<TaskGraphValidationOptions["orchestratorSession"]>(sessionFile)
    : undefined;
  const validation = validateTaskGraph(graph, { expectedRunId: runId, orchestratorSession: session });
  if (!validation.passed) {
    throw new Error(`Task graph validation failed for run ${runId}: ${validation.errors.join("; ")}`);
  }
  return materializePlanningFiles(cwd, runId, runDir, graph);
}
