import fs from "node:fs";
import path from "node:path";
import { doctor } from "./doctor.js";
import { ensureDir, writeText } from "./fs.js";
import { initProject } from "./init.js";
import { planRun, type PlanResult } from "./plan.js";
import { assertTransitionAccepted, transitionRunState } from "./state-machine.js";

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
  status: "planned";
  plan: PlanResult;
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

function updateCurrentRun(workspace: string, runId: string): void {
  writeText(path.join(workspace, "state", "current.json"), `${JSON.stringify({
    schema_version: 1,
    current_run_id: runId,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`);
}

export function createDeliveryRun(cwd: string, requirementArgs: string[]): DeliveryRunResult {
  initProject(cwd);

  const source = readRequirement(cwd, requirementArgs);
  const ignoredProjectFiles = new Set<string>();
  if (source.absoluteFile) ignoredProjectFiles.add(source.absoluteFile);
  const analysis = projectAnalysis(cwd, ignoredProjectFiles);
  const workspace = path.join(cwd, ".imfine");
  const runId = uniqueRunId(workspace, source.content);
  const runDir = path.join(workspace, "runs", runId);
  const artifacts: string[] = [];

  for (const dir of [
    "request",
    "analysis",
    "design",
    "planning",
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
  const sourceInfo = { type: source.type, value: source.value };

  writeArtifact(path.join(runDir, "run.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "created",
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

  writeArtifact(path.join(runDir, "analysis", "requirement-analysis.md"), `# Requirement Analysis\n\n## Requirement\n\n${source.content.trim()}\n\n## Project Kind\n\n${analysis.kind}\n\n## Assumptions\n\n- The run should stop before implementation; task graph and development execution are later phases.\n- Missing project facts are marked unknown instead of guessed.\n\n## Ambiguities\n\n- unknown until an Agent performs deeper requirement clarification.\n\n## Non-Goals\n\n- No code implementation in phase 3.\n- No branch, commit, push, or archive execution in phase 3.\n\n## Acceptance Candidates\n\n- Requirement is captured in normalized form.\n- Project context includes file evidence or unknown markers.\n- Solution design and acceptance criteria are generated for review.\n`, artifacts);

  writeArtifact(path.join(runDir, "analysis", "impact-analysis.md"), `# Impact Analysis\n\n## Likely Impact\n\n${analysis.kind === "new_project" ? "- New project scaffolding, product shape, architecture, and test strategy need Agent decisions." : "- Existing project files may be impacted; exact modules require Agent analysis in the planning phase."}\n\n## Evidence\n\n${evidenceLines(analysis.evidence)}\n\n## Unknowns\n\n${lines(analysis.unknowns)}\n`, artifacts);

  writeArtifact(path.join(runDir, "analysis", "risk-analysis.md"), `# Risk Analysis\n\n## Risks\n\n- Requirement interpretation may need Agent clarification before task planning.\n- Test command is ${analysis.testCommands.length > 0 ? "available from detected scripts" : "unknown"}.\n- Package manager is ${analysis.packageManager}.\n\n## High-Risk Areas\n\n- Security, permissions, production configuration, data migration, CI/CD, and external services require explicit evidence before implementation.\n`, artifacts);

  writeArtifact(path.join(runDir, "analysis", "product-analysis.md"), `# Product Analysis\n\n## Project Kind\n\n${analysis.kind}\n\n## Product Goal\n\n${source.content.trim()}\n\n## Users\n\n- unknown until Product Planner or Intake Analyst refines user context.\n\n## Core Workflow\n\n${analysis.kind === "new_project" ? "- Define the first usable workflow from the requirement before implementation." : "- Fit the requirement into the existing product workflow; exact flow requires Agent analysis."}\n\n## Scope Boundary\n\n- Phase 3 captures product direction only. Feature scope must be converted into a task graph in a later phase.\n`, artifacts);

  writeArtifact(path.join(runDir, "design", "solution-design.md"), `# Solution Design\n\n## Requirement\n\n${source.content.trim()}\n\n## Product Direction\n\n${analysis.kind === "new_project" ? "Create a new project that satisfies the requirement. Product positioning, users, core workflow, and scope should be refined by Product Planner and Architect agents." : "Implement the requirement within the existing project architecture and conventions."}\n\n## Technical Approach\n\n${analysis.kind === "new_project" ? "Technology stack, framework, test tooling, and directory structure are Agent-decided in later phases. Current deterministic analysis records this as pending Agent decision." : "Use existing evidence-backed stack and module boundaries. Unknown areas must remain unknown until inspected by agents."}\n\n## Evidence Basis\n\n${evidenceLines(analysis.evidence)}\n`, artifacts);

  writeArtifact(path.join(runDir, "design", "architecture-decisions.md"), `# Architecture Decisions\n\n## Decisions\n\n- Project kind: ${analysis.kind}.\n- Package manager: ${analysis.packageManager}.\n- Implementation is deferred to task planning and development phases.\n\n## Pending Agent Decisions\n\n${analysis.kind === "new_project" ? "- Select technology stack.\n- Select framework.\n- Define directory structure.\n- Define test strategy." : "- Confirm affected modules.\n- Confirm write boundaries.\n- Confirm test coverage strategy."}\n\n## Unknowns\n\n${lines(analysis.unknowns)}\n`, artifacts);

  writeArtifact(path.join(runDir, "design", "technical-solution.md"), `# Technical Solution\n\n## Current Technical Position\n\n- Project kind: ${analysis.kind}.\n- Package manager: ${analysis.packageManager}.\n- Test commands: ${analysis.testCommands.length > 0 ? analysis.testCommands.join(", ") : "unknown"}.\n\n## Proposed Direction\n\n${analysis.kind === "new_project" ? "- Agent must choose the technology stack, framework, directory structure, and test tooling in the design/planning workflow.\n- The selected stack must be recorded with rationale before implementation." : "- Agent must use existing stack and module boundaries supported by evidence.\n- Unknown technical areas must be inspected before task planning."}\n\n## Evidence or Unknowns\n\n### Evidence\n\n${evidenceLines(analysis.evidence)}\n\n### Unknowns\n\n${lines(analysis.unknowns)}\n`, artifacts);

  writeArtifact(path.join(runDir, "design", "acceptance.md"), `# Acceptance Criteria\n\n- The original requirement is preserved.\n- A normalized requirement exists.\n- Project context classifies the project as new or existing.\n- Every project conclusion includes file evidence or is marked unknown.\n- A solution design exists and is ready for Agent review before task graph generation.\n`, artifacts);
  assertTransitionAccepted(transitionRunState(cwd, runId, "designed", { designed_at: new Date().toISOString() }), `run ${runId} designed`);

  updateCurrentRun(workspace, runId);
  const plan = planRun(cwd, runId);
  artifacts.push(...plan.artifacts);
  const plannedGraph = JSON.parse(fs.readFileSync(plan.taskGraph, "utf8")) as { tasks: Array<{ id: string; title: string; type: string; write_scope: string[]; acceptance: string[] }> };
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

## Technical Direction

- project kind: ${analysis.kind}
- package manager: ${analysis.packageManager}
- test commands: ${analysis.testCommands.length > 0 ? analysis.testCommands.join(", ") : "unknown"}

## Evidence Boundary

${evidenceLines(analysis.evidence)}

## Unknowns

${lines(analysis.unknowns)}
`, artifacts);
  writeArtifact(path.join(runDir, "spec-delta", "tasks.md"), `# Task Delta

${plannedGraph.tasks.map((task) => `## ${task.id}: ${task.title}\n\n- type: ${task.type}\n- write scope: ${task.write_scope.join(", ")}\n- acceptance: ${task.acceptance.join("; ")}`).join("\n\n")}
`, artifacts);

  return {
    runId,
    cwd,
    workspace,
    runDir,
    projectKind: analysis.kind,
    source: sourceInfo,
    artifacts,
    status: "planned",
    plan
  };
}
