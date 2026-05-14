import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateHandoff, type HandoffRole } from "./handoff-validator.js";
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

interface RuntimeVerification {
  taskId: string;
  command: string;
  code: number | null;
}

interface StatusLine {
  code: string;
  file: string;
}

interface MergeAgentHandoff {
  status: "ready" | "blocked";
  mergedFiles: string[];
  evidence: string[];
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

function statusLines(cwd: string): StatusLine[] {
  return runGit(cwd, ["status", "--porcelain"])
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2),
      file: line.slice(3).trim()
    }));
}

function isRuntimeOwnedStatusFile(file: string): boolean {
  return file === ".imfine" || file.startsWith(".imfine/");
}

function nonRuntimeOwnedStatusLines(cwd: string): StatusLine[] {
  return statusLines(cwd).filter((line) => !isRuntimeOwnedStatusFile(line.file));
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
  const runWorktree = cwd;
  const currentBranch = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);

  if (currentBranch !== runBranch) {
    const dirty = nonRuntimeOwnedStatusLines(cwd);
    if (dirty.length > 0) {
      throw new Error(`Current project directory has uncommitted source changes and cannot switch to ${runBranch}: ${dirty.map((line) => line.file).join(", ")}`);
    }

    const branchExists = optionalGit(cwd, ["rev-parse", "--verify", runBranch]).code === 0;
    if (branchExists) {
      runGit(cwd, ["checkout", runBranch]);
    } else {
      runGit(cwd, ["checkout", "-b", runBranch]);
    }
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

function handoffFile(cwd: string, runId: string, role: "qa" | "reviewer", taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `${role}-${taskId}`, "handoff.json");
}

function mergeHandoffFile(cwd: string, runId: string, taskId: string): string {
  return path.join(runDir(cwd, runId), "agents", `merge-agent-${taskId}`, "handoff.json");
}

function committerHandoffFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "agents", "committer", "handoff.json");
}

function requireCommitterHandoff(cwd: string, runId: string): void {
  const file = committerHandoffFile(cwd, runId);
  if (!fs.existsSync(file)) throw new Error("Missing committer handoff for run commit");
  const parsed = readJson<unknown>(file);
  const validation = validateHandoff("committer", parsed, runId);
  if (!validation.passed) throw new Error(`Invalid committer handoff for run commit: ${validation.errors.join("; ")}`);
  if ((parsed as { status?: unknown }).status !== "ready") throw new Error("Committer handoff is not ready");
}

function requireValidatedHandoff(cwd: string, runId: string, role: HandoffRole, taskId: string): void {
  const file = handoffFile(cwd, runId, role as "qa" | "reviewer", taskId);
  if (!fs.existsSync(file)) throw new Error(`Missing ${role} handoff for task ${taskId}`);
  const parsed = readJson<unknown>(file);
  const validation = validateHandoff(role, parsed, runId, taskId);
  if (!validation.passed) throw new Error(`Invalid ${role} handoff for task ${taskId}: ${validation.errors.join("; ")}`);
  const evidence = (parsed as { evidence?: unknown[] }).evidence || [];
  for (const item of evidence) {
    if (typeof item !== "string" || !fs.existsSync(item)) {
      throw new Error(`Missing ${role} evidence for task ${taskId}: ${String(item)}`);
    }
  }
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
  requireValidatedHandoff(cwd, runId, "qa", taskId);

  const reviewPath = reviewerStatusFile(cwd, runId, taskId);
  if (!fs.existsSync(reviewPath)) throw new Error(`Missing Review evidence for task ${taskId}`);
  const review = readJson<AgentStatus>(reviewPath);
  if (review.status !== "approved") throw new Error(`Task ${taskId} Review status is not approved`);
  requireValidatedHandoff(cwd, runId, "reviewer", taskId);

  const mergePath = mergeHandoffFile(cwd, runId, taskId);
  if (!fs.existsSync(mergePath)) throw new Error(`Missing Merge Agent handoff for task ${taskId}`);
  const mergeHandoff = readJson<unknown>(mergePath);
  const mergeValidation = validateHandoff("merge-agent", mergeHandoff, runId, taskId);
  if (!mergeValidation.passed) throw new Error(`Invalid Merge Agent handoff for task ${taskId}: ${mergeValidation.errors.join("; ")}`);
  const mergeStatus = (mergeHandoff as { status?: unknown }).status;
  if (mergeStatus !== "ready") throw new Error(`Task ${taskId} Merge Agent status is not ready`);
  const mergeEvidence = (mergeHandoff as { evidence?: unknown[] }).evidence || [];
  for (const item of mergeEvidence) {
    if (typeof item !== "string" || !fs.existsSync(item)) {
      throw new Error(`Missing Merge Agent evidence for task ${taskId}: ${String(item)}`);
    }
  }
}

function readMergeAgentHandoff(cwd: string, runId: string, taskId: string): MergeAgentHandoff {
  const file = mergeHandoffFile(cwd, runId, taskId);
  if (!fs.existsSync(file)) throw new Error(`Missing Merge Agent handoff for task ${taskId}`);
  const payload = readJson<Record<string, unknown>>(file);
  const validation = validateHandoff("merge-agent", payload, runId, taskId);
  if (!validation.passed) throw new Error(`Invalid Merge Agent handoff for task ${taskId}: ${validation.errors.join("; ")}`);
  if (payload.status !== "ready") throw new Error(`Task ${taskId} Merge Agent status is not ready`);
  const mergedFiles = Array.isArray(payload.merged_files)
    ? payload.merged_files.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (mergedFiles.length === 0) throw new Error(`Task ${taskId} Merge Agent merged_files is empty`);
  const evidence = Array.isArray(payload.evidence)
    ? payload.evidence.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return {
    status: "ready",
    mergedFiles,
    evidence
  };
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

function changedSourceFiles(runWorktree: string): string[] {
  runGit(runWorktree, ["add", "-N", "."]);
  return runGit(runWorktree, ["diff", "--name-only", "HEAD"])
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => Boolean(item) && !isRuntimeOwnedStatusFile(item));
}

function validateResolvedRunScope(changed: string[], tasks: TaskGraphTask[]): string[] {
  const allowedScopes = tasks.flatMap((task) => task.write_scope);
  return changed.filter((file) => !allowedScopes.some((scope) => matchesScope(file, scope)));
}

function validateDeclaredMergedFiles(changed: string[], declared: string[]): { undeclared: string[]; declaredButUnchanged: string[] } {
  const changedSet = new Set(changed);
  const declaredSet = new Set(declared);
  return {
    undeclared: changed.filter((file) => !declaredSet.has(file)),
    declaredButUnchanged: declared.filter((file) => !changedSet.has(file))
  };
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

function ensureNoUntrackedRunFiles(runWorktree: string): void {
  const status = nonRuntimeOwnedStatusLines(runWorktree);
  const untracked = status.filter((line) => line.code === "??");
  if (untracked.length > 0) {
    throw new Error(`Run worktree has untracked source files before commit: ${untracked.map((line) => line.file).join(", ")}`);
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

function stageFiles(runWorktree: string, files: string[]): void {
  if (files.length === 0) throw new Error("No merged source files were provided for commit staging");
  runGit(runWorktree, ["add", "--", ...files]);
}

function createCommit(runWorktree: string, message: string): string {
  runGit(runWorktree, ["commit", "-m", message]);
  return runGit(runWorktree, ["rev-parse", "HEAD"]);
}

export function commitTask(cwd: string, runId: string, taskId: string): CommitResult {
  return commitRun(cwd, runId, "task", [taskId]);
}

export function commitRun(cwd: string, runId: string, mode: CommitMode, taskIds?: string[]): CommitResult {
  requireCommitterHandoff(cwd, runId);
  const graph = readGraph(cwd, runId);
  const selectedTaskIds = taskIds && taskIds.length > 0 ? taskIds : graph.tasks.map((task) => task.id);
  const tasks = orderedTasks(graph, selectedTaskIds);
  for (const task of tasks) requireReadyToCommit(cwd, runId, task.id);
  const mergeHandoffs = new Map(tasks.map((task) => [task.id, readMergeAgentHandoff(cwd, runId, task.id)]));

  const { runBranch, runWorktree } = ensureRunWorktree(cwd, runId);
  ensureNoUntrackedRunFiles(runWorktree);

  const evidence = evidenceFile(cwd, runId, "commits.md");
  const commits: CommitRecord[] = [];

  if (mode === "task") {
    for (const task of tasks) {
      const changed = changedSourceFiles(runWorktree);
      const merge = mergeHandoffs.get(task.id);
      if (!merge) throw new Error(`Missing Merge Agent handoff cache for task ${task.id}`);
      const declared = validateDeclaredMergedFiles(changed, merge.mergedFiles);
      if (declared.undeclared.length > 0) {
        updateRun(cwd, runId, "blocked", {
          commit_blocked_at: new Date().toISOString(),
          commit_blocked_reason: "merge_agent_undeclared_files",
          commit_blocked_files: declared.undeclared,
          commit_blocked_task: task.id
        });
        throw new Error(`Merge Agent changed files without declaring them for ${task.id}: ${declared.undeclared.join(", ")}`);
      }
      if (declared.declaredButUnchanged.length > 0) {
        updateRun(cwd, runId, "blocked", {
          commit_blocked_at: new Date().toISOString(),
          commit_blocked_reason: "merge_agent_declared_but_unchanged_files",
          commit_blocked_files: declared.declaredButUnchanged,
          commit_blocked_task: task.id
        });
        throw new Error(`Merge Agent declared unchanged files for ${task.id}: ${declared.declaredButUnchanged.join(", ")}`);
      }
      const scopeViolations = validateResolvedRunScope(merge.mergedFiles, [task]);
      if (scopeViolations.length > 0) {
        updateRun(cwd, runId, "blocked", {
          commit_blocked_at: new Date().toISOString(),
          commit_blocked_reason: "merge_agent_outside_write_scope",
          commit_blocked_files: scopeViolations
        });
        throw new Error(`Merge Agent changed files outside write_scope for ${task.id}: ${scopeViolations.join(", ")}`);
      }
      stageFiles(runWorktree, merge.mergedFiles);
      const runtimeVerification = runPreCommitVerification(cwd, runId, runWorktree, [task], evidence);
      const message = commitMessage(runId, [task], "task", runtimeVerification);
      const hash = createCommit(runWorktree, message);
      commits.push({ taskIds: [task.id], hash, message });
      updateTask(cwd, runId, task.id, "committed", { commit_hash: hash, commit_mode: "task" });
      appendEvidence(evidence, "Commit Evidence", `## ${task.id}\n\n- mode: task\n- hash: ${hash}\n- branch: ${runBranch}\n- worktree: ${runWorktree}\n- message: ${task.commit.message}`);
    }
  } else {
    const changed = changedSourceFiles(runWorktree);
    const mergedFiles = Array.from(new Set(tasks.flatMap((task) => {
      const merge = mergeHandoffs.get(task.id);
      return merge ? merge.mergedFiles : [];
    })));
    const declared = validateDeclaredMergedFiles(changed, mergedFiles);
    if (declared.undeclared.length > 0) {
      updateRun(cwd, runId, "blocked", {
        commit_blocked_at: new Date().toISOString(),
        commit_blocked_reason: "merge_agent_undeclared_files",
        commit_blocked_files: declared.undeclared
      });
      throw new Error(`Merge Agent changed files without declaring them: ${declared.undeclared.join(", ")}`);
    }
    if (declared.declaredButUnchanged.length > 0) {
      updateRun(cwd, runId, "blocked", {
        commit_blocked_at: new Date().toISOString(),
        commit_blocked_reason: "merge_agent_declared_but_unchanged_files",
        commit_blocked_files: declared.declaredButUnchanged
      });
      throw new Error(`Merge Agent declared unchanged files: ${declared.declaredButUnchanged.join(", ")}`);
    }
    const scopeViolations = validateResolvedRunScope(mergedFiles, tasks);
    if (scopeViolations.length > 0) {
      updateRun(cwd, runId, "blocked", {
        commit_blocked_at: new Date().toISOString(),
        commit_blocked_reason: "merge_agent_outside_write_scope",
        commit_blocked_files: scopeViolations
      });
      throw new Error(`Merge Agent changed files outside merged write_scope: ${scopeViolations.join(", ")}`);
    }
    stageFiles(runWorktree, mergedFiles);
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
