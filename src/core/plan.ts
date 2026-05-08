import fs from "node:fs";
import path from "node:path";
import { writeText } from "./fs.js";
import { assertTransitionAccepted, transitionRunState, transitionTaskState } from "./state-machine.js";

export interface TaskGraphTask {
  id: string;
  title: string;
  type: "dev" | "qa" | "review" | "archive" | "docs";
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
  tasks: TaskGraphTask[];
}

export interface TaskGraphValidation {
  passed: boolean;
  errors: string[];
  parallelGroups: string[][];
  serialTasks: string[];
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

interface RunMetadata {
  run_id: string;
  project_kind: "new_project" | "existing_project";
  source?: {
    type?: string;
    value?: string;
  };
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

function readRequirement(runDir: string): string {
  const normalized = path.join(runDir, "request", "normalized.md");
  if (!fs.existsSync(normalized)) return "unknown requirement";
  return fs.readFileSync(normalized, "utf8")
    .replace(/^# Normalized Requirement\s*/i, "")
    .split("\n## Source")[0]
    .trim() || "unknown requirement";
}

function readTestCommands(runDir: string): string[] {
  const projectContext = path.join(runDir, "analysis", "project-context.md");
  if (!fs.existsSync(projectContext)) return [];
  const content = fs.readFileSync(projectContext, "utf8");
  const section = content.split("## Test Commands")[1]?.split("\n## ")[0] || "";
  return section
    .split("\n")
    .map((line) => line.replace(/^- /, "").trim())
    .filter((line) => line && line !== "unknown");
}

function makeCommitMessage(prefix: string, requirement: string): string {
  const short = requirement
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .toLowerCase();
  return `${prefix}: ${short || "planned imfine task"}`;
}

function createTaskGraph(runDir: string, metadata: RunMetadata): TaskGraph {
  const requirement = readRequirement(runDir);
  const testCommands = readTestCommands(runDir);
  const verification = testCommands.length > 0 ? testCommands : metadata.project_kind === "new_project"
    ? ["npm run test", "npm run lint", "npm run format", "npm run typecheck", "npm run build"]
    : ["test command unknown; define verification before implementation"];
  const commonReadScope = [
    ".imfine/project/**",
    `.imfine/runs/${metadata.run_id}/request/**`,
    `.imfine/runs/${metadata.run_id}/analysis/**`,
    `.imfine/runs/${metadata.run_id}/design/**`
  ];

  if (metadata.project_kind === "new_project") {
    return {
      run_id: metadata.run_id,
      strategy: "parallel",
      tasks: [
        {
          id: "T1",
          title: "Create project foundation",
          type: "dev",
          depends_on: [],
          read_scope: commonReadScope,
          write_scope: [".gitignore", "README.md", "package.json", "src/**", "test/**"],
          acceptance: ["Project structure supports the requested product direction", "Initial test command is defined"],
          dev_plan: ["Create project foundation", "Define initial source and test layout", "Record setup commands"],
          test_plan: verification,
          review_plan: ["Review project structure", "Review setup and test command", "Review scope against requirement"],
          verification,
          commit: { mode: "task", message: makeCommitMessage("feat(project)", requirement) }
        },
        {
          id: "T2",
          title: "Document project usage and setup",
          type: "docs",
          depends_on: ["T1"],
          read_scope: [...commonReadScope, "README.md", "package.json"],
          write_scope: ["README.md", "docs/**"],
          acceptance: ["Setup and usage documentation reflect the generated project"],
          dev_plan: ["Update setup and usage documentation", "Keep docs aligned with generated project"],
          test_plan: ["documentation review"],
          review_plan: ["Review docs for accuracy", "Verify docs describe implemented project only"],
          verification: ["documentation review"],
          commit: { mode: "task", message: makeCommitMessage("docs(project)", requirement) }
        }
      ]
    };
  }

  return {
    run_id: metadata.run_id,
    strategy: "serial",
    tasks: [
      {
        id: "T1",
        title: "Implement requested behavior in existing project",
        type: "dev",
        depends_on: [],
        read_scope: [...commonReadScope, "src/**", "lib/**", "app/**", "package.json"],
        write_scope: ["src/**", "lib/**", "app/**", "test/**", "__tests__/**"],
        acceptance: ["Implementation satisfies normalized requirement", "Existing behavior remains compatible"],
        dev_plan: ["Inspect affected modules", "Implement within existing architecture", "Add or update tests"],
        test_plan: verification,
        review_plan: ["Review requirement alignment", "Review write scope compliance", "Review compatibility risks"],
        verification,
        commit: { mode: "integration", message: makeCommitMessage("feat", requirement) }
      },
      {
        id: "T2",
        title: "Update affected documentation if needed",
        type: "docs",
        depends_on: ["T1"],
        read_scope: [...commonReadScope, "README.md", "docs/**"],
        write_scope: ["README.md", "docs/**"],
        acceptance: ["Documentation is updated or explicitly marked not needed"],
        dev_plan: ["Inspect docs for affected behavior", "Update docs or record no-docs-needed reason"],
        test_plan: ["documentation review"],
        review_plan: ["Review docs for accuracy", "Confirm no unimplemented behavior is documented"],
        verification: ["documentation review"],
        commit: { mode: "integration", message: makeCommitMessage("docs", requirement) }
      }
    ]
  };
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

  return {
    passed: errors.length === 0,
    errors,
    parallelGroups: parallelCandidates.length > 1 && errors.length === 0 ? [parallelCandidates.map((task) => task.id)] : [],
    serialTasks: graph.tasks.filter((task) => task.depends_on.length > 0 || graph.strategy !== "parallel").map((task) => task.id)
  };
}

export function validateRunTaskGraph(cwd: string, runId: string): TaskGraphValidation {
  const runDir = ensureRunDir(cwd, runId);
  const file = path.join(runDir, "planning", "task-graph.json");
  if (!fs.existsSync(file)) {
    return {
      passed: false,
      errors: [`Missing task graph for run: ${runId}`],
      parallelGroups: [],
      serialTasks: []
    };
  }
  return validateTaskGraph(readJson<TaskGraph>(file));
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

export function planRun(cwd: string, runId: string): PlanResult {
  const runDir = ensureRunDir(cwd, runId);
  const metadata = readJson<RunMetadata>(path.join(runDir, "run.json"));
  const graph = createTaskGraph(runDir, metadata);
  const validation = validateTaskGraph(graph);
  const artifacts: string[] = [];

  const planningDir = path.join(runDir, "planning");
  const taskGraphFile = path.join(planningDir, "task-graph.json");
  const ownershipFile = path.join(planningDir, "ownership.json");
  const executionPlanFile = path.join(planningDir, "execution-plan.md");
  const commitPlanFile = path.join(planningDir, "commit-plan.md");

  writeText(taskGraphFile, `${JSON.stringify(graph, null, 2)}\n`);
  artifacts.push(taskGraphFile);
  writeText(ownershipFile, `${JSON.stringify({
    run_id: runId,
    tasks: graph.tasks.map((task) => ({
      task_id: task.id,
      agent_type: task.type === "docs" ? "technical-writer" : task.type,
      read_scope: task.read_scope,
      write_scope: task.write_scope
    }))
  }, null, 2)}\n`);
  artifacts.push(ownershipFile);

  writeText(executionPlanFile, `# Execution Plan\n\n## Strategy\n\n${graph.strategy}\n\n## Parallel Groups\n\n${validation.parallelGroups.length > 0 ? validation.parallelGroups.map((group) => `- ${group.join(", ")}`).join("\n") : "- none"}\n\n## Serial Tasks\n\n${validation.serialTasks.length > 0 ? validation.serialTasks.map((task) => `- ${task}`).join("\n") : "- none"}\n\n## Runtime Validation\n\n- passed: ${validation.passed}\n${validation.errors.map((error) => `- ${error}`).join("\n")}\n`);
  artifacts.push(executionPlanFile);

  writeText(commitPlanFile, `# Commit Plan\n\n${graph.tasks.map((task) => `## ${task.id}\n\n- Mode: ${task.commit.mode}\n- Message: ${task.commit.message}`).join("\n\n")}\n`);
  artifacts.push(commitPlanFile);

  writeTaskPlans(cwd, runDir, graph, artifacts);

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
