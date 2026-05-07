import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "imfine.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-smoke-"));
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-home-"));
const realTmp = fs.realpathSync(tmp);

function run(args, cwd = tmp, extraEnv = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: tempHome, ...extraEnv },
    encoding: "utf8"
  });
}

function runExpectFail(args, cwd = tmp, extraEnv = {}) {
  try {
    run(args, cwd, extraEnv);
  } catch (error) {
    return `${error.stdout || ""}${error.stderr || ""}`;
  }
  throw new Error(`Expected command to fail: ${args.join(" ")}`);
}

const doctor = JSON.parse(run(["doctor", "--json"]));
assert.equal(fs.realpathSync(doctor.cwd), realTmp);
assert.ok(Array.isArray(doctor.checks));
assert.ok(doctor.checks.some((item) => item.id === "provider.codex.bridge"));
assert.ok(doctor.checks.some((item) => item.id === "provider.claude.bridge"));
assert.ok(doctor.checks.some((item) => item.id === "provider.codex.entry_installed"));
assert.ok(doctor.checks.some((item) => item.id === "provider.codex.session_orchestrator"));
assert.ok(doctor.checks.some((item) => item.id === "provider.codex.subagent_supported" && item.detail.includes("subagent_supported=unknown")));
assert.ok(doctor.checks.some((item) => item.id === "provider.claude.entry_installed"));
assert.ok(doctor.checks.some((item) => item.id === "provider.claude.session_orchestrator"));
assert.ok(doctor.checks.some((item) => item.id === "provider.claude.subagent_supported" && item.detail.includes("subagent_supported=unknown")));

const init = JSON.parse(run(["init", "--json"]));
assert.equal(fs.realpathSync(path.dirname(init.workspace)), realTmp);
assert.equal(init.projectMode, "empty");
assert.equal(init.architecture.mode, "empty");
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "config.yaml")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "project", "overview.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "project", "architecture")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "project", "capabilities", ".gitkeep")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "runs", ".gitkeep")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "reports", ".gitkeep")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "state", "current.json")));
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(tmp, ".imfine", "state", "locks.json"), "utf8")).locks, {});
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "orchestrator.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "intake.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "architect.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "task-planner.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "dev.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "qa.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "reviewer.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "archive.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "agents", "committer.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "skills", "clarify.md")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "templates", "handoff.schema.json")));
assert.ok(fs.existsSync(path.join(tmp, ".imfine", "library.md")));

const status = JSON.parse(run(["status", "--json"]));
assert.equal(status.initialized, true);
assert.equal(status.currentRunId, null);
assert.equal(status.currentRunStatus, null);
assert.equal(status.currentRunBranch, null);

const agents = JSON.parse(run(["agents", "list", "--json"]));
assert.ok(agents.some((item) => item.id === "orchestrator"));
assert.ok(agents.some((item) => item.id === "task-planner"));
assert.ok(agents.some((item) => item.id === "conflict-resolver"));
assert.ok(agents.some((item) => item.id === "committer"));

const orchestrator = run(["agents", "show", "orchestrator"]);
assert.match(orchestrator, /Handoff Schema/);

const skills = JSON.parse(run(["skills", "list", "--json"]));
assert.ok(skills.some((item) => item.id === "code-review"));

const templates = JSON.parse(run(["templates", "list", "--json"]));
assert.ok(templates.some((item) => item.id === "handoff.schema"));

const sync = JSON.parse(run(["library", "sync", "--json"]));
assert.equal(fs.realpathSync(path.dirname(sync.workspace)), realTmp);

const delivery = JSON.parse(run(["run", "Build a todo app", "--plan-only", "--json"]));
assert.equal(delivery.status, "planned");
assert.equal(delivery.projectKind, "new_project");
assert.ok(fs.existsSync(path.join(delivery.runDir, "run.json")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "request", "normalized.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "analysis", "project-context.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "analysis", "requirement-analysis.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "analysis", "impact-analysis.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "analysis", "risk-analysis.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "analysis", "product-analysis.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "design", "solution-design.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "design", "architecture-decisions.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "design", "technical-solution.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "design", "acceptance.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "planning", "task-graph.json")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "planning", "ownership.json")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "planning", "execution-plan.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "planning", "commit-plan.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "spec-delta", "proposal.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "spec-delta", "design.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "spec-delta", "tasks.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "tasks", "T1", "task.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "tasks", "T1", "dev-plan.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "tasks", "T1", "test-plan.md")));
assert.ok(fs.existsSync(path.join(delivery.runDir, "tasks", "T1", "review-plan.md")));
const taskGraph = JSON.parse(fs.readFileSync(path.join(delivery.runDir, "planning", "task-graph.json"), "utf8"));
assert.equal(taskGraph.run_id, delivery.runId);
assert.equal(taskGraph.strategy, "parallel");
assert.ok(taskGraph.tasks.length > 0);
for (const task of taskGraph.tasks) {
  assert.ok(task.read_scope.length > 0);
  assert.ok(task.write_scope.length > 0);
  assert.ok(task.dev_plan.length > 0);
  assert.ok(task.test_plan.length > 0);
  assert.ok(task.review_plan.length > 0);
  assert.ok(task.commit.message);
}
assert.match(fs.readFileSync(path.join(delivery.runDir, "analysis", "project-context.md"), "utf8"), /unknown/);

const statusAfterRun = JSON.parse(run(["status", "--json"]));
assert.equal(statusAfterRun.currentRunId, delivery.runId);
assert.equal(statusAfterRun.currentRunStatus, "planned");
const resumedPlan = JSON.parse(run(["resume", delivery.runId, "--json"]));
assert.equal(resumedPlan.mode, "resume");
assert.equal(resumedPlan.runId, delivery.runId);
assert.ok(resumedPlan.nextActions.some((action) => action.id === "runtime-worktree-prepare"));
assert.ok(fs.existsSync(resumedPlan.files.state));
assert.ok(fs.existsSync(resumedPlan.files.queue));
assert.ok(fs.existsSync(resumedPlan.files.infrastructureGate));
assert.ok(fs.existsSync(resumedPlan.files.agentRuns));
assert.ok(fs.existsSync(resumedPlan.files.parallelPlan));
assert.ok(fs.existsSync(resumedPlan.files.timeline));
const resumedQueue = JSON.parse(fs.readFileSync(resumedPlan.files.queue, "utf8"));
assert.equal(resumedQueue.run_id, delivery.runId);
assert.ok(resumedQueue.actions.length > 0);
const blockedGate = JSON.parse(run(["resume", delivery.runId, "--json"], tmp, { PATH: "/nonexistent" }));
assert.ok(blockedGate.nextActions.some((action) => action.id === "gate-infrastructure"));
assert.ok(fs.existsSync(path.join(delivery.runDir, "evidence", "infrastructure.md")));

const planValidation = JSON.parse(run(["plan", "validate", delivery.runId, "--json"]));
assert.equal(planValidation.passed, true);
assert.deepEqual(planValidation.serialTasks, ["T2"]);
const taskGraphValidation = JSON.parse(run(["task", "graph", "validate", delivery.runId, "--json"]));
assert.equal(taskGraphValidation.passed, true);

const replanned = JSON.parse(run(["plan", delivery.runId, "--json"]));
assert.equal(replanned.validation.passed, true);
assert.equal(replanned.runId, delivery.runId);

const duplicateRun = JSON.parse(run(["run", "Build a todo app", "--plan-only", "--json"]));
assert.notEqual(duplicateRun.runId, delivery.runId);

const requirementFile = path.join(tmp, "requirement.md");
fs.writeFileSync(requirementFile, "Create a CLI calculator");
const fileRun = JSON.parse(run(["run", "requirement.md", "--plan-only", "--json"]));
assert.equal(fileRun.source.type, "file");
assert.equal(fileRun.projectKind, "new_project");
assert.equal(fileRun.status, "planned");

const existingProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-existing-"));
fs.writeFileSync(path.join(existingProject, "package.json"), JSON.stringify({
  scripts: {
    test: "node --test",
    build: "tsc"
  }
}, null, 2));
fs.mkdirSync(path.join(existingProject, "src"));
fs.writeFileSync(path.join(existingProject, "src", "index.js"), "export function main() { return true; }\n");
const existingRun = JSON.parse(run(["run", "Add auth", "--plan-only", "--json"], existingProject));
assert.equal(existingRun.projectKind, "existing_project");
assert.equal(existingRun.status, "planned");
const existingContext = fs.readFileSync(path.join(existingRun.runDir, "analysis", "project-context.md"), "utf8");
assert.match(existingContext, /package\.json/);
assert.match(existingContext, /src\/index\.js/);
assert.match(existingContext, /npm run test/);
assert.ok(fs.existsSync(path.join(existingProject, ".imfine", "project", "architecture", "overview.md")));
assert.ok(fs.existsSync(path.join(existingProject, ".imfine", "project", "architecture", "module-tech-stack.md")));
assert.ok(fs.existsSync(path.join(existingProject, ".imfine", "runs", "init", "agents", "architect", "input.md")));
assert.match(fs.readFileSync(path.join(existingProject, ".imfine", "project", "architecture", "overview.md"), "utf8"), /src\/index\.js/);
const existingGraph = JSON.parse(fs.readFileSync(path.join(existingRun.runDir, "planning", "task-graph.json"), "utf8"));
assert.equal(existingGraph.strategy, "serial");
assert.equal(existingGraph.tasks[0].commit.mode, "integration");

const gitProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-git-"));
function git(args) {
  return execFileSync("git", args, {
    cwd: gitProject,
    encoding: "utf8"
  });
}
git(["init"]);
git(["config", "user.email", "imfine@example.test"]);
git(["config", "user.name", "imfine test"]);
fs.writeFileSync(path.join(gitProject, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
fs.mkdirSync(path.join(gitProject, "src"));
fs.writeFileSync(path.join(gitProject, "src", "index.js"), "export const value = 1;\n");
git(["add", "."]);
git(["commit", "-m", "initial"]);

const gitRun = JSON.parse(run(["run", "Add value change", "--plan-only", "--json"], gitProject));
const prepared = JSON.parse(run(["worktree", "prepare", gitRun.runId, "--json"], gitProject));
assert.equal(prepared.runBranch, `imfine/${gitRun.runId}`);
assert.ok(prepared.tasks.length > 0);
const agentPrepared = JSON.parse(run(["agents", "prepare", gitRun.runId, "--json"], gitProject));
assert.equal(agentPrepared.runId, gitRun.runId);
assert.ok(fs.existsSync(agentPrepared.dispatch));
assert.ok(agentPrepared.packages.some((item) => item.id === "T1"));
const t1Package = agentPrepared.packages.find((item) => item.id === "T1");
assert.ok(t1Package);
assert.ok(fs.existsSync(t1Package.prompt));
assert.match(fs.readFileSync(t1Package.prompt, "utf8"), /Dev Agent/);
assert.match(fs.readFileSync(t1Package.skillBundle, "utf8"), /execute-task-plan/);
const agentDryRun = JSON.parse(run(["agents", "execute", gitRun.runId, "--dry-run", "--limit", "1", "--json"], gitProject));
assert.equal(agentDryRun.dryRun, true);
assert.equal(agentDryRun.results.length, 1);
assert.equal(agentDryRun.results[0].status, "dry_run");
const t1 = prepared.tasks.find((task) => task.task_id === "T1");
assert.ok(t1);
assert.ok(fs.existsSync(t1.path));
assert.ok(fs.existsSync(t1.agent_input));
fs.writeFileSync(path.join(t1.path, "src", "index.js"), "export const value = 2;\n");
const validPatch = JSON.parse(run(["patch", "collect", gitRun.runId, "T1", "--json"], gitProject));
assert.equal(validPatch.validation.passed, true);
assert.ok(validPatch.validation.changedFiles.includes("src/index.js"));
assert.ok(fs.existsSync(validPatch.patch));
assert.ok(fs.existsSync(validPatch.commands));
assert.ok(fs.existsSync(validPatch.evidence));
const verified = JSON.parse(run(["verify", gitRun.runId, "T1", "--json"], gitProject));
assert.equal(verified.status, "pass");
assert.ok(fs.existsSync(verified.evidence));
assert.ok(fs.existsSync(path.join(gitRun.runDir, "agents", "qa-T1", "handoff.json")));
const reviewed = JSON.parse(run(["review", gitRun.runId, "T1", "--status", "approved", "--summary", "looks scoped", "--json"], gitProject));
assert.equal(reviewed.status, "approved");
assert.ok(fs.existsSync(reviewed.evidence));
assert.ok(fs.existsSync(path.join(gitRun.runDir, "agents", "reviewer-T1", "handoff.json")));

const t2 = prepared.tasks.find((task) => task.task_id === "T2");
assert.ok(t2);
fs.mkdirSync(path.join(t2.path, "src"), { recursive: true });
fs.writeFileSync(path.join(t2.path, "src", "outside.js"), "export const outside = true;\n");
const invalidPatch = JSON.parse(run(["patch", "collect", gitRun.runId, "T2", "--json"], gitProject));
assert.equal(invalidPatch.validation.passed, false);
assert.ok(invalidPatch.validation.errors.some((error) => error.includes("outside write_scope")));

const riskProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-risk-"));
function riskGit(args) {
  return execFileSync("git", args, {
    cwd: riskProject,
    encoding: "utf8"
  });
}
riskGit(["init"]);
riskGit(["config", "user.email", "imfine@example.test"]);
riskGit(["config", "user.name", "imfine test"]);
fs.writeFileSync(path.join(riskProject, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
fs.writeFileSync(path.join(riskProject, "package-lock.json"), JSON.stringify({ name: "risk-project", lockfileVersion: 3, packages: {} }, null, 2));
riskGit(["add", "."]);
riskGit(["commit", "-m", "initial"]);
const riskRun = JSON.parse(run(["run", "Update lockfile", "--plan-only", "--json"], riskProject));
const riskGraphFile = path.join(riskRun.runDir, "planning", "task-graph.json");
const riskGraph = JSON.parse(fs.readFileSync(riskGraphFile, "utf8"));
riskGraph.tasks = [{
  id: "T1",
  title: "Update dependency lockfile",
  type: "dev",
  depends_on: [],
  read_scope: ["package-lock.json"],
  write_scope: ["package-lock.json"],
  acceptance: ["lockfile updated"],
  dev_plan: ["edit lockfile"],
  test_plan: ["documentation review"],
  review_plan: ["review lockfile risk"],
  verification: ["documentation review"],
  commit: { mode: "task", message: "chore: update lockfile" }
}];
fs.writeFileSync(riskGraphFile, `${JSON.stringify(riskGraph, null, 2)}\n`);
const riskPrepared = JSON.parse(run(["worktree", "prepare", riskRun.runId, "--json"], riskProject));
const riskT1 = riskPrepared.tasks.find((task) => task.task_id === "T1");
assert.ok(riskT1);
fs.writeFileSync(path.join(riskT1.path, "package-lock.json"), JSON.stringify({ name: "risk-project", lockfileVersion: 3, packages: { "": { dependencies: { a: "1.0.0" } } } }, null, 2));
const riskyPatch = JSON.parse(run(["patch", "collect", riskRun.runId, "T1", "--json"], riskProject));
assert.equal(riskyPatch.validation.passed, true);
assert.ok(riskyPatch.validation.risks.some((risk) => risk.reason.includes("lockfile")));
assert.ok(fs.existsSync(path.join(riskRun.runDir, "evidence", "patch-risks.md")));
assert.ok(fs.existsSync(path.join(riskRun.runDir, "agents", "risk-reviewer", "input.md")));

const gitStatus = JSON.parse(run(["status", "--json"], gitProject));
assert.equal(gitStatus.currentRunStatus, "reviewing");
assert.equal(gitStatus.currentRunBranch, `imfine/${gitRun.runId}`);

const taskCommit = JSON.parse(run(["commit", "task", gitRun.runId, "T1", "--json"], gitProject));
assert.equal(taskCommit.mode, "task");
assert.equal(taskCommit.commits.length, 1);
assert.equal(taskCommit.commits[0].taskIds[0], "T1");
assert.ok(fs.existsSync(taskCommit.evidence));
assert.equal(fs.readFileSync(path.join(taskCommit.runWorktree, "src", "index.js"), "utf8"), "export const value = 2;\n");
const taskCommitMessage = execFileSync("git", ["log", "-1", "--format=%B"], { cwd: taskCommit.runWorktree, encoding: "utf8" });
assert.match(taskCommitMessage, new RegExp(`Run: ${gitRun.runId}`));
assert.match(taskCommitMessage, /Tasks: T1/);
assert.match(taskCommitMessage, /Verification:/);
assert.match(taskCommitMessage, /npm run test -> exit 0/);
const taskCommitStatus = JSON.parse(run(["status", "--json"], gitProject));
assert.equal(taskCommitStatus.currentRunStatus, "committing");

const pushBlocked = JSON.parse(run(["push", gitRun.runId, "--json"], gitProject));
assert.equal(pushBlocked.status, "push_blocked_no_remote");
assert.ok(fs.existsSync(pushBlocked.evidence));

const bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-remote-"));
execFileSync("git", ["init", "--bare", bareRemote], { encoding: "utf8" });
git(["remote", "add", "origin", bareRemote]);
const pushed = JSON.parse(run(["push", gitRun.runId, "--json"], gitProject));
assert.equal(pushed.status, "pushed");
const pushedHash = execFileSync("git", ["--git-dir", bareRemote, "rev-parse", `imfine/${gitRun.runId}`], { encoding: "utf8" }).trim();
assert.equal(pushedHash, taskCommit.commits[0].hash);

const fakeExecutor = path.join(os.tmpdir(), `imfine-fake-executor-${process.pid}.mjs`);
fs.writeFileSync(fakeExecutor, `
import fs from "node:fs";
import path from "node:path";

const role = process.env.IMFINE_AGENT_ROLE || "";
const id = process.env.IMFINE_AGENT_ID || "";
const promptFile = process.env.IMFINE_AGENT_PROMPT || "";
const outputDir = process.env.IMFINE_AGENT_OUTPUT_DIR || "";
const prompt = fs.readFileSync(promptFile, "utf8");
const agentDir = path.dirname(outputDir);

function worktreePath() {
  const match = prompt.match(/## Worktree\\n\\n([^\\n]+)/);
  if (!match) throw new Error("missing worktree in prompt");
  return match[1].trim();
}

function writeHandoff(status, summary) {
  fs.writeFileSync(path.join(agentDir, "handoff.json"), JSON.stringify({
    run_id: process.env.IMFINE_RUN_ID,
    from: role,
    to: role === "qa" ? "reviewer" : "orchestrator",
    status,
    summary,
    commands: role === "qa" ? ["fake qa command"] : undefined,
    failures: role === "qa" ? [] : undefined,
    evidence: role === "qa" ? [path.join(agentDir, "handoff.json")] : undefined,
    findings: role === "reviewer" ? [] : undefined,
    next_state: role === "qa" ? "reviewing" : role === "reviewer" ? "committing" : "ready"
  }, null, 2));
}

if (role === "dev") {
  const worktree = worktreePath();
  fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  if (!fs.existsSync(path.join(worktree, "package.json"))) {
    fs.mkdirSync(path.join(worktree, "test"), { recursive: true });
    fs.writeFileSync(path.join(worktree, ".gitignore"), "node_modules/\\ndist/\\n");
    fs.writeFileSync(path.join(worktree, "package.json"), JSON.stringify({
      name: "model-selected-project",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: { test: "node --test" }
    }, null, 2) + "\\n");
    fs.writeFileSync(path.join(worktree, "src", "index.js"), "export function value() { return 42; }\\n");
    fs.writeFileSync(path.join(worktree, "test", "index.test.js"), "import assert from 'node:assert/strict';\\nimport test from 'node:test';\\nimport { value } from '../src/index.js';\\ntest('value', () => assert.equal(value(), 42));\\n");
  } else {
    fs.writeFileSync(path.join(worktree, "src", "index.js"), "export const value = 42;\\n");
  }
} else if (role === "technical-writer") {
  const worktree = worktreePath();
  if (id === "technical-writer") {
    fs.writeFileSync(path.join(agentDir, "handoff.json"), JSON.stringify({
      run_id: process.env.IMFINE_RUN_ID,
      from: "technical-writer",
      to: "archive",
      status: "ready",
      summary: "fake technical summary ready",
      docs_changed: [],
      reason: "archive summary prepared",
      next_state: "archiving"
    }, null, 2));
  } else {
    fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "docs", "usage.md"), "# Usage\\n\\nGenerated by fake model executor for " + id + ".\\n");
    fs.writeFileSync(path.join(worktree, "README.md"), "# Model Selected Project\\n\\nGenerated by fake model executor.\\n");
  }
} else if (role === "qa") {
  writeHandoff("pass", "fake QA passed");
} else if (role === "reviewer") {
  writeHandoff("approved", "fake review approved");
} else if (role === "committer") {
  fs.writeFileSync(path.join(agentDir, "handoff.json"), JSON.stringify({
    run_id: process.env.IMFINE_RUN_ID,
    from: "committer",
    to: "orchestrator",
    status: "ready",
    summary: "fake committer approved readiness",
    commit_mode: "task",
    evidence: [path.join(agentDir, "handoff.json")],
    next_state: "committing"
  }, null, 2));
} else if (role === "risk-reviewer") {
  fs.writeFileSync(path.join(agentDir, "handoff.json"), JSON.stringify({
    run_id: process.env.IMFINE_RUN_ID,
    from: "risk-reviewer",
    to: "orchestrator",
    status: "ready",
    summary: "fake risk review passed",
    risks: [],
    required_changes: [],
    next_state: "planned"
  }, null, 2));
} else if (role === "project-knowledge-updater") {
  fs.writeFileSync(path.join(agentDir, "handoff.json"), JSON.stringify({
    run_id: process.env.IMFINE_RUN_ID,
    from: "project-knowledge-updater",
    to: "archive",
    status: "ready",
    summary: "fake project knowledge update ready",
    updated_files: [],
    next_state: "archived"
  }, null, 2));
} else if (role === "conflict-resolver") {
  const worktreeMatch = prompt.match(/- worktree: ([^\\n]+)/);
  const taskMatch = prompt.match(/- id: ([^\\n]+)/);
  const worktree = worktreeMatch?.[1]?.trim();
  const taskId = taskMatch?.[1]?.trim() || "T1";
  if (!worktree) throw new Error("missing conflict run worktree");
  fs.writeFileSync(path.join(worktree, "src", "index.js"), "export const value = 3;\\n");
  fs.writeFileSync(path.join(agentDir, "handoff.json"), JSON.stringify({
    run_id: process.env.IMFINE_RUN_ID,
    task_id: taskId,
    from: "conflict-resolver",
    to: "orchestrator",
    status: "resolved",
    summary: "fake conflict resolved",
    resolved_files: ["src/index.js"],
    commands: ["fake conflict resolution"],
    evidence: [path.join(agentDir, "handoff.json")],
    next_state: "verifying"
  }, null, 2));
} else if (role === "architect") {
  const runRoot = path.resolve(outputDir, "..", "..", "..");
  fs.mkdirSync(path.join(runRoot, "design"), { recursive: true });
  fs.writeFileSync(path.join(runRoot, "design", "stack-decision.json"), JSON.stringify({
    language: "JavaScript",
    runtime: "Node.js",
    package_manager: "npm",
    project_type: "library",
    rationale: "fake model selected dependency-free Node.js for the test requirement",
    scripts: { test: "node --test" }
  }, null, 2) + "\\n");
  fs.writeFileSync(path.join(runRoot, "design", "technical-solution.md"), "# Technical Solution\\n\\nSelected by fake Architect Agent.\\n");
  fs.writeFileSync(path.join(runRoot, "design", "architecture-decisions.md"), "# Architecture Decisions\\n\\nSelected by fake Architect Agent.\\n");
} else if (role === "task-planner") {
  const runRoot = path.resolve(outputDir, "..", "..", "..");
  const runId = process.env.IMFINE_RUN_ID;
  const graph = {
    run_id: runId,
    strategy: "serial",
    tasks: [
      {
        id: "T1",
        title: "Create model-selected project foundation",
        type: "dev",
        depends_on: [],
        read_scope: [".imfine/project/**", ".imfine/runs/" + runId + "/**"],
        write_scope: [".gitignore", "package.json", "src/**", "test/**"],
        acceptance: ["project foundation follows stack decision"],
        dev_plan: ["create model-selected project files"],
        test_plan: ["npm run test"],
        review_plan: ["review stack decision alignment"],
        verification: ["npm run test"],
        commit: { mode: "task", message: "feat: create model selected project" }
      },
      {
        id: "T2",
        title: "Document model-selected project",
        type: "docs",
        depends_on: ["T1"],
        read_scope: [".imfine/project/**", ".imfine/runs/" + runId + "/**"],
        write_scope: ["README.md", "docs/**"],
        acceptance: ["documentation reflects generated project"],
        dev_plan: ["write docs"],
        test_plan: ["documentation review"],
        review_plan: ["review documentation"],
        verification: ["documentation review"],
        commit: { mode: "task", message: "docs: document model selected project" }
      }
    ]
  };
  fs.mkdirSync(path.join(runRoot, "planning"), { recursive: true });
  fs.writeFileSync(path.join(runRoot, "planning", "task-graph.json"), JSON.stringify(graph, null, 2) + "\\n");
  fs.writeFileSync(path.join(runRoot, "planning", "ownership.json"), JSON.stringify({ run_id: runId, tasks: [] }, null, 2) + "\\n");
  fs.writeFileSync(path.join(runRoot, "planning", "execution-plan.md"), "# Execution Plan\\n\\nSelected by fake Task Planner Agent.\\n");
  fs.writeFileSync(path.join(runRoot, "planning", "commit-plan.md"), "# Commit Plan\\n\\nSelected by fake Task Planner Agent.\\n");
}
`);

const autoProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-auto-"));
function autoGit(args) {
  return execFileSync("git", args, {
    cwd: autoProject,
    encoding: "utf8"
  });
}
autoGit(["init"]);
autoGit(["config", "user.email", "imfine@example.test"]);
autoGit(["config", "user.name", "imfine test"]);
fs.writeFileSync(path.join(autoProject, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
fs.mkdirSync(path.join(autoProject, "src"));
fs.writeFileSync(path.join(autoProject, "src", "index.js"), "export const value = 1;\\n");
autoGit(["add", "."]);
autoGit(["commit", "-m", "initial"]);
const fakeExecutorCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(fakeExecutor)}`;
const autoRun = JSON.parse(run(["run", "Change value and document it", "--executor", fakeExecutorCommand, "--max-iterations", "30", "--json"], autoProject));
assert.equal(autoRun.status, "completed");
assert.ok(autoRun.steps.some((step) => step.actionId === "runtime-worktree-prepare"));
assert.ok(autoRun.steps.some((step) => step.actionId === "agent-risk-reviewer" && step.detail.includes("Risk Reviewer handoff")));
assert.ok(autoRun.steps.some((step) => step.actionId === "runtime-commit-run"));
assert.ok(autoRun.steps.some((step) => step.actionId === "agent-archive"));
assert.ok(autoRun.steps.some((step) => step.actionId === "agent-committer" && step.detail.includes("approved commit readiness")));
assert.ok(autoRun.steps.some((step) => step.actionId === "agent-technical-writer-archive" && step.detail.includes("Technical Writer handoff")));
assert.ok(autoRun.steps.some((step) => step.actionId === "agent-project-knowledge-updater" && step.detail.includes("Project Knowledge Updater handoff")));
assert.ok(fs.existsSync(autoRun.timeline));
assert.ok(fs.existsSync(path.join(autoProject, ".imfine", "runs", autoRun.runId, "orchestration", "checkpoints", "latest.json")));
const autoStatus = JSON.parse(run(["status", "--json"], autoProject));
assert.equal(autoStatus.currentRunStatus, "archived");
assert.match(run(["report", autoRun.runId], autoProject), /push status: push_blocked_no_remote/);

const dependencyProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-deps-"));
function dependencyGit(args) {
  return execFileSync("git", args, {
    cwd: dependencyProject,
    encoding: "utf8"
  });
}
dependencyGit(["init"]);
dependencyGit(["config", "user.email", "imfine@example.test"]);
dependencyGit(["config", "user.name", "imfine test"]);
fs.mkdirSync(path.join(dependencyProject, "local-dep"));
fs.writeFileSync(path.join(dependencyProject, "local-dep", "package.json"), JSON.stringify({ name: "local-dep", version: "1.0.0" }, null, 2));
fs.writeFileSync(path.join(dependencyProject, "package.json"), JSON.stringify({
  scripts: { test: "node --test" },
  dependencies: { "local-dep": "file:./local-dep" }
}, null, 2));
fs.mkdirSync(path.join(dependencyProject, "src"));
fs.writeFileSync(path.join(dependencyProject, "src", "index.js"), "export const value = 1;\n");
dependencyGit(["add", "."]);
dependencyGit(["commit", "-m", "initial"]);
const dependencyRun = JSON.parse(run(["run", "Change dependency project value", "--executor", fakeExecutorCommand, "--max-iterations", "30", "--json"], dependencyProject));
assert.equal(dependencyRun.status, "completed");
assert.ok(dependencyRun.steps.some((step) => step.actionId === "runtime-dependency-install"));
const dependencyEvidence = path.join(dependencyProject, ".imfine", "runs", dependencyRun.runId, "evidence", "dependency-install.md");
assert.ok(fs.existsSync(dependencyEvidence));
assert.match(fs.readFileSync(dependencyEvidence, "utf8"), /status: installed/);

const autoNewProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-auto-new-"));
const autoNewRun = JSON.parse(run(["run", "Create a model selected utility", "--executor", fakeExecutorCommand, "--max-iterations", "40", "--json"], autoNewProject));
assert.equal(autoNewRun.status, "completed");
const autoNewRunDir = path.join(autoNewProject, ".imfine", "runs", autoNewRun.runId);
assert.ok(fs.existsSync(path.join(autoNewRunDir, "design", "stack-decision.json")));
assert.equal(JSON.parse(fs.readFileSync(path.join(autoNewRunDir, "design", "stack-decision.json"), "utf8")).project_type, "library");
assert.match(fs.readFileSync(path.join(autoNewRunDir, "design", "technical-solution.md"), "utf8"), /fake Architect Agent/);
assert.equal(JSON.parse(fs.readFileSync(path.join(autoNewRunDir, "planning", "task-graph.json"), "utf8")).tasks[0].title, "Create model-selected project foundation");
const autoNewStatus = JSON.parse(run(["status", "--json"], autoNewProject));
assert.equal(autoNewStatus.currentRunStatus, "archived");

const waitingNewProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-waiting-new-"));
const waitingNewRun = JSON.parse(run(["run", "Create a waiting model project", "--json"], waitingNewProject));
assert.equal(waitingNewRun.status, "waiting_for_model");
assert.equal(waitingNewRun.packages.length, 2);
assert.ok(waitingNewRun.packages.every((item) => item.status === "dry_run"));
assert.ok(fs.existsSync(path.join(waitingNewProject, ".imfine", "runs", waitingNewRun.runId, "agents", "architect", "execution", "model-input.md")));

const conflictProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-conflict-"));
function conflictGit(args) {
  return execFileSync("git", args, {
    cwd: conflictProject,
    encoding: "utf8"
  });
}
conflictGit(["init"]);
conflictGit(["config", "user.email", "imfine@example.test"]);
conflictGit(["config", "user.name", "imfine test"]);
fs.writeFileSync(path.join(conflictProject, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
fs.mkdirSync(path.join(conflictProject, "src"));
fs.writeFileSync(path.join(conflictProject, "src", "index.js"), "export const value = 1;\n");
conflictGit(["add", "."]);
conflictGit(["commit", "-m", "initial"]);
const conflictRun = JSON.parse(run(["run", "Trigger conflicting task patches", "--plan-only", "--json"], conflictProject));
const conflictGraphFile = path.join(conflictRun.runDir, "planning", "task-graph.json");
const conflictGraph = JSON.parse(fs.readFileSync(conflictGraphFile, "utf8"));
conflictGraph.strategy = "serial";
conflictGraph.tasks = [
  {
    id: "T1",
    title: "Update value to two",
    type: "dev",
    depends_on: [],
    read_scope: ["src/**"],
    write_scope: ["src/**"],
    acceptance: ["value updated to two"],
    dev_plan: ["edit value"],
    test_plan: ["npm run test"],
    review_plan: ["review code"],
    verification: ["npm run test"],
    commit: { mode: "task", message: "feat: value two" }
  },
  {
    id: "T2",
    title: "Update value to three",
    type: "dev",
    depends_on: ["T1"],
    read_scope: ["src/**"],
    write_scope: ["src/**"],
    acceptance: ["value updated to three"],
    dev_plan: ["edit value"],
    test_plan: ["npm run test"],
    review_plan: ["review code"],
    verification: ["npm run test"],
    commit: { mode: "task", message: "feat: value three" }
  }
];
fs.writeFileSync(conflictGraphFile, `${JSON.stringify(conflictGraph, null, 2)}\n`);
const conflictPrepared = JSON.parse(run(["worktree", "prepare", conflictRun.runId, "--json"], conflictProject));
const conflictT1 = conflictPrepared.tasks.find((task) => task.task_id === "T1");
const conflictT2 = conflictPrepared.tasks.find((task) => task.task_id === "T2");
assert.ok(conflictT1);
assert.ok(conflictT2);
fs.writeFileSync(path.join(conflictT1.path, "src", "index.js"), "export const value = 2;\n");
fs.writeFileSync(path.join(conflictT2.path, "src", "index.js"), "export const value = 3;\n");
JSON.parse(run(["patch", "collect", conflictRun.runId, "T1", "--json"], conflictProject));
JSON.parse(run(["patch", "collect", conflictRun.runId, "T2", "--json"], conflictProject));
JSON.parse(run(["verify", conflictRun.runId, "T1", "--json"], conflictProject));
JSON.parse(run(["verify", conflictRun.runId, "T2", "--json"], conflictProject));
JSON.parse(run(["review", conflictRun.runId, "T1", "--status", "approved", "--summary", "scoped", "--json"], conflictProject));
JSON.parse(run(["review", conflictRun.runId, "T2", "--status", "approved", "--summary", "scoped", "--json"], conflictProject));
const conflictError = runExpectFail(["commit", "run", conflictRun.runId, "--mode", "task"], conflictProject);
assert.match(conflictError, /Conflict Resolver/);
const conflictStatus = JSON.parse(run(["status", "--json"], conflictProject));
assert.equal(conflictStatus.currentRunStatus, "needs_conflict_resolution");
assert.ok(fs.existsSync(path.join(conflictRun.runDir, "agents", "conflict-resolver", "input.md")));
assert.ok(fs.existsSync(path.join(conflictRun.runDir, "agents", "conflict-resolver", "handoff.json")));
assert.ok(fs.existsSync(path.join(conflictRun.runDir, "evidence", "conflicts.md")));
const conflictResume = JSON.parse(run(["resume", conflictRun.runId, "--json"], conflictProject));
assert.ok(conflictResume.nextActions.some((action) => action.id === "agent-conflict-resolver"));
const conflictAuto = JSON.parse(run(["orchestrate", conflictRun.runId, "--executor", fakeExecutorCommand, "--max-iterations", "10", "--json"], conflictProject));
assert.equal(conflictAuto.status, "completed");
assert.ok(conflictAuto.steps.some((step) => step.detail.includes("resolved conflict verified")));
const conflictAutoStatus = JSON.parse(run(["status", "--json"], conflictProject));
assert.equal(conflictAutoStatus.currentRunStatus, "archived");

const reviewFixProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-review-fix-"));
function reviewFixGit(args) {
  return execFileSync("git", args, {
    cwd: reviewFixProject,
    encoding: "utf8"
  });
}
reviewFixGit(["init"]);
reviewFixGit(["config", "user.email", "imfine@example.test"]);
reviewFixGit(["config", "user.name", "imfine test"]);
fs.writeFileSync(path.join(reviewFixProject, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
fs.mkdirSync(path.join(reviewFixProject, "src"));
fs.writeFileSync(path.join(reviewFixProject, "src", "index.js"), "export const value = 1;\n");
reviewFixGit(["add", "."]);
reviewFixGit(["commit", "-m", "initial"]);
const reviewFixRun = JSON.parse(run(["run", "Trigger review feedback", "--plan-only", "--json"], reviewFixProject));
const reviewFixPrepared = JSON.parse(run(["worktree", "prepare", reviewFixRun.runId, "--json"], reviewFixProject));
const reviewFixT1 = reviewFixPrepared.tasks.find((task) => task.task_id === "T1");
assert.ok(reviewFixT1);
fs.writeFileSync(path.join(reviewFixT1.path, "src", "index.js"), "export const value = 3;\n");
JSON.parse(run(["patch", "collect", reviewFixRun.runId, "T1", "--json"], reviewFixProject));
const reviewFixVerify = JSON.parse(run(["verify", reviewFixRun.runId, "T1", "--json"], reviewFixProject));
assert.equal(reviewFixVerify.status, "pass");
const changesRequested = JSON.parse(run(["review", reviewFixRun.runId, "T1", "--status", "changes_requested", "--summary", "add missing edge coverage", "--json"], reviewFixProject));
assert.equal(changesRequested.status, "changes_requested");
assert.ok(changesRequested.fixTaskId.startsWith("FIX-T1-"));
assert.ok(fs.existsSync(path.join(reviewFixRun.runDir, "tasks", changesRequested.fixTaskId, "task.md")));
const reviewFixGraph = JSON.parse(fs.readFileSync(path.join(reviewFixRun.runDir, "planning", "task-graph.json"), "utf8"));
assert.ok(reviewFixGraph.tasks.some((task) => task.id === changesRequested.fixTaskId));
JSON.parse(run(["review", reviewFixRun.runId, "T1", "--status", "changes_requested", "--summary", "still missing coverage", "--json"], reviewFixProject));
JSON.parse(run(["review", reviewFixRun.runId, "T1", "--status", "changes_requested", "--summary", "still incomplete", "--json"], reviewFixProject));
const repeatedFix = JSON.parse(run(["review", reviewFixRun.runId, "T1", "--status", "changes_requested", "--summary", "keep iterating", "--json"], reviewFixProject));
assert.equal(repeatedFix.status, "changes_requested");
assert.equal(repeatedFix.fixTaskId, "FIX-T1-4");
assert.ok(fs.existsSync(path.join(reviewFixRun.runDir, "tasks", repeatedFix.fixTaskId, "task.md")));
const repeatedFixStatus = JSON.parse(run(["status", "--json"], reviewFixProject));
assert.equal(repeatedFixStatus.currentRunStatus, "needs_dev_fix");

const qaFailProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-qa-fail-"));
function qaFailGit(args) {
  return execFileSync("git", args, {
    cwd: qaFailProject,
    encoding: "utf8"
  });
}
qaFailGit(["init"]);
qaFailGit(["config", "user.email", "imfine@example.test"]);
qaFailGit(["config", "user.name", "imfine test"]);
fs.writeFileSync(path.join(qaFailProject, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(1)\"" } }, null, 2));
fs.mkdirSync(path.join(qaFailProject, "src"));
fs.writeFileSync(path.join(qaFailProject, "src", "index.js"), "export const value = 1;\n");
qaFailGit(["add", "."]);
qaFailGit(["commit", "-m", "initial"]);
const qaFailRun = JSON.parse(run(["run", "Trigger QA failure", "--plan-only", "--json"], qaFailProject));
const qaFailPrepared = JSON.parse(run(["worktree", "prepare", qaFailRun.runId, "--json"], qaFailProject));
const qaFailT1 = qaFailPrepared.tasks.find((task) => task.task_id === "T1");
assert.ok(qaFailT1);
fs.writeFileSync(path.join(qaFailT1.path, "src", "index.js"), "export const value = 4;\n");
JSON.parse(run(["patch", "collect", qaFailRun.runId, "T1", "--json"], qaFailProject));
const failedVerification = JSON.parse(run(["verify", qaFailRun.runId, "T1", "--json"], qaFailProject));
assert.equal(failedVerification.status, "fail");
assert.ok(failedVerification.fixTaskId.startsWith("FIX-T1-"));
assert.ok(fs.existsSync(path.join(qaFailRun.runDir, "tasks", failedVerification.fixTaskId, "task.md")));
const qaFailStatus = JSON.parse(run(["status", "--json"], qaFailProject));
assert.equal(qaFailStatus.currentRunStatus, "needs_dev_fix");

const designProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-design-rework-"));
function designGit(args) {
  return execFileSync("git", args, {
    cwd: designProject,
    encoding: "utf8"
  });
}
designGit(["init"]);
designGit(["config", "user.email", "imfine@example.test"]);
designGit(["config", "user.name", "imfine test"]);
fs.writeFileSync(path.join(designProject, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
fs.mkdirSync(path.join(designProject, "src"));
fs.writeFileSync(path.join(designProject, "src", "index.js"), "export const value = 1;\n");
designGit(["add", "."]);
designGit(["commit", "-m", "initial"]);
const designRun = JSON.parse(run(["run", "Need architecture rework", "--plan-only", "--json"], designProject));
const designPrepared = JSON.parse(run(["worktree", "prepare", designRun.runId, "--json"], designProject));
assert.ok(designPrepared.tasks.some((task) => task.task_id === "T1"));
const designRework = JSON.parse(run(["rework", "design", designRun.runId, "T1", "--summary", "current design cannot support required behavior", "--json"], designProject));
assert.equal(designRework.status, "needs_design_update");
assert.ok(fs.existsSync(designRework.evidence));
assert.ok(fs.existsSync(designRework.architectInput));
assert.ok(fs.existsSync(designRework.taskPlannerInput));
const designStatus = JSON.parse(run(["status", "--json"], designProject));
assert.equal(designStatus.currentRunStatus, "needs_design_update");

const parallelProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-parallel-"));
function parallelGit(args) {
  return execFileSync("git", args, {
    cwd: parallelProject,
    encoding: "utf8"
  });
}
parallelGit(["init"]);
parallelGit(["config", "user.email", "imfine@example.test"]);
parallelGit(["config", "user.name", "imfine test"]);
fs.writeFileSync(path.join(parallelProject, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
fs.mkdirSync(path.join(parallelProject, "src"));
fs.mkdirSync(path.join(parallelProject, "docs"));
fs.writeFileSync(path.join(parallelProject, "src", "index.js"), "export const value = 1;\n");
fs.writeFileSync(path.join(parallelProject, "docs", "guide.md"), "# Guide\n");
parallelGit(["add", "."]);
parallelGit(["commit", "-m", "initial"]);

const parallelRun = JSON.parse(run(["run", "Update code and docs", "--plan-only", "--json"], parallelProject));
const parallelGraphFile = path.join(parallelRun.runDir, "planning", "task-graph.json");
const parallelGraph = JSON.parse(fs.readFileSync(parallelGraphFile, "utf8"));
parallelGraph.strategy = "parallel";
parallelGraph.tasks = [
  {
    id: "T1",
    title: "Update code",
    type: "dev",
    depends_on: [],
    read_scope: ["src/**"],
    write_scope: ["src/**"],
    acceptance: ["code updated"],
    dev_plan: ["edit code"],
    test_plan: ["npm run test"],
    review_plan: ["review code"],
    verification: ["npm run test"],
    commit: { mode: "task", message: "feat: update code" }
  },
  {
    id: "T2",
    title: "Update docs",
    type: "docs",
    depends_on: [],
    read_scope: ["docs/**"],
    write_scope: ["docs/**"],
    acceptance: ["docs updated"],
    dev_plan: ["edit docs"],
    test_plan: ["documentation review"],
    review_plan: ["review docs"],
    verification: ["documentation review"],
    commit: { mode: "task", message: "docs: update docs" }
  }
];
fs.writeFileSync(parallelGraphFile, `${JSON.stringify(parallelGraph, null, 2)}\n`);
const parallelValidation = JSON.parse(run(["task", "graph", "validate", parallelRun.runId, "--json"], parallelProject));
assert.equal(parallelValidation.passed, true);
assert.deepEqual(parallelValidation.parallelGroups, [["T1", "T2"]]);
const parallelPrepared = JSON.parse(run(["worktree", "prepare", parallelRun.runId, "--json"], parallelProject));
assert.equal(parallelPrepared.tasks.length, 2);
const parallelT1 = parallelPrepared.tasks.find((task) => task.task_id === "T1");
const parallelT2 = parallelPrepared.tasks.find((task) => task.task_id === "T2");
assert.ok(parallelT1);
assert.ok(parallelT2);
fs.writeFileSync(path.join(parallelT1.path, "src", "index.js"), "export const value = 2;\n");
fs.writeFileSync(path.join(parallelT2.path, "docs", "guide.md"), "# Guide\n\nUpdated.\n");
const parallelPatch1 = JSON.parse(run(["patch", "collect", parallelRun.runId, "T1", "--json"], parallelProject));
const parallelPatch2 = JSON.parse(run(["patch", "collect", parallelRun.runId, "T2", "--json"], parallelProject));
assert.equal(parallelPatch1.validation.passed, true);
assert.equal(parallelPatch2.validation.passed, true);
const codeQa = JSON.parse(run(["verify", parallelRun.runId, "T1", "--json"], parallelProject));
assert.equal(codeQa.status, "pass");
const codeReview = JSON.parse(run(["review", parallelRun.runId, "T1", "--status", "approved", "--summary", "code scoped", "--json"], parallelProject));
assert.equal(codeReview.status, "approved");
const docsQa = JSON.parse(run(["verify", parallelRun.runId, "T2", "--status", "pass", "--summary", "documentation review passed", "--json"], parallelProject));
assert.equal(docsQa.status, "pass");
assert.equal(docsQa.summary, "documentation review passed");
assert.equal(docsQa.commands.length, 0);
const docsReview = JSON.parse(run(["review", parallelRun.runId, "T2", "--status", "approved", "--summary", "docs scoped", "--json"], parallelProject));
assert.equal(docsReview.status, "approved");
const integrationCommit = JSON.parse(run(["commit", "run", parallelRun.runId, "--mode", "integration", "--json"], parallelProject));
assert.equal(integrationCommit.mode, "integration");
assert.equal(integrationCommit.commits.length, 1);
assert.deepEqual(integrationCommit.commits[0].taskIds, ["T1", "T2"]);
assert.equal(fs.readFileSync(path.join(integrationCommit.runWorktree, "src", "index.js"), "utf8"), "export const value = 2;\n");
assert.equal(fs.readFileSync(path.join(integrationCommit.runWorktree, "docs", "guide.md"), "utf8"), "# Guide\n\nUpdated.\n");
const integrationCommitMessage = execFileSync("git", ["log", "-1", "--format=%B"], { cwd: integrationCommit.runWorktree, encoding: "utf8" });
assert.match(integrationCommitMessage, new RegExp(`Run: ${parallelRun.runId}`));
assert.match(integrationCommitMessage, /Tasks: T1, T2/);
assert.match(integrationCommitMessage, /Verification:/);
const parallelPushBlocked = JSON.parse(run(["push", parallelRun.runId, "--json"], parallelProject));
assert.equal(parallelPushBlocked.status, "push_blocked_no_remote");
const archive = JSON.parse(run(["archive", parallelRun.runId, "--json"], parallelProject));
assert.equal(archive.status, "archived");
assert.ok(fs.existsSync(archive.archiveReport));
assert.ok(fs.existsSync(archive.userReport));
assert.ok(fs.existsSync(archive.projectUpdates));
assert.ok(fs.existsSync(archive.finalSummary));
assert.ok(fs.existsSync(path.join(parallelRun.runDir, "agents", "archive", "handoff.json")));
assert.match(fs.readFileSync(archive.archiveReport, "utf8"), /Delivered Changes/);
assert.match(fs.readFileSync(archive.archiveReport, "utf8"), /Evidence Chain/);
assert.match(fs.readFileSync(archive.archiveReport, "utf8"), /push status: push_blocked_no_remote/);
assert.match(fs.readFileSync(archive.archiveReport, "utf8"), /push user action:/);
assert.match(fs.readFileSync(archive.userReport, "utf8"), /Commit and Push/);
assert.match(fs.readFileSync(path.join(parallelProject, ".imfine", "project", "test-strategy.md"), "utf8"), new RegExp(parallelRun.runId));
assert.ok(fs.existsSync(path.join(parallelProject, ".imfine", "project", "capabilities", parallelRun.runId.toLowerCase(), "spec.md")));
const capabilitySpec = fs.readFileSync(path.join(parallelProject, ".imfine", "project", "capabilities", parallelRun.runId.toLowerCase(), "spec.md"), "utf8");
assert.match(capabilitySpec, /Verified Facts/);
assert.match(capabilitySpec, /Spec Delta/);
const archivedStatus = JSON.parse(run(["status", "--json"], parallelProject));
assert.equal(archivedStatus.currentRunStatus, "archived");
assert.ok(archivedStatus.reports.includes(`${parallelRun.runId}.md`));
const archiveReportRead = run(["report", parallelRun.runId], parallelProject);
assert.match(archiveReportRead, new RegExp(parallelRun.runId));

const blockedArchive = JSON.parse(run(["archive", delivery.runId, "--json"]));
assert.equal(blockedArchive.status, "blocked");
assert.ok(blockedArchive.blockedItems.length > 0);
assert.ok(fs.existsSync(blockedArchive.archiveReport));

const newProject = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-new-project-"));
const delivered = JSON.parse(run(["run", "Create a tiny task tracker", "--deliver", "--json"], newProject));
assert.equal(delivered.status, "archived");
assert.equal(delivered.run.projectKind, "new_project");
assert.equal(delivered.push.status, "push_blocked_no_remote");
assert.equal(delivered.commit.commits.length, 2);
assert.ok(fs.existsSync(path.join(newProject, ".git")));
assert.ok(fs.existsSync(path.join(newProject, ".imfine", "runs", delivered.runId, "archive", "archive-report.md")));
assert.ok(fs.existsSync(path.join(delivered.projectWorktree, "package.json")));
assert.ok(fs.existsSync(path.join(delivered.projectWorktree, ".gitignore")));
assert.ok(fs.existsSync(path.join(delivered.projectWorktree, "src", "index.js")));
assert.ok(fs.existsSync(path.join(delivered.projectWorktree, "test", "index.test.js")));
assert.ok(fs.existsSync(path.join(delivered.projectWorktree, "docs", "usage.md")));
assert.match(fs.readFileSync(path.join(newProject, ".imfine", "runs", delivered.runId, "design", "technical-solution.md"), "utf8"), /Selected Stack/);
assert.match(fs.readFileSync(path.join(newProject, ".imfine", "runs", delivered.runId, "analysis", "risk-analysis.md"), "utf8"), /Missing remote is expected/);
const generatedPackage = JSON.parse(fs.readFileSync(path.join(delivered.projectWorktree, "package.json"), "utf8"));
assert.equal(generatedPackage.scripts.test, "node --test");
assert.ok(generatedPackage.scripts.format);
execFileSync("npm", ["run", "test"], { cwd: delivered.projectWorktree, encoding: "utf8" });
const generatedBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: delivered.projectWorktree, encoding: "utf8" }).trim();
assert.equal(generatedBranch, `imfine/${delivered.runId}`);
const generatedReport = run(["report", delivered.runId], newProject);
assert.match(generatedReport, /push status: push_blocked_no_remote/);

const npmEnv = {
  npm_execpath: "/usr/local/bin/npm",
  npm_config_user_agent: "npm/10 npx"
};

const directInstall = JSON.parse(run(["install", "--target", "all", "--dry-run", "--json"], root, {
  npm_execpath: "",
  npm_config_user_agent: ""
}));
assert.equal(directInstall.target, "all");
assert.equal(directInstall.language, "zh");
assert.equal(directInstall.dryRun, true);

const install = JSON.parse(run(["install", "--target", "all", "--dry-run", "--json"], root, npmEnv));
assert.equal(install.target, "all");
assert.equal(install.language, "zh");
assert.equal(install.dryRun, true);
assert.ok(install.written.some((item) => item.endsWith(".codex/skills/imfine/SKILL.md")));
assert.ok(install.written.some((item) => item.endsWith(".claude/commands/imfine.md")));

const defaultInstall = JSON.parse(run(["install", "--dry-run", "--json"], root, npmEnv));
assert.equal(defaultInstall.target, "all");
assert.equal(defaultInstall.language, "zh");

const enInstall = JSON.parse(run(["install", "--target", "codex", "--lang", "en", "--dry-run", "--json"], root, npmEnv));
assert.equal(enInstall.target, "codex");
assert.equal(enInstall.language, "en");

const invalidLanguage = runExpectFail(["install", "--lang", "fr", "--dry-run"], root, npmEnv);
assert.match(invalidLanguage, /Invalid --lang/);

const realInstall = JSON.parse(run(["install", "--target", "all", "--lang", "en", "--json"], root, npmEnv));
assert.equal(realInstall.target, "all");
assert.equal(realInstall.language, "en");
assert.ok(fs.existsSync(path.join(tempHome, ".imfine", "runtime")));
assert.ok(fs.existsSync(path.join(tempHome, ".codex", "skills", "imfine", "SKILL.md")));
assert.ok(fs.existsSync(path.join(tempHome, ".claude", "commands", "imfine.md")));
assert.match(fs.readFileSync(path.join(tempHome, ".codex", "skills", "imfine", "SKILL.md"), "utf8"), /^---\nname: imfine\ndescription: /);
assert.match(fs.readFileSync(path.join(tempHome, ".codex", "skills", "imfine", "SKILL.md"), "utf8"), /Use imfine/);
assert.match(fs.readFileSync(path.join(tempHome, ".claude", "commands", "imfine.md"), "utf8"), /Claude Code session/);

console.log("smoke ok");
