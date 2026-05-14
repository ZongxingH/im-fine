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

export function validateTaskGraph(graph: TaskGraph): TaskGraphValidation {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const task of graph.tasks) {
    if (ids.has(task.id)) errors.push(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (task.write_scope.length === 0) errors.push(`Task ${task.id} missing write_scope`);
    if (task.read_scope.length === 0) errors.push(`Task ${task.id} missing read_scope`);
    if (task.acceptance.length === 0) errors.push(`Task ${task.id} missing acceptance`);
    if (task.dev_plan.length === 0) errors.push(`Task ${task.id} missing dev_plan`);
    if (task.test_plan.length === 0) errors.push(`Task ${task.id} missing test_plan`);
    if (task.review_plan.length === 0) errors.push(`Task ${task.id} missing review_plan`);
    if (task.verification.length === 0) errors.push(`Task ${task.id} missing verification`);
    if (!task.commit?.message) errors.push(`Task ${task.id} missing commit message`);
  }

  for (const task of graph.tasks) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) errors.push(`Task ${task.id} depends on unknown task ${dep}`);
    }
  }

  const parallelCandidates = graph.tasks.filter((task) => task.depends_on.length === 0);
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
    serialTasks: graph.tasks.filter((task) => task.depends_on.length > 0 || graph.strategy !== "parallel").map((task) => task.id),
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
  const validation = validateTaskGraph(graph);
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
  return materializePlanningFiles(cwd, runId, runDir, graph);
}
