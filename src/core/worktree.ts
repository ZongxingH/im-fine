import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { type TaskGraph, type TaskGraphTask } from "./plan.js";
import { runCommand } from "./shell.js";
import { transitionRunState, transitionTaskState } from "./state-machine.js";

export interface WorktreeTask {
  task_id: string;
  branch: string;
  path: string;
  agent_input: string;
  status: "ready_for_dev";
}

export interface WorktreePrepareResult {
  runId: string;
  runBranch: string;
  worktreeRoot: string;
  tasks: WorktreeTask[];
}

export interface PatchValidationResult {
  passed: boolean;
  errors: string[];
  changedFiles: string[];
  writeScope: string[];
  risks: PatchRisk[];
}

export interface PatchCollectResult {
  runId: string;
  taskId: string;
  patch: string;
  commands: string;
  evidence: string;
  validation: PatchValidationResult;
}

interface WorktreeIndex {
  run_id: string;
  run_branch: string;
  worktree_root: string;
  tasks: WorktreeTask[];
}

export interface PatchRisk {
  file: string;
  level: "medium" | "high";
  reason: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function runGit(cwd: string, args: string[]): string {
  const result = runCommand("git", args, cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.error || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function optionalGit(cwd: string, args: string[]): boolean {
  return runCommand("git", args, cwd).code === 0;
}

function ensureGitRepo(cwd: string): void {
  const result = runCommand("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  if (result.code !== 0 || result.stdout !== "true") {
    throw new Error("Stage 5 requires a git repository.");
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

function repoWorktreeRoot(cwd: string, runId: string): string {
  const hash = crypto.createHash("sha1").update(path.resolve(cwd)).digest("hex").slice(0, 10);
  return path.join(os.tmpdir(), "imfine-worktrees", `${safeName(path.basename(cwd))}-${hash}`, runId);
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function graphFile(cwd: string, runId: string): string {
  const file = path.join(runDir(cwd, runId), "planning", "task-graph.json");
  if (!fs.existsSync(file)) throw new Error(`Missing task graph for run: ${runId}`);
  return file;
}

function indexFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "worktrees", "index.json");
}

function readIndex(cwd: string, runId: string): WorktreeIndex {
  const file = indexFile(cwd, runId);
  if (!fs.existsSync(file)) throw new Error(`Missing worktree index for run: ${runId}. Run worktree prepare first.`);
  return readJson<WorktreeIndex>(file);
}

function ensureBranch(cwd: string, branch: string, startPoint: string): void {
  if (!optionalGit(cwd, ["rev-parse", "--verify", branch])) {
    runGit(cwd, ["branch", branch, startPoint]);
  }
}

function agentType(task: TaskGraphTask): string {
  return task.type === "docs" ? "technical-writer" : task.type;
}

function writeAgentInput(cwd: string, runId: string, task: TaskGraphTask, worktreePath: string): string {
  const dir = path.join(runDir(cwd, runId), "agents", task.id);
  const file = path.join(dir, "input.md");
  writeText(file, `# Agent Input: ${task.id}\n\n## Agent Type\n\n${agentType(task)}\n\n## Worktree\n\n${worktreePath}\n\n## Goal\n\n${task.title}\n\n## Read Scope\n\n${task.read_scope.map((item) => `- ${item}`).join("\n")}\n\n## Write Scope\n\n${task.write_scope.map((item) => `- ${item}`).join("\n")}\n\n## Dev Plan\n\n${task.dev_plan.map((item) => `- ${item}`).join("\n")}\n\n## Test Plan\n\n${task.test_plan.map((item) => `- ${item}`).join("\n")}\n\n## Review Plan\n\n${task.review_plan.map((item) => `- ${item}`).join("\n")}\n\n## Output Requirements\n\n- Make changes only inside write scope.\n- Record commands in \`.imfine/runs/${runId}/agents/${task.id}/commands.md\` through runtime patch collection.\n- Patch collection is performed by runtime after agent work.\n`);
  return file;
}

export function prepareWorktrees(cwd: string, runId: string): WorktreePrepareResult {
  ensureGitRepo(cwd);
  const graph = readJson<TaskGraph>(graphFile(cwd, runId));
  const runBranch = `imfine/${runId}`;
  const root = repoWorktreeRoot(cwd, runId);
  ensureDir(root);

  ensureBranch(cwd, runBranch, "HEAD");

  const tasks: WorktreeTask[] = [];
  for (const task of graph.tasks) {
    const branch = `imfine/${runId}-${task.id}`;
    const taskPath = path.join(root, task.id);
    ensureBranch(cwd, branch, runBranch);
    if (!fs.existsSync(taskPath)) {
      runGit(cwd, ["worktree", "add", taskPath, branch]);
    }
    const input = writeAgentInput(cwd, runId, task, taskPath);
    const item: WorktreeTask = {
      task_id: task.id,
      branch,
      path: taskPath,
      agent_input: input,
      status: "ready_for_dev"
    };
    tasks.push(item);
    transitionTaskState(cwd, runId, task.id, "ready_for_dev", {
      worktree: taskPath,
      branch
    });
  }

  const index: WorktreeIndex = {
    run_id: runId,
    run_branch: runBranch,
    worktree_root: root,
    tasks
  };
  writeText(indexFile(cwd, runId), `${JSON.stringify(index, null, 2)}\n`);

  transitionRunState(cwd, runId, "branch_prepared", {
    run_branch: runBranch,
    branch_prepared_at: new Date().toISOString()
  });
  transitionRunState(cwd, runId, "implementing", {
    implementation_prepared_at: new Date().toISOString(),
    run_branch: runBranch
  });

  return {
    runId,
    runBranch,
    worktreeRoot: root,
    tasks
  };
}

function taskById(cwd: string, runId: string, taskId: string): TaskGraphTask {
  const graph = readJson<TaskGraph>(graphFile(cwd, runId));
  const task = graph.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown task ${taskId} in run ${runId}`);
  return task;
}

function worktreeForTask(cwd: string, runId: string, taskId: string): WorktreeTask {
  const index = readIndex(cwd, runId);
  const task = index.tasks.find((item) => item.task_id === taskId);
  if (!task) throw new Error(`Missing worktree for task ${taskId}`);
  return task;
}

function normalizeScope(scope: string): string {
  return scope.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
}

function matchesScope(file: string, scope: string): boolean {
  if (scope === "**" || scope === "**/*") return true;
  if (!scope.includes("*")) return file === scope;
  const base = normalizeScope(scope);
  return file === base || file.startsWith(`${base}/`);
}

function isLockfile(file: string): boolean {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|poetry\.lock|uv\.lock|Cargo\.lock|go\.sum)$/i.test(file);
}

function isCiOrProductionConfig(file: string): boolean {
  return /^\.github\/workflows\//.test(file)
    || /(^|\/)(Dockerfile|docker-compose\.ya?ml|k8s\/|helm\/|deployment\.ya?ml|production\.ya?ml|prod\.ya?ml|\.env|\.env\.production)$/i.test(file);
}

function isSecurityPolicy(file: string): boolean {
  return /(^|\/)(security\.md|codeowners|permissions\.json|iam\.json|auth|policy|rbac)/i.test(file);
}

function isProtectedImfineState(file: string): boolean {
  return /^\.imfine\/(state|runs\/[^/]+\/orchestration|runs\/[^/]+\/worktrees|runs\/[^/]+\/run\.json)/.test(file);
}

function patchRisks(worktreePath: string, changedFiles: string[]): PatchRisk[] {
  const risks: PatchRisk[] = [];
  const deletions = runGit(worktreePath, ["diff", "--numstat", "HEAD"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
  const largeDeletes = new Map<string, number>();
  for (const [added, deleted, file] of deletions) {
    const deletedCount = Number.parseInt(deleted, 10);
    const addedCount = Number.parseInt(added, 10);
    if (!Number.isNaN(deletedCount) && !Number.isNaN(addedCount) && deletedCount >= 50 && deletedCount > addedCount * 2) {
      largeDeletes.set(file, deletedCount);
    }
  }

  for (const file of changedFiles) {
    if (isProtectedImfineState(file)) risks.push({ file, level: "high", reason: "protected .imfine runtime-owned state file changed" });
    if (isCiOrProductionConfig(file)) risks.push({ file, level: "high", reason: "CI or production configuration changed" });
    if (isSecurityPolicy(file)) risks.push({ file, level: "high", reason: "security, permission, or auth policy area changed" });
    if (isLockfile(file)) risks.push({ file, level: "medium", reason: "dependency lockfile changed" });
    const deleted = largeDeletes.get(file);
    if (deleted) risks.push({ file, level: "high", reason: `large deletion detected: ${deleted} deleted lines` });
  }
  return risks;
}

function writeRiskEvidence(cwd: string, runId: string, taskId: string, risks: PatchRisk[]): void {
  if (risks.length === 0) return;
  const runRoot = runDir(cwd, runId);
  const evidence = path.join(runRoot, "evidence", "patch-risks.md");
  const riskInput = path.join(runRoot, "agents", "risk-reviewer", "input.md");
  const section = `## ${taskId}

${risks.map((risk) => `- ${risk.level}: ${risk.file} - ${risk.reason}`).join("\n")}
`;
  const existing = fs.existsSync(evidence) ? fs.readFileSync(evidence, "utf8") : "# Patch Risk Evidence\n";
  writeText(evidence, `${existing.trim()}\n\n${section}`);
  writeText(riskInput, `# Risk Reviewer Input

## Run

- run: ${runId}
- evidence: ${evidence}

## Required Decision

Review recorded patch risks and decide whether Orchestrator should continue, re-plan, or request scoped mitigation. Do not block on risk without concrete evidence.
`);
}

export function validatePatch(cwd: string, runId: string, taskId: string): PatchValidationResult {
  const task = taskById(cwd, runId, taskId);
  const worktree = worktreeForTask(cwd, runId, taskId);
  runGit(worktree.path, ["add", "-N", "."]);
  const changed = runGit(worktree.path, ["diff", "--name-only", "HEAD"])
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const errors: string[] = [];
  if (changed.length === 0) errors.push("No changed files found");
  for (const file of changed) {
    if (!task.write_scope.some((scope) => matchesScope(file, scope))) {
      errors.push(`Changed file outside write_scope: ${file}`);
    }
  }
  const risks = patchRisks(worktree.path, changed);
  writeRiskEvidence(cwd, runId, taskId, risks);
  return {
    passed: errors.length === 0,
    errors,
    changedFiles: changed,
    writeScope: task.write_scope,
    risks
  };
}

export function collectPatch(cwd: string, runId: string, taskId: string): PatchCollectResult {
  const worktree = worktreeForTask(cwd, runId, taskId);
  const agentDir = path.join(runDir(cwd, runId), "agents", taskId);
  ensureDir(agentDir);
  runGit(worktree.path, ["add", "-N", "."]);
  const patch = runGit(worktree.path, ["diff", "--binary", "HEAD"]);
  const patchFile = path.join(agentDir, "patch.diff");
  const commandsFile = path.join(agentDir, "commands.md");
  const evidenceFile = path.join(runDir(cwd, runId), "tasks", taskId, "evidence.md");
  const validation = validatePatch(cwd, runId, taskId);

  writeText(patchFile, patch ? `${patch}\n` : "");
  writeText(commandsFile, `# Commands\n\n- git add -N .\n- git diff --binary HEAD\n- git diff --name-only HEAD\n\n# Test Evidence\n\nRuntime did not execute task verification in phase 5. Dev Agent must record verification commands before later QA phases.\n`);
  writeText(evidenceFile, `# Evidence\n\n## Patch\n\n${patchFile}\n\n## Changed Files\n\n${validation.changedFiles.length > 0 ? validation.changedFiles.map((file) => `- ${file}`).join("\n") : "- none"}\n\n## Patch Validation\n\n- passed: ${validation.passed}\n${validation.errors.map((error) => `- ${error}`).join("\n")}\n\n## Patch Risks\n\n${validation.risks.length > 0 ? validation.risks.map((risk) => `- ${risk.level}: ${risk.file} - ${risk.reason}`).join("\n") : "- none"}\n\n## Test Evidence\n\n- Pending Dev Agent command evidence; phase 5 only collects and validates patch boundaries.\n`);
  writeText(path.join(agentDir, "status.json"), `${JSON.stringify({
    task_id: taskId,
    status: validation.passed ? "patch_validated" : "patch_invalid",
    validation
  }, null, 2)}\n`);
  transitionTaskState(cwd, runId, taskId, validation.passed ? "patch_validated" : "patch_invalid", {
    validation
  });

  return {
    runId,
    taskId,
    patch: patchFile,
    commands: commandsFile,
    evidence: evidenceFile,
    validation
  };
}
