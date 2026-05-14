import fs from "node:fs";
import path from "node:path";
import { doctor } from "./doctor.js";
import type { ExecutionMode } from "./execution-mode.js";
import { ensureDir, writeText } from "./fs.js";
import { initProject } from "./init.js";
import { assertTransitionAccepted, isRunState, transitionRunState, type RunState } from "./state-machine.js";

export interface DeliveryRunResult {
  runId: string;
  cwd: string;
  workspace: string;
  runDir: string;
  projectKind: "new_project" | "existing_project";
  source: {
    type: "text" | "file";
    value: string;
  };
  artifacts: string[];
  status: RunState;
  executionMode: ExecutionMode;
  reusedExisting?: boolean;
}

interface Evidence {
  file: string;
  reason: string;
}

interface ProjectAnalysis {
  kind: "new_project" | "existing_project";
  evidence: Evidence[];
  unknowns: string[];
  packageManager: string;
  testCommands: string[];
}

interface RequirementSource {
  type: "text" | "file";
  value: string;
  content: string;
  absoluteFile?: string;
}

export interface CreateDeliveryRunOptions {
  allowNew?: boolean;
}

function slugify(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return ascii || "delivery-run";
}

function baseRunIdFromRequirement(requirement: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${date}-${slugify(requirement)}`;
}

function uniqueRunId(workspace: string, requirement: string): string {
  const base = baseRunIdFromRequirement(requirement);
  let candidate = base;
  let counter = 2;
  while (fs.existsSync(path.join(workspace, "runs", candidate))) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function readRequirement(cwd: string, args: string[]): RequirementSource {
  const raw = args.join(" ").trim();
  if (!raw) throw new Error("Missing requirement text or requirement file.");

  const possibleFile = path.resolve(cwd, raw);
  if (fs.existsSync(possibleFile) && fs.statSync(possibleFile).isFile()) {
    return {
      type: "file",
      value: path.relative(cwd, possibleFile),
      content: fs.readFileSync(possibleFile, "utf8"),
      absoluteFile: possibleFile
    };
  }

  return {
    type: "text",
    value: raw,
    content: raw
  };
}

function listMeaningfulFiles(cwd: string, ignoredFiles: Set<string>): string[] {
  const ignored = new Set([".git", ".imfine", "node_modules", "dist", ".npm-cache"]);
  const result: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = path.relative(cwd, full);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && !ignoredFiles.has(path.resolve(full))) {
        result.push(relative);
      }
    }
  }

  walk(cwd);
  return result.sort();
}

function projectAnalysis(cwd: string, ignoredFiles = new Set<string>()): ProjectAnalysis {
  const files = listMeaningfulFiles(cwd, ignoredFiles);
  const evidence: Evidence[] = [];
  const unknowns: string[] = [];
  const markers: Array<[string, string, string]> = [
    ["package.json", "npm", "Node.js package manifest"],
    ["package-lock.json", "npm", "npm lockfile"],
    ["pnpm-lock.yaml", "pnpm", "pnpm lockfile"],
    ["yarn.lock", "yarn", "Yarn lockfile"],
    ["requirements.txt", "pip", "Python requirements"],
    ["pyproject.toml", "python", "Python project metadata"],
    ["pom.xml", "maven", "Maven project descriptor"],
    ["build.gradle", "gradle", "Gradle build file"],
    ["Cargo.toml", "cargo", "Rust package manifest"],
    ["go.mod", "go", "Go module file"]
  ];

  let packageManager = "unknown";
  for (const [file, manager, reason] of markers) {
    if (fs.existsSync(path.join(cwd, file))) {
      evidence.push({ file, reason });
      if (packageManager === "unknown") packageManager = manager;
    }
  }

  const readme = files.find((file) => /^readme\.(md|txt)$/i.test(file));
  if (readme) evidence.push({ file: readme, reason: "project README" });

  const sourceFiles = files.filter((file) => /\.(ts|tsx|js|jsx|py|java|go|rs|kt|swift|php|rb|cs)$/i.test(file));
  for (const file of sourceFiles.slice(0, 8)) evidence.push({ file, reason: "source file" });

  if (packageManager === "unknown") unknowns.push("package manager");
  if (sourceFiles.length === 0) unknowns.push("source layout");
  if (!readme) unknowns.push("README");

  const testCommands = detectTestCommands(cwd);
  if (testCommands.length === 0) unknowns.push("test command");

  return {
    kind: files.length === 0 ? "new_project" : "existing_project",
    evidence,
    unknowns,
    packageManager,
    testCommands
  };
}

function detectTestCommands(cwd: string): string[] {
  const packageFile = path.join(cwd, "package.json");
  if (!fs.existsSync(packageFile)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(packageFile, "utf8")) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts || {};
    return ["test", "lint", "typecheck", "build"]
      .filter((name) => typeof scripts[name] === "string")
      .map((name) => `npm run ${name}`);
  } catch {
    return [];
  }
}

function lines(items: string[], fallback = "- unknown"): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function evidenceLines(evidence: Evidence[]): string {
  if (evidence.length === 0) return "- unknown: no project files detected outside ignored runtime directories";
  return evidence.map((item) => `- ${item.file}: ${item.reason}`).join("\n");
}

function writeArtifact(file: string, content: string, artifacts: string[]): void {
  writeText(file, content);
  artifacts.push(file);
}

function pendingRoles(projectKind: ProjectAnalysis["kind"]): string[] {
  return projectKind === "new_project"
    ? ["architect", "task-planner"]
    : ["intake", "project-analyzer", "product-planner", "architect", "task-planner"];
}

function updateCurrentRun(workspace: string, runId: string): void {
  writeText(path.join(workspace, "state", "current.json"), `${JSON.stringify({
    schema_version: 1,
    current_run_id: runId,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`);
}

function currentRunId(workspace: string): string | null {
  const file = path.join(workspace, "state", "current.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { current_run_id?: unknown };
    return typeof parsed.current_run_id === "string" ? parsed.current_run_id : null;
  } catch {
    return null;
  }
}

function activeRunForRequirement(workspace: string, source: RequirementSource): { runId: string; runDir: string; status: RunState; executionMode: ExecutionMode; projectKind: ProjectAnalysis["kind"]; artifacts: string[] } | null {
  const runId = currentRunId(workspace);
  if (!runId) return null;
  const runDir = path.join(workspace, "runs", runId);
  const runFile = path.join(runDir, "run.json");
  if (!fs.existsSync(runFile)) return null;
  const run = JSON.parse(fs.readFileSync(runFile, "utf8")) as {
    status?: string;
    execution_mode?: ExecutionMode;
    project_kind?: ProjectAnalysis["kind"];
    source?: { value?: string; type?: string };
  };
  if (run.status === "completed" || run.status === "blocked") return null;
  if (run.source?.value !== source.value || run.source?.type !== source.type) return null;
  return {
    runId,
    runDir,
    status: typeof run.status === "string" && isRunState(run.status) ? run.status : "waiting_for_agent_output",
    executionMode: run.execution_mode || "true_harness",
    projectKind: run.project_kind || "existing_project",
    artifacts: [
      path.join(runDir, "run.json"),
      path.join(runDir, "orchestration", "orchestrator-input.md"),
      path.join(runDir, "orchestration", "orchestrator-session.json")
    ].filter((file) => fs.existsSync(file))
  };
}

export function createDeliveryRun(cwd: string, requirementArgs: string[], options: CreateDeliveryRunOptions = {}): DeliveryRunResult {
  initProject(cwd);

  const source = readRequirement(cwd, requirementArgs);
  const ignoredProjectFiles = new Set<string>();
  if (source.absoluteFile) ignoredProjectFiles.add(source.absoluteFile);
  const analysis = projectAnalysis(cwd, ignoredProjectFiles);
  const workspace = path.join(cwd, ".imfine");
  const active = options.allowNew ? null : activeRunForRequirement(workspace, source);
  if (active) {
    return {
      runId: active.runId,
      cwd,
      workspace,
      runDir: active.runDir,
      projectKind: active.projectKind,
      source: { type: source.type, value: source.value },
      artifacts: active.artifacts,
      status: active.status,
      executionMode: active.executionMode,
      reusedExisting: true
    };
  }
  const runId = uniqueRunId(workspace, source.content);
  const runDir = path.join(workspace, "runs", runId);
  const artifacts: string[] = [];

  for (const dir of [
    "request",
    "analysis",
    "design",
    "planning",
    "orchestration",
    "spec-delta",
    "tasks",
    "agents",
    "worktrees",
    "evidence",
    "archive"
  ]) {
    ensureDir(path.join(runDir, dir));
  }

  const doctorReport = doctor(cwd);
  const executionMode: ExecutionMode = "true_harness";
  const sourceInfo = { type: source.type, value: source.value };

  writeArtifact(path.join(runDir, "run.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "created",
    execution_mode: executionMode,
    project_kind: analysis.kind,
    source: sourceInfo,
    created_at: new Date().toISOString()
  }, null, 2)}\n`, artifacts);
  assertTransitionAccepted(transitionRunState(cwd, runId, "infrastructure_checked", { infrastructure_checked_at: new Date().toISOString() }), `run ${runId} infrastructure checked`);
  assertTransitionAccepted(transitionRunState(cwd, runId, "project_analyzed", { project_analyzed_at: new Date().toISOString() }), `run ${runId} project analyzed`);

  writeArtifact(path.join(runDir, "request", "input.md"), `# Original Input\n\n${source.content.trim()}\n`, artifacts);
  writeArtifact(path.join(runDir, "request", "normalized.md"), `# Normalized Requirement\n\n${source.content.trim()}\n\n## Source\n\n- Type: ${source.type}\n- Value: ${source.value}\n`, artifacts);
  writeArtifact(path.join(runDir, "request", "source.json"), `${JSON.stringify(sourceInfo, null, 2)}\n`, artifacts);
  assertTransitionAccepted(transitionRunState(cwd, runId, "requirement_analyzed", { requirement_analyzed_at: new Date().toISOString() }), `run ${runId} requirement analyzed`);

  writeArtifact(path.join(runDir, "analysis", "project-context.md"), `# Project Context\n\n## Classification\n\n${analysis.kind}\n\n## Evidence\n\n${evidenceLines(analysis.evidence)}\n\n## Unknowns\n\n${lines(analysis.unknowns)}\n\n## Package Manager\n\n${analysis.packageManager}\n\n## Test Commands\n\n${lines(analysis.testCommands)}\n\n## Doctor Summary\n\n- pass: ${doctorReport.summary.pass}\n- warn: ${doctorReport.summary.warn}\n- fail: ${doctorReport.summary.fail}\n`, artifacts);

  writeArtifact(path.join(runDir, "analysis", "impact-analysis.md"), `# Impact Analysis\n\n## Likely Impact\n\n${analysis.kind === "new_project" ? "- New project scaffolding, product shape, architecture, and test strategy need Agent decisions." : "- Existing project files may be impacted; exact modules require Agent analysis in the planning phase."}\n\n## Evidence\n\n${evidenceLines(analysis.evidence)}\n\n## Unknowns\n\n${lines(analysis.unknowns)}\n`, artifacts);

  writeArtifact(path.join(runDir, "analysis", "risk-analysis.md"), `# Risk Analysis\n\n## Risks\n\n- Requirement interpretation may need Agent clarification before task planning.\n- Test command is ${analysis.testCommands.length > 0 ? "available from detected scripts" : "unknown"}.\n- Package manager is ${analysis.packageManager}.\n\n## High-Risk Areas\n\n- Security, permissions, production configuration, data migration, CI/CD, and external services require explicit evidence before implementation.\n`, artifacts);

  const readyRoles = pendingRoles(analysis.kind);
  writeArtifact(path.join(runDir, "orchestration", "context.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    project_kind: analysis.kind,
    source: sourceInfo,
    evidence: analysis.evidence,
    unknowns: analysis.unknowns,
    package_manager: analysis.packageManager,
    test_commands: analysis.testCommands,
    runtime_context_files: [
      path.join(runDir, "request", "normalized.md"),
      path.join(runDir, "analysis", "project-context.md"),
      path.join(runDir, "analysis", "impact-analysis.md"),
      path.join(runDir, "analysis", "risk-analysis.md")
    ],
    generated_at: new Date().toISOString()
  }, null, 2)}\n`, artifacts);
  writeArtifact(path.join(runDir, "orchestration", "orchestrator-input.md"), `# Orchestrator Input

You are the only orchestration decision maker for this run.

You must coordinate independent native subagents from the current provider session.
Do not complete the full workflow by pretending one agent performed all roles.

## Run

- run id: ${runId}
- execution mode: true_harness
- project kind: ${analysis.kind}

## Required Decision Output

Write \`orchestration/orchestrator-session.json\` as the single source of orchestration truth.

The file must:

- declare \`decision_source=orchestrator_agent\`
- declare \`execution_mode=true_harness\`
- declare \`harness_classification=true_harness\`
- define every planned \`next_action\`
- define every \`agent_run\`
- define explicit dependencies and parallel groups

You must:

- decide which roles to start
- use the current session's native subagent capability to dispatch independent agents
- keep QA, Review, Committer, and Archive as separate roles
- mark the run blocked if the current provider session cannot launch independent subagents

Runtime will only materialize what you write in that file and will only perform deterministic backend actions.
`, artifacts);
  writeArtifact(path.join(runDir, "orchestration", "state.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    current_orchestrator: "session",
    runtime_status: "context_materialized",
    ready_roles: readyRoles,
    waiting_roles: [],
    last_completed_role: "runtime",
    updated_at: new Date().toISOString()
  }, null, 2)}\n`, artifacts);
  assertTransitionAccepted(transitionRunState(cwd, runId, "designed", { designed_at: new Date().toISOString() }), `run ${runId} designed`);

  updateCurrentRun(workspace, runId);
  writeArtifact(path.join(runDir, "spec-delta", "proposal.md"), `# Proposal

## Requirement

${source.content.trim()}

## Run

- run id: ${runId}
- project kind: ${analysis.kind}

## Intent

Capture the run-local capability delta for Archive Agent. This is not the top-level imfine lifecycle.
`, artifacts);
  writeArtifact(path.join(runDir, "spec-delta", "design.md"), `# Design Delta

## Runtime Context

- project kind: ${analysis.kind}
  - package manager: ${analysis.packageManager}
  - test commands: ${analysis.testCommands.length > 0 ? analysis.testCommands.join(", ") : "unknown"}

## Evidence Boundary

${evidenceLines(analysis.evidence)}

## Unknowns

${lines(analysis.unknowns)}

## Initial Model Roles

${readyRoles.map((role) => `- ${role}`).join("\n")}
`, artifacts);
  writeArtifact(path.join(runDir, "spec-delta", "tasks.md"), `# Task Delta

- pending: Task Planner Agent must create the first task graph for this ${analysis.kind === "new_project" ? "new project" : "existing project run"}.
- required outputs:
  - planning/task-graph.json
  - planning/ownership.json
  - planning/execution-plan.md
  - planning/commit-plan.md
`, artifacts);
  assertTransitionAccepted(transitionRunState(cwd, runId, "waiting_for_agent_output", {
    waiting_for_agent_output_at: new Date().toISOString(),
    waiting_for_agent_output_reason: analysis.kind === "new_project"
      ? "new project requires Architect and Task Planner model outputs before runtime planning"
      : "existing project requires discovery and Task Planner model outputs before runtime planning"
  }), `run ${runId} waiting for agent output`);
  return {
    runId,
    cwd,
    workspace,
    runDir,
    projectKind: analysis.kind,
    source: sourceInfo,
    artifacts,
    status: "waiting_for_agent_output",
    executionMode
  };
}
