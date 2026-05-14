import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "imfine.js");
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-harness-home-"));

function run(args, cwd, extraEnv = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: tempHome, ...extraEnv },
    encoding: "utf8"
  });
}

function makeGitProject(prefix) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}remote-`));
  const git = (args, cwd = project) => execFileSync("git", args, { cwd, encoding: "utf8" });
  execFileSync("git", ["init", "--bare"], { cwd: remote, encoding: "utf8" });
  git(["init"]);
  git(["config", "user.email", "imfine@example.test"]);
  git(["config", "user.name", "imfine test"]);
  git(["remote", "add", "origin", remote]);
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2));
  fs.mkdirSync(path.join(project, "src"));
  fs.mkdirSync(path.join(project, "test"));
  fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 1;\n");
  fs.writeFileSync(path.join(project, "test", "index.test.js"), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/index.js';\ntest('value', () => assert.equal(value, 1));\n");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  git(["branch", "-M", "main"]);
  git(["push", "-u", "origin", "main"]);
  return { project };
}

function writeTaskGraph(runDir, runId) {
  fs.writeFileSync(path.join(runDir, "planning", "task-graph.json"), `${JSON.stringify({
    run_id: runId,
    strategy: "serial",
    tasks: [
      {
        id: "T1",
        title: "Implement requested change",
        type: "dev",
        depends_on: [],
        read_scope: [".imfine/project/**", ".imfine/runs/" + runId + "/**", "src/**", "test/**"],
        write_scope: ["src/**", "test/**"],
        acceptance: ["requested change implemented"],
        dev_plan: ["edit source and tests"],
        test_plan: ["npm run test"],
        review_plan: ["review code change"],
        verification: ["npm run test"],
        commit: { mode: "task", message: "feat: acceptance implementation" }
      }
    ]
  }, null, 2)}\n`);
}

function writeOrchestratorSession(runDir, runId) {
  const action = (id, kind, role, reason, dependsOn = [], taskId, parallelGroup = role) => ({
    id,
    kind,
    status: "ready",
    role,
    taskId,
    reason,
    inputs: [],
    outputs: [],
    dependsOn,
    parallelGroup
  });

  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "planned",
    next_actions: [
      action("runtime-worktree-prepare", "runtime", "orchestrator", "prepare worktrees"),
      action("agent-dev-T1", "agent", "dev", "implement T1", ["runtime-worktree-prepare"], "T1", "delivery"),
      action("agent-qa-T1", "agent", "qa", "verify T1", ["agent-dev-T1"], "T1", "qa"),
      action("agent-reviewer-T1", "agent", "reviewer", "review T1", ["agent-qa-T1"], "T1", "review"),
      action("agent-merge-agent-T1", "agent", "merge-agent", "integrate T1 into current project directory", ["agent-reviewer-T1"], "T1", "merge"),
      action("agent-committer", "agent", "committer", "approve commit", ["agent-merge-agent-T1"]),
      action("runtime-commit-run", "runtime", "orchestrator", "commit run", ["agent-committer"]),
      action("runtime-push-run", "runtime", "orchestrator", "push run", ["runtime-commit-run"]),
      action("agent-technical-writer", "agent", "technical-writer", "prepare final summary", ["runtime-push-run"], undefined, "archive-prep"),
      action("agent-project-knowledge-updater", "agent", "project-knowledge-updater", "update project knowledge", ["runtime-push-run"], undefined, "archive-prep"),
      action("agent-archive", "agent", "archive", "archive run", ["agent-technical-writer", "agent-project-knowledge-updater"], undefined, "archive")
    ],
    agent_runs: [
      {
        id: "T1",
        role: "dev",
        taskId: "T1",
        status: "ready",
        workflowState: "active_delivery",
        skills: ["implementation"],
        inputs: [path.join(runDir, "agents", "T1", "input.md")],
        outputs: [path.join(runDir, "agents", "T1", "handoff.json")],
        readScope: [".imfine/project/**", ".imfine/runs/" + runId + "/**", "src/**", "test/**"],
        writeScope: ["src/**", "test/**"],
        dependsOn: ["runtime-worktree-prepare"],
        parallelGroup: "delivery"
      },
      {
        id: "qa-T1",
        role: "qa",
        taskId: "T1",
        status: "ready",
        workflowState: "active_delivery",
        skills: ["verification"],
        inputs: [],
        outputs: [path.join(runDir, "agents", "qa-T1", "handoff.json")],
        readScope: [".imfine/runs/" + runId + "/**"],
        writeScope: [".imfine/runs/" + runId + "/agents/qa-T1/**"],
        dependsOn: ["agent-dev-T1"],
        parallelGroup: "qa"
      },
      {
        id: "reviewer-T1",
        role: "reviewer",
        taskId: "T1",
        status: "ready",
        workflowState: "active_delivery",
        skills: ["risk-review"],
        inputs: [],
        outputs: [path.join(runDir, "agents", "reviewer-T1", "handoff.json")],
        readScope: [".imfine/runs/" + runId + "/**"],
        writeScope: [".imfine/runs/" + runId + "/agents/reviewer-T1/**"],
        dependsOn: ["agent-qa-T1"],
        parallelGroup: "review"
      },
      {
        id: "merge-agent-T1",
        role: "merge-agent",
        taskId: "T1",
        status: "ready",
        workflowState: "integrating",
        skills: ["merge", "scope-control"],
        inputs: [],
        outputs: [path.join(runDir, "agents", "merge-agent-T1", "handoff.json")],
        readScope: [".imfine/runs/" + runId + "/**", "src/**", "test/**"],
        writeScope: ["src/**", "test/**"],
        dependsOn: ["agent-reviewer-T1"],
        parallelGroup: "merge"
      },
      {
        id: "committer",
        role: "committer",
        status: "ready",
        workflowState: "ready_to_commit",
        skills: ["scope-control"],
        inputs: [],
        outputs: [path.join(runDir, "agents", "committer", "handoff.json")],
        readScope: [".imfine/runs/" + runId + "/**"],
        writeScope: [".imfine/runs/" + runId + "/agents/committer/**"],
        dependsOn: ["agent-merge-agent-T1"],
        parallelGroup: "commit"
      },
      {
        id: "technical-writer",
        role: "technical-writer",
        status: "ready",
        workflowState: "ready_to_archive",
        skills: ["documentation"],
        inputs: [],
        outputs: [path.join(runDir, "agents", "technical-writer", "handoff.json")],
        readScope: [".imfine/runs/" + runId + "/**"],
        writeScope: [".imfine/runs/" + runId + "/agents/technical-writer/**"],
        dependsOn: ["runtime-push-run"],
        parallelGroup: "archive-prep"
      },
      {
        id: "project-knowledge-updater",
        role: "project-knowledge-updater",
        status: "ready",
        workflowState: "ready_to_archive",
        skills: ["project-knowledge"],
        inputs: [],
        outputs: [path.join(runDir, "agents", "project-knowledge-updater", "handoff.json")],
        readScope: [".imfine/runs/" + runId + "/**"],
        writeScope: [".imfine/runs/" + runId + "/agents/project-knowledge-updater/**"],
        dependsOn: ["runtime-push-run"],
        parallelGroup: "archive-prep"
      },
      {
        id: "archive",
        role: "archive",
        status: "ready",
        workflowState: "ready_to_archive",
        skills: ["archive"],
        inputs: [],
        outputs: [path.join(runDir, "agents", "archive", "handoff.json")],
        readScope: [".imfine/runs/" + runId + "/**"],
        writeScope: [".imfine/runs/" + runId + "/agents/archive/**", ".imfine/runs/" + runId + "/archive/**"],
        dependsOn: ["agent-technical-writer", "agent-project-knowledge-updater"],
        parallelGroup: "archive"
      }
    ]
  }, null, 2)}\n`);
}

function readWorktreePath(runDir, taskId) {
  const index = JSON.parse(fs.readFileSync(path.join(runDir, "worktrees", "index.json"), "utf8"));
  return index.tasks.find((task) => task.task_id === taskId).path;
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeQaHandoff(runDir, runId) {
  const file = path.join(runDir, "agents", "qa-T1", "handoff.json");
  writeJson(file, {
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "qa passed",
    commands: ["npm run test"],
    failures: [],
    evidence: [file],
    next_state: "reviewing"
  });
}

function writeReviewerHandoff(runDir, runId) {
  const file = path.join(runDir, "agents", "reviewer-T1", "handoff.json");
  writeJson(file, {
    run_id: runId,
    task_id: "T1",
    role: "reviewer",
    from: "reviewer",
    to: "orchestrator",
    status: "approved",
    summary: "review approved",
    commands: [],
    findings: [],
    evidence: [file],
    next_state: "committing"
  });
}

function writeCommitterHandoff(runDir, runId) {
  const file = path.join(runDir, "agents", "committer", "handoff.json");
  writeJson(file, {
    run_id: runId,
    task_id: "run",
    role: "committer",
    from: "committer",
    to: "orchestrator",
    status: "ready",
    summary: "commit approved",
    commit_mode: "task",
    commands: [],
    evidence: [file],
    next_state: "committing"
  });
}

function writeMergeAgentHandoff(runDir, runId) {
  const file = path.join(runDir, "agents", "merge-agent-T1", "handoff.json");
  writeJson(file, {
    run_id: runId,
    task_id: "T1",
    role: "merge-agent",
    from: "merge-agent",
    to: "committer",
    status: "ready",
    summary: "merged approved task changes into current project directory",
    merged_files: ["src/index.js", "test/index.test.js"],
    commands: ["git apply .imfine/runs/" + runId + "/agents/T1/patch.diff"],
    evidence: [file],
    next_state: "committing"
  });
}

function writeTechnicalWriterHandoff(runDir, runId) {
  const file = path.join(runDir, "agents", "technical-writer", "handoff.json");
  writeJson(file, {
    run_id: runId,
    task_id: "run",
    role: "technical-writer",
    from: "technical-writer",
    to: "archive",
    status: "ready",
    summary: "final summary ready",
    docs_changed: [],
    commands: [],
    evidence: [file],
    reason: "archive summary prepared",
    next_state: "archiving"
  });
}

function writeProjectKnowledgeHandoff(runDir, runId) {
  const file = path.join(runDir, "agents", "project-knowledge-updater", "handoff.json");
  writeJson(file, {
    run_id: runId,
    task_id: "run",
    role: "project-knowledge-updater",
    from: "project-knowledge-updater",
    to: "archive",
    status: "ready",
    summary: "project knowledge ready",
    commands: [],
    evidence: [file],
    updated_files: [],
    next_state: "completed"
  });
}

function writeArchiveHandoff(runDir, runId) {
  const file = path.join(runDir, "agents", "archive", "handoff.json");
  writeJson(file, {
    run_id: runId,
    task_id: "run",
    role: "archive",
    from: "archive",
    to: "orchestrator",
    status: "completed",
    summary: "archive completed",
    commands: [],
    archive_report: path.join(runDir, "archive", "archive-report.md"),
    project_updates: [],
    blocked_items: [],
    evidence: [file],
    next_state: "completed"
  });
}

const { project } = makeGitProject("imfine-harness-");
const created = JSON.parse(run(["run", "Implement the requested change", "--plan-only", "--json"], project));
writeTaskGraph(created.runDir, created.runId);
writeOrchestratorSession(created.runDir, created.runId);

let auto = JSON.parse(run(["orchestrate", created.runId, "--max-iterations", "30", "--json"], project, { IMFINE_INTERNAL: "1" }));
assert.equal(auto.status, "waiting_for_agent_output");
assert.ok(auto.steps.some((step) => step.actionId === "runtime-worktree-prepare"));

const taskWorktree = readWorktreePath(created.runDir, "T1");
fs.writeFileSync(path.join(taskWorktree, "src", "index.js"), "export const value = 2;\n");
fs.writeFileSync(path.join(taskWorktree, "test", "index.test.js"), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/index.js';\ntest('value', () => assert.equal(value, 2));\n");

auto = JSON.parse(run(["orchestrate", created.runId, "--max-iterations", "30", "--json"], project, { IMFINE_INTERNAL: "1" }));
assert.equal(auto.status, "waiting_for_agent_output");
writeQaHandoff(created.runDir, created.runId);

auto = JSON.parse(run(["orchestrate", created.runId, "--max-iterations", "30", "--json"], project, { IMFINE_INTERNAL: "1" }));
assert.equal(auto.status, "waiting_for_agent_output");
writeReviewerHandoff(created.runDir, created.runId);

auto = JSON.parse(run(["orchestrate", created.runId, "--max-iterations", "30", "--json"], project, { IMFINE_INTERNAL: "1" }));
assert.equal(auto.status, "waiting_for_agent_output");
fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 2;\n");
fs.writeFileSync(path.join(project, "test", "index.test.js"), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/index.js';\ntest('value', () => assert.equal(value, 2));\n");
writeMergeAgentHandoff(created.runDir, created.runId);

auto = JSON.parse(run(["orchestrate", created.runId, "--max-iterations", "30", "--json"], project, { IMFINE_INTERNAL: "1" }));
assert.equal(auto.status, "waiting_for_agent_output");
writeCommitterHandoff(created.runDir, created.runId);
writeTechnicalWriterHandoff(created.runDir, created.runId);
writeProjectKnowledgeHandoff(created.runDir, created.runId);
writeArchiveHandoff(created.runDir, created.runId);

auto = JSON.parse(run(["orchestrate", created.runId, "--max-iterations", "30", "--json"], project, { IMFINE_INTERNAL: "1" }));
assert.equal(auto.status, "completed");
assert.equal(auto.lastOrchestration.executionMode, "true_harness");
assert.ok(auto.sessionSummary.orchestrator.summary.includes("completed"));

const runDir = path.join(project, ".imfine", "runs", created.runId);
const runMetadata = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
assert.equal(runMetadata.status, "completed");

const parallelPlan = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "parallel-plan.json"), "utf8"));
assert.equal(parallelPlan.artifact_type, "planning");
assert.ok(Array.isArray(parallelPlan.parallel_groups));

const parallelExecution = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), "utf8"));
assert.equal(parallelExecution.artifact_type, "execution");
assert.ok(Array.isArray(parallelExecution.wave_history));
assert.ok(parallelExecution.wave_history.length > 0);

const dispatchContracts = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), "utf8"));
assert.ok(dispatchContracts.contracts.length >= 7);

const session = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), "utf8"));
assert.equal(session.decision_source, "orchestrator_agent");
assert.equal(session.execution_mode, "true_harness");
assert.equal(session.harness_classification, "true_harness");

const evidence = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "true-harness-evidence.json"), "utf8"));
assert.equal(evidence.harness_classification, "true_harness");
assert.equal(evidence.orchestrator_declaration.passed, true);
assert.equal(evidence.true_harness_passed, true);
assert.ok(evidence.parallel_execution.wave_count > 0);
assert.equal(evidence.parallel_execution.all_contracts_have_completed_wave, true);
assert.deepEqual(evidence.parallel_execution.missing_completed_wave_contracts, []);
assert.equal(evidence.handoff_validation.required_agent_count, dispatchContracts.contracts.length);
assert.equal(evidence.handoff_validation.valid_agent_count, dispatchContracts.contracts.length);
assert.ok(evidence.handoff_evidence_chain.length > 0);

const archive = JSON.parse(fs.readFileSync(path.join(runDir, "agents", "archive", "status.json"), "utf8"));
assert.equal(archive.status, "completed");
assert.ok(fs.existsSync(path.join(runDir, "archive", "archive-report.md")));
assert.ok(fs.existsSync(path.join(project, ".imfine", "reports", `${created.runId}.md`)));

for (const contract of dispatchContracts.contracts) {
  const candidates = [
    path.join(runDir, "agents", contract.id, "handoff.json"),
    contract.task_id ? path.join(runDir, "agents", contract.task_id, "handoff.json") : undefined,
    contract.task_id ? path.join(runDir, "agents", `${contract.role}-${contract.task_id}`, "handoff.json") : undefined,
    path.join(runDir, "agents", contract.role, "handoff.json")
  ].filter(Boolean);
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(file, `missing handoff for ${contract.id}`);
  const handoff = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(handoff.role, contract.role);
  assert.equal(handoff.task_id, contract.task_id || "run");
  assert.ok(Array.isArray(handoff.commands));
  assert.ok(Array.isArray(handoff.evidence));
  assert.equal(typeof handoff.next_state, "string");
}

const finalGates = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "final-gates.json"), "utf8"));
assert.equal(finalGates.generated_by, "imfine-runtime");
assert.equal(finalGates.source, "derived_from_standard_evidence");
assert.equal(finalGates.gates.qa, "pass");
assert.equal(finalGates.gates.review, "pass");
assert.equal(finalGates.gates.committer, "pass");
assert.equal(finalGates.gates.archive, "pass");
for (const id of ["run-level.qa-evidence", "run-level.review-evidence", "run-level.committer-handoff", "run-level.archive-status", "run-level.archive-handoff"]) {
  assert.ok(finalGates.checks.some((check) => check.id === id && check.status === "pass"), `missing final gate check ${id}`);
}

console.log("harness acceptance ok");
