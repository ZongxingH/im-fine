import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { refreshOrchestrationSnapshot } from "./orchestration-sync.js";
import { type TaskGraph, type TaskGraphTask } from "./plan.js";
import { runCommand, runShellCommand } from "./shell.js";
import { assertTransitionAccepted, transitionRunState, transitionTaskState } from "./state-machine.js";

export type CommitMode = "task" | "integration";
export type PushStatus = "pushed" | "push_blocked_no_remote" | "push_blocked_auth" | "push_blocked_branch_conflict" | "push_blocked_network" | "push_blocked_failed";

export interface CommitRecord {
  taskIds: string[];
  hash: string;
  message: string;
}

export interface CommitResult {
  runId: string;
  mode: CommitMode;
  runBranch: string;
  runWorktree: string;
  commits: CommitRecord[];
  evidence: string;
  status: "committed";
}

export interface PushResult {
  runId: string;
  runBranch: string;
  runWorktree: string;
  remote: string;
  status: PushStatus;
  evidence: string;
  output: string;
}

interface WorktreeIndex {
  run_id: string;
  run_branch: string;
  worktree_root: string;
  run_worktree?: string;
  tasks: Array<{
    task_id: string;
    branch: string;
    path: string;
  }>;
}

interface AgentStatus {
  status?: string;
  validation?: {
    passed?: boolean;
  };
}

interface RunMetadata {
  project_kind?: "new_project" | "existing_project";
}

interface RuntimeVerification {
  taskId: string;
  command: string;
  code: number | null;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
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

function evidenceFile(cwd: string, runId: string, name: string): string {
  return path.join(runDir(cwd, runId), "evidence", name);
}

function runGit(cwd: string, args: string[]): string {
  const result = runCommand("git", args, cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.error || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function optionalGit(cwd: string, args: string[]) {
  return runCommand("git", args, cwd);
}

function readGraph(cwd: string, runId: string): TaskGraph {
  return readJson<TaskGraph>(graphFile(cwd, runId));
}

function readIndex(cwd: string, runId: string): WorktreeIndex {
  const file = indexFile(cwd, runId);
  if (!fs.existsSync(file)) throw new Error(`Missing worktree index for run: ${runId}. Run worktree prepare first.`);
  return readJson<WorktreeIndex>(file);
}

function writeIndex(cwd: string, runId: string, index: WorktreeIndex): void {
  writeText(indexFile(cwd, runId), `${JSON.stringify(index, null, 2)}\n`);
}

function taskById(graph: TaskGraph, taskId: string): TaskGraphTask {
  const task = graph.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown task ${taskId} in run ${graph.run_id}`);
  return task;
}

function updateRun(cwd: string, runId: string, status: string, extra: Record<string, unknown>): void {
  assertTransitionAccepted(transitionRunState(cwd, runId, status, extra), `update run ${runId}`);
}

function updateTask(cwd: string, runId: string, taskId: string, status: string, extra: Record<string, unknown>): void {
  assertTransitionAccepted(transitionTaskState(cwd, runId, taskId, status, extra), `update task ${taskId}`);
}

function appendEvidence(file: string, title: string, section: string): void {
  ensureDir(path.dirname(file));
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `# ${title}\n\n${section}\n`);
    return;
  }
  fs.appendFileSync(file, `\n\n${section}\n`);
}

function ensureRunWorktree(cwd: string, runId: string): { index: WorktreeIndex; runBranch: string; runWorktree: string } {
  const index = readIndex(cwd, runId);
  const runBranch = index.run_branch || `imfine/${runId}`;
  const runWorktree = index.run_worktree || path.join(index.worktree_root, "_run");

  if (!fs.existsSync(runWorktree)) {
    runGit(cwd, ["worktree", "add", runWorktree, runBranch]);
  } else if (!fs.existsSync(path.join(runWorktree, ".git"))) {
    throw new Error(`Run worktree path exists but is not a git worktree: ${runWorktree}`);
  }

  if (index.run_worktree !== runWorktree) {
    index.run_worktree = runWorktree;
    writeIndex(cwd, runId, index);
  }

  return { index, runBranch, runWorktree };
}

function patchFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", taskId, "patch.diff");
}

function agentStatusFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", taskId, "status.json");
}

function qaStatusFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `qa-${taskId}`, "status.json");
}

function reviewerStatusFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `reviewer-${taskId}`, "status.json");
}

function requireReadyToCommit(cwd: string, runId: string, taskId: string): void {
  const patch = patchFile(cwd, runId, taskId);
  if (!fs.existsSync(patch) || fs.readFileSync(patch, "utf8").trim().length === 0) {
    throw new Error(`Missing collected patch for task ${taskId}`);
  }

  const patchStatusPath = agentStatusFile(cwd, runId, taskId);
  if (!fs.existsSync(patchStatusPath)) throw new Error(`Missing patch status for task ${taskId}`);
  const patchStatus = readJson<AgentStatus>(patchStatusPath);
  if (patchStatus.status !== "patch_validated" || patchStatus.validation?.passed !== true) {
    throw new Error(`Task ${taskId} patch is not validated`);
  }

  const qaPath = qaStatusFile(cwd, runId, taskId);
  if (!fs.existsSync(qaPath)) throw new Error(`Missing QA evidence for task ${taskId}`);
  const qa = readJson<AgentStatus>(qaPath);
  if (qa.status !== "pass") throw new Error(`Task ${taskId} QA status is not pass`);

  const reviewPath = reviewerStatusFile(cwd, runId, taskId);
  if (!fs.existsSync(reviewPath)) throw new Error(`Missing Review evidence for task ${taskId}`);
  const review = readJson<AgentStatus>(reviewPath);
  if (review.status !== "approved") throw new Error(`Task ${taskId} Review status is not approved`);
}

function orderedTasks(graph: TaskGraph, taskIds: string[]): TaskGraphTask[] {
  const selected = new Set(taskIds);
  const result: TaskGraphTask[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(task: TaskGraphTask): void {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) throw new Error(`Cycle detected around task ${task.id}`);
    visiting.add(task.id);
    for (const dep of task.depends_on) {
      if (selected.has(dep)) visit(taskById(graph, dep));
    }
    visiting.delete(task.id);
    visited.add(task.id);
    result.push(task);
  }

  for (const taskId of taskIds) visit(taskById(graph, taskId));
  return result;
}

function executableVerificationCommands(task: TaskGraphTask): string[] {
  return task.verification.filter((command) => {
    const normalized = command.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.includes("unknown")) return false;
    if (normalized === "documentation review") return false;
    return true;
  });
}

function matchesScope(file: string, scope: string): boolean {
  const escaped = scope.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replaceAll("**", ":::DOUBLE_STAR:::").replaceAll("*", "[^/]*").replaceAll(":::DOUBLE_STAR:::", ".*");
  return new RegExp(`^${pattern}$`).test(file);
}

function validateResolvedRunScope(runWorktree: string, tasks: TaskGraphTask[]): string[] {
  const changed = runGit(runWorktree, ["diff", "--cached", "--name-only", "HEAD"])
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowedScopes = tasks.flatMap((task) => task.write_scope);
  return changed.filter((file) => !allowedScopes.some((scope) => matchesScope(file, scope)));
}

function commitMessage(runId: string, tasks: TaskGraphTask[], mode: CommitMode, runtimeVerification: RuntimeVerification[]): string {
  const subject = mode === "task" && tasks.length === 1
    ? tasks[0].commit.message
    : `chore(imfine): integrate ${tasks.map((task) => task.id).join(", ")}`;

  const verificationLines = tasks.flatMap((task) => {
    const results = runtimeVerification.filter((result) => result.taskId === task.id);
    if (results.length === 0) {
      return [`- ${task.id}: QA pass, Review approved, no executable run-branch verification command`];
    }
    return results.map((result) => `- ${task.id}: ${result.command} -> exit ${result.code}`);
  });

  return [
    subject,
    "",
    `Run: ${runId}`,
    `Tasks: ${tasks.map((task) => task.id).join(", ")}`,
    `Mode: ${mode}`,
    "",
    "Verification:",
    ...verificationLines,
    "",
    "Evidence:",
    `- QA: .imfine/runs/${runId}/evidence/test-results.md`,
    `- Review: .imfine/runs/${runId}/evidence/review.md`
  ].join("\n");
}

function ensureCleanRunWorktree(runWorktree: string): void {
  const status = runGit(runWorktree, ["status", "--porcelain"]);
  if (status.trim()) {
    throw new Error(`Run worktree has uncommitted changes: ${runWorktree}`);
  }
}

function runMetadata(cwd: string, runId: string): RunMetadata {
  return readJson<RunMetadata>(path.join(runDir(cwd, runId), "run.json"));
}

function syncDirectory(source: string, target: string, preserve: Set<string>): void {
  const sourceEntries = new Set(fs.readdirSync(source, { withFileTypes: true }).map((entry) => entry.name));

  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (preserve.has(entry.name)) continue;
    if (!sourceEntries.has(entry.name)) {
      fs.rmSync(path.join(target, entry.name), { recursive: true, force: true });
    }
  }

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (preserve.has(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      syncDirectory(sourcePath, targetPath, new Set());
      continue;
    }
    if (entry.isSymbolicLink()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function finalizeWorkspaceIfNeeded(cwd: string, runId: string, runBranch: string, runWorktree: string): void {
  const metadata = runMetadata(cwd, runId);
  if (metadata.project_kind !== "new_project") return;

  syncDirectory(runWorktree, cwd, new Set([".git", ".imfine"]));
  updateRun(cwd, runId, "committing", {
    finalized_at: new Date().toISOString(),
    finalized_branch: runBranch,
    finalized_from_worktree: runWorktree,
    finalized_to_cwd: cwd
  });
}

function applyPatch(runWorktree: string, patch: string, taskId: string): void {
  const check = optionalGit(runWorktree, ["apply", "--check", patch]);
  if (check.code !== 0) {
    throw new Error(check.stderr || `Patch for task ${taskId} cannot be applied cleanly`);
  }
  runGit(runWorktree, ["apply", "--index", patch]);
}

function recordConflictResolverHandoff(cwd: string, runId: string, task: TaskGraphTask, mode: CommitMode, runBranch: string, runWorktree: string, patch: string, reason: string): void {
  const dir = runDir(cwd, runId);
  const agentDir = path.join(dir, "agents", "conflict-resolver");
  const evidence = evidenceFile(cwd, runId, "conflicts.md");
  const now = new Date().toISOString();
  ensureDir(agentDir);

  appendEvidence(evidence, "Conflict Evidence", `## ${task.id}\n\n- detected_at: ${now}\n- mode: ${mode}\n- run_branch: ${runBranch}\n- run_worktree: ${runWorktree}\n- patch: ${patch}\n- reason: ${reason.trim() || "patch cannot be applied cleanly"}`);

  writeText(path.join(agentDir, "input.md"), `# Conflict Resolver Input\n\n## Run\n\n- run: ${runId}\n- branch: ${runBranch}\n- worktree: ${runWorktree}\n- mode: ${mode}\n\n## Blocked Task\n\n- id: ${task.id}\n- title: ${task.title}\n- write scope: ${task.write_scope.join(", ")}\n- patch: ${patch}\n\n## Reason\n\n${reason.trim() || "Patch cannot be applied cleanly."}\n\n## Required Output\n\n- Resolve conflicts in the run worktree without expanding task write boundaries.\n- Re-run verification for affected tasks.\n- Request Review again before \`imfine commit resolved ${runId}\`.\n`);

  writeText(path.join(agentDir, "status.json"), `${JSON.stringify({
    run_id: runId,
    task_id: task.id,
    status: "ready",
    detected_at: now,
    mode,
    evidence
  }, null, 2)}\n`);

  writeText(path.join(agentDir, "handoff.json"), `${JSON.stringify({
    schema_version: 1,
    from: "runtime-commit",
    to: "conflict-resolver",
    run_id: runId,
    task_id: task.id,
    status: "needs_conflict_resolution",
    reason: reason.trim() || "patch cannot be applied cleanly",
    inputs: {
      patch,
      evidence,
      run_worktree: runWorktree,
      run_branch: runBranch
    },
    next_runtime_action: `imfine commit resolved ${runId} ${task.id}`
  }, null, 2)}\n`);

  updateTask(cwd, runId, task.id, "needs_conflict_resolution", {
    conflict_detected_at: now,
    conflict_evidence: evidence,
    conflict_resolver_input: path.join(agentDir, "input.md")
  });
  updateRun(cwd, runId, "needs_conflict_resolution", {
    conflict_detected_at: now,
    conflict_task_id: task.id,
    conflict_evidence: evidence,
    conflict_resolver_input: path.join(agentDir, "input.md"),
    run_branch: runBranch,
    run_worktree: runWorktree
  });
}

function applyPatchOrRecordConflict(cwd: string, runId: string, task: TaskGraphTask, mode: CommitMode, runBranch: string, runWorktree: string): void {
  const patch = patchFile(cwd, runId, task.id);
  try {
    applyPatch(runWorktree, patch, task.id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    recordConflictResolverHandoff(cwd, runId, task, mode, runBranch, runWorktree, patch, reason);
    throw new Error(`Task ${task.id} requires Conflict Resolver before commit: ${reason}`);
  }
}

function runPreCommitVerification(cwd: string, runId: string, runWorktree: string, tasks: TaskGraphTask[], evidence: string): RuntimeVerification[] {
  const results: RuntimeVerification[] = [];
  const failures: string[] = [];

  for (const task of tasks) {
    for (const command of executableVerificationCommands(task)) {
      const result = runShellCommand(command, runWorktree);
      results.push({ taskId: task.id, command, code: result.code });
      if (result.code !== 0) failures.push(`${task.id}: ${command}`);
    }
  }

  appendEvidence(evidence, "Commit Evidence", `## Run Branch Verification\n\n- worktree: ${runWorktree}\n- status: ${failures.length === 0 ? "pass" : "fail"}\n\n${results.length > 0 ? results.map((result) => `- ${result.taskId}: \`${result.command}\` -> exit ${result.code}`).join("\n") : "- no executable commands"}`);

  if (failures.length > 0) {
    updateRun(cwd, runId, "blocked", {
      commit_blocked_at: new Date().toISOString(),
      commit_blocked_reason: "run_branch_verification_failed",
      commit_blocked_commands: failures
    });
    throw new Error(`Run branch verification failed before commit: ${failures.join(", ")}`);
  }

  return results;
}

function createCommit(runWorktree: string, message: string): string {
  runGit(runWorktree, ["commit", "-m", message]);
  return runGit(runWorktree, ["rev-parse", "HEAD"]);
}

export function commitTask(cwd: string, runId: string, taskId: string): CommitResult {
  return commitRun(cwd, runId, "task", [taskId]);
}

export function commitRun(cwd: string, runId: string, mode: CommitMode, taskIds?: string[]): CommitResult {
  const graph = readGraph(cwd, runId);
  const selectedTaskIds = taskIds && taskIds.length > 0 ? taskIds : graph.tasks.map((task) => task.id);
  const tasks = orderedTasks(graph, selectedTaskIds);
  for (const task of tasks) requireReadyToCommit(cwd, runId, task.id);

  const { runBranch, runWorktree } = ensureRunWorktree(cwd, runId);
  ensureCleanRunWorktree(runWorktree);

  const evidence = evidenceFile(cwd, runId, "commits.md");
  const commits: CommitRecord[] = [];

  if (mode === "task") {
    for (const task of tasks) {
      applyPatchOrRecordConflict(cwd, runId, task, "task", runBranch, runWorktree);
      const runtimeVerification = runPreCommitVerification(cwd, runId, runWorktree, [task], evidence);
      const message = commitMessage(runId, [task], "task", runtimeVerification);
      const hash = createCommit(runWorktree, message);
      commits.push({ taskIds: [task.id], hash, message });
      updateTask(cwd, runId, task.id, "committed", { commit_hash: hash, commit_mode: "task" });
      appendEvidence(evidence, "Commit Evidence", `## ${task.id}\n\n- mode: task\n- hash: ${hash}\n- branch: ${runBranch}\n- worktree: ${runWorktree}\n- message: ${task.commit.message}`);
    }
  } else {
    for (const task of tasks) applyPatchOrRecordConflict(cwd, runId, task, "integration", runBranch, runWorktree);
    const runtimeVerification = runPreCommitVerification(cwd, runId, runWorktree, tasks, evidence);
    const message = commitMessage(runId, tasks, "integration", runtimeVerification);
    const hash = createCommit(runWorktree, message);
    commits.push({ taskIds: tasks.map((task) => task.id), hash, message });
    for (const task of tasks) updateTask(cwd, runId, task.id, "committed", { commit_hash: hash, commit_mode: "integration" });
    appendEvidence(evidence, "Commit Evidence", `## Integration Commit\n\n- mode: integration\n- hash: ${hash}\n- branch: ${runBranch}\n- worktree: ${runWorktree}\n- tasks: ${tasks.map((task) => task.id).join(", ")}\n- message: ${message.split("\n")[0]}`);
  }

  updateRun(cwd, runId, "committing", {
    committed_at: new Date().toISOString(),
    run_branch: runBranch,
    run_worktree: runWorktree,
    commit_hashes: commits.map((commit) => commit.hash)
  });
  finalizeWorkspaceIfNeeded(cwd, runId, runBranch, runWorktree);
  refreshOrchestrationSnapshot(cwd, runId);

  return {
    runId,
    mode,
    runBranch,
    runWorktree,
    commits,
    evidence,
    status: "committed"
  };
}

export function commitResolvedRun(cwd: string, runId: string, taskIds?: string[]): CommitResult {
  const graph = readGraph(cwd, runId);
  const selectedTaskIds = taskIds && taskIds.length > 0 ? taskIds : graph.tasks.map((task) => task.id);
  const tasks = orderedTasks(graph, selectedTaskIds);
  for (const task of tasks) requireReadyToCommit(cwd, runId, task.id);

  const { runBranch, runWorktree } = ensureRunWorktree(cwd, runId);
  const status = runGit(runWorktree, ["status", "--porcelain"]);
  if (!status.trim()) {
    throw new Error(`Run worktree has no resolved changes to commit: ${runWorktree}`);
  }

  runGit(runWorktree, ["add", "-A"]);
  const scopeViolations = validateResolvedRunScope(runWorktree, tasks);
  if (scopeViolations.length > 0) {
    updateRun(cwd, runId, "blocked", {
      commit_blocked_at: new Date().toISOString(),
      commit_blocked_reason: "conflict_resolution_outside_write_scope",
      commit_blocked_files: scopeViolations
    });
    throw new Error(`Conflict Resolver changed files outside write_scope: ${scopeViolations.join(", ")}`);
  }
  const evidence = evidenceFile(cwd, runId, "commits.md");
  const runtimeVerification = runPreCommitVerification(cwd, runId, runWorktree, tasks, evidence);
  const message = commitMessage(runId, tasks, "integration", runtimeVerification);
  const hash = createCommit(runWorktree, message);
  const commits = [{ taskIds: tasks.map((task) => task.id), hash, message }];
  for (const task of tasks) updateTask(cwd, runId, task.id, "committed", { commit_hash: hash, commit_mode: "integration", resolved_by: "conflict_resolver" });

  appendEvidence(evidence, "Commit Evidence", `## Conflict Resolver Integration Commit\n\n- mode: integration\n- hash: ${hash}\n- branch: ${runBranch}\n- worktree: ${runWorktree}\n- tasks: ${tasks.map((task) => task.id).join(", ")}\n- resolved_by: conflict_resolver\n- message: ${message.split("\n")[0]}`);

  updateRun(cwd, runId, "committing", {
    committed_at: new Date().toISOString(),
    run_branch: runBranch,
    run_worktree: runWorktree,
    commit_hashes: [hash],
    conflict_resolved_at: new Date().toISOString()
  });
  finalizeWorkspaceIfNeeded(cwd, runId, runBranch, runWorktree);
  refreshOrchestrationSnapshot(cwd, runId);

  return {
    runId,
    mode: "integration",
    runBranch,
    runWorktree,
    commits,
    evidence,
    status: "committed"
  };
}

function classifyPushFailure(output: string): PushStatus {
  const lower = output.toLowerCase();
  if (lower.includes("permission denied") || lower.includes("authentication") || lower.includes("access denied")) {
    return "push_blocked_auth";
  }
  if (lower.includes("non-fast-forward") || lower.includes("fetch first") || lower.includes("stale info") || lower.includes("rejected")) {
    return "push_blocked_branch_conflict";
  }
  if (lower.includes("could not resolve host") || lower.includes("network") || lower.includes("timed out") || lower.includes("connection") || lower.includes("temporary failure")) {
    return "push_blocked_network";
  }
  return "push_blocked_failed";
}

function userActionForPush(status: PushStatus, runBranch: string): string {
  if (status === "push_blocked_no_remote") return "Configure origin remote, then resume imfine so runtime can push the run branch.";
  if (status === "push_blocked_auth") return "Fix git credentials or repository permissions, then resume imfine.";
  if (status === "push_blocked_branch_conflict") return `Let Orchestrator choose rebase, rename, or block for ${runBranch}; do not manually overwrite remote history.`;
  if (status === "push_blocked_network") return "Retry when network access is available; runtime already used limited retry.";
  if (status === "push_blocked_failed") return "Inspect push evidence and let Orchestrator decide whether retry, rename, or credentials repair is needed.";
  return "none";
}

export function pushRun(cwd: string, runId: string): PushResult {
  const { runBranch, runWorktree } = ensureRunWorktree(cwd, runId);
  const evidence = evidenceFile(cwd, runId, "push.md");
  const remoteProbe = optionalGit(runWorktree, ["remote", "get-url", "origin"]);
  const localHead = optionalGit(runWorktree, ["rev-parse", "HEAD"]).stdout || "unknown";

  if (remoteProbe.code !== 0 || !remoteProbe.stdout) {
    const status: PushStatus = "push_blocked_no_remote";
    const output = remoteProbe.stderr || "origin remote is not configured";
    appendEvidence(evidence, "Push Evidence", `## ${runBranch}\n\n- status: ${status}\n- remote: origin\n- local commit: ${localHead}\n- user action: ${userActionForPush(status, runBranch)}\n- output: ${output}`);
    updateRun(cwd, runId, "blocked", { push_status: status, push_blocked_at: new Date().toISOString(), run_branch: runBranch, run_worktree: runWorktree, push_user_action: userActionForPush(status, runBranch), push_local_commit: localHead });
    refreshOrchestrationSnapshot(cwd, runId);
    return { runId, runBranch, runWorktree, remote: "origin", status, evidence, output };
  }

  let pushed = optionalGit(runWorktree, ["push", "origin", runBranch]);
  const output = [pushed.stdout, pushed.stderr, pushed.error].filter(Boolean).join("\n");
  if (pushed.code === 0) {
    appendEvidence(evidence, "Push Evidence", `## ${runBranch}\n\n- status: pushed\n- remote: ${remoteProbe.stdout}\n- local commit: ${localHead}\n- output: ${output || "ok"}`);
    updateRun(cwd, runId, "pushing", { push_status: "pushed", pushed_at: new Date().toISOString(), run_branch: runBranch, run_worktree: runWorktree });
    refreshOrchestrationSnapshot(cwd, runId);
    return { runId, runBranch, runWorktree, remote: remoteProbe.stdout, status: "pushed", evidence, output };
  }

  let status = classifyPushFailure(output);
  let finalOutput = output;
  if (status === "push_blocked_network") {
    for (let attempt = 2; attempt <= 3; attempt += 1) {
      pushed = optionalGit(runWorktree, ["push", "origin", runBranch]);
      finalOutput = [finalOutput, `\nretry ${attempt}:`, pushed.stdout, pushed.stderr, pushed.error].filter(Boolean).join("\n");
      if (pushed.code === 0) {
        appendEvidence(evidence, "Push Evidence", `## ${runBranch}\n\n- status: pushed\n- remote: ${remoteProbe.stdout}\n- local commit: ${localHead}\n- retries: ${attempt - 1}\n- output: ${finalOutput || "ok"}`);
        updateRun(cwd, runId, "pushing", { push_status: "pushed", pushed_at: new Date().toISOString(), run_branch: runBranch, run_worktree: runWorktree });
        refreshOrchestrationSnapshot(cwd, runId);
        return { runId, runBranch, runWorktree, remote: remoteProbe.stdout, status: "pushed", evidence, output: finalOutput };
      }
      status = classifyPushFailure([pushed.stdout, pushed.stderr, pushed.error].filter(Boolean).join("\n"));
      if (status !== "push_blocked_network") break;
    }
  }
  appendEvidence(evidence, "Push Evidence", `## ${runBranch}\n\n- status: ${status}\n- remote: ${remoteProbe.stdout}\n- local commit: ${localHead}\n- user action: ${userActionForPush(status, runBranch)}\n- output: ${finalOutput || "push failed"}`);
  updateRun(cwd, runId, "blocked", { push_status: status, push_blocked_at: new Date().toISOString(), run_branch: runBranch, run_worktree: runWorktree, push_user_action: userActionForPush(status, runBranch), push_local_commit: localHead });
  refreshOrchestrationSnapshot(cwd, runId);
  return { runId, runBranch, runWorktree, remote: remoteProbe.stdout, status, evidence, output: finalOutput };
}
