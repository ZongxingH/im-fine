import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "imfine.js");
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-smoke-home-"));

function run(args, cwd, extraEnv = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: tempHome, ...extraEnv },
    encoding: "utf8"
  });
}

function makeGitProject(prefix) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const git = (args, cwd = project) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git(["init"]);
  git(["config", "user.email", "imfine@example.test"]);
  git(["config", "user.name", "imfine test"]);
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 1;\n");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  return { project, git };
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
        read_scope: [".imfine/project/**", ".imfine/runs/" + runId + "/**", "src/**"],
        write_scope: ["src/**", "test/**"],
        acceptance: ["requested change implemented"],
        dev_plan: ["edit source"],
        test_plan: ["npm run test"],
        review_plan: ["review source change"],
        verification: ["npm run test"],
        commit: { mode: "task", message: "feat: implement requested change" }
      }
    ]
  }, null, 2)}\n`);
}

function writeOrchestratorSession(runDir, runId) {
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "planned",
    next_actions: [
      {
        id: "runtime-worktree-prepare",
        kind: "runtime",
        status: "ready",
        role: "orchestrator",
        reason: "prepare worktree before dev execution",
        inputs: [],
        outputs: [path.join(runDir, "worktrees", "index.json")],
        dependsOn: [],
        parallelGroup: "bootstrap"
      },
      {
        id: "agent-dev-T1",
        kind: "agent",
        status: "ready",
        role: "dev",
        taskId: "T1",
        reason: "implement task T1",
        inputs: [path.join(runDir, "agents", "T1", "input.md")],
        outputs: [path.join(runDir, "agents", "T1", "handoff.json")],
        dependsOn: ["runtime-worktree-prepare"],
        parallelGroup: "delivery"
      }
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
        readScope: [".imfine/project/**", ".imfine/runs/" + runId + "/**", "src/**"],
        writeScope: ["src/**", "test/**"],
        dependsOn: ["runtime-worktree-prepare"],
        parallelGroup: "delivery"
      }
    ]
  }, null, 2)}\n`);
}

const { project } = makeGitProject("imfine-smoke-");
const created = JSON.parse(run(["run", "Build a todo app", "--plan-only", "--json"], project));
assert.equal(created.status, "waiting_for_agent_output");
assert.equal(created.executionMode, "true_harness");
assert.equal(created.nextActions.length, 0);
assert.equal(created.dispatchContracts.length, 0);
assert.ok(fs.existsSync(path.join(created.runDir, "orchestration", "orchestrator-input.md")));

const duplicate = JSON.parse(run(["run", "Build a todo app", "--plan-only", "--json"], project));
assert.equal(duplicate.runId, created.runId);

writeTaskGraph(created.runDir, created.runId);
writeOrchestratorSession(created.runDir, created.runId);

const resumed = JSON.parse(run(["resume", created.runId, "--json"], project, { IMFINE_INTERNAL: "1" }));
assert.equal(resumed.status, "planned");
assert.equal(resumed.executionMode, "true_harness");
assert.ok(resumed.nextActions.some((action) => action.id === "runtime-worktree-prepare"));
assert.ok(resumed.nextActions.some((action) => action.id === "agent-dev-T1"));
assert.equal(resumed.dispatchContracts.length, 1);
assert.ok(fs.existsSync(path.join(created.runDir, "orchestration", "parallel-plan.json")));
assert.ok(fs.existsSync(path.join(created.runDir, "orchestration", "parallel-execution.json")));

const dispatch = JSON.parse(fs.readFileSync(path.join(created.runDir, "orchestration", "dispatch-contracts.json"), "utf8"));
assert.equal(dispatch.contracts.length, 1);
assert.equal(dispatch.contracts[0].role, "dev");

const planArtifact = JSON.parse(fs.readFileSync(path.join(created.runDir, "orchestration", "parallel-plan.json"), "utf8"));
assert.equal(planArtifact.artifact_type, "planning");
assert.ok(Array.isArray(planArtifact.parallel_groups));

const executionArtifact = JSON.parse(fs.readFileSync(path.join(created.runDir, "orchestration", "parallel-execution.json"), "utf8"));
assert.equal(executionArtifact.artifact_type, "execution");
assert.deepEqual(executionArtifact.wave_history, []);

assert.throws(() => run(["orchestrate", created.runId, "--json"], project), /internal runtime action/);
const orchestrated = JSON.parse(run(["orchestrate", created.runId, "--json"], project, { IMFINE_INTERNAL: "1" }));
assert.equal(orchestrated.status, "waiting_for_agent_output");
assert.ok(orchestrated.steps.some((step) => step.actionId === "runtime-worktree-prepare"));
assert.ok(orchestrated.steps.some((step) => step.status === "waiting_for_agent_output"));

const { project: malformedProject } = makeGitProject("imfine-malformed-");
const malformed = JSON.parse(run(["run", "Malformed session", "--plan-only", "--json"], malformedProject));
fs.writeFileSync(path.join(malformed.runDir, "orchestration", "orchestrator-session.json"), `${JSON.stringify({
  schema_version: 1,
  run_id: malformed.runId,
  decision_source: "orchestrator_agent",
  execution_mode: "true_harness",
  harness_classification: "true_harness",
  status: "planned",
  next_actions: [
    {
      id: "agent-dev-T1",
      status: "ready",
      role: "dev",
      reason: "missing kind and required arrays",
      dependsOn: [],
      parallelGroup: "delivery"
    }
  ],
  agent_runs: []
}, null, 2)}\n`);
const malformedResume = JSON.parse(run(["resume", malformed.runId, "--json"], malformedProject, { IMFINE_INTERNAL: "1" }));
assert.equal(malformedResume.status, "blocked");
assert.equal(malformedResume.dispatchContracts.length, 0);
const validation = JSON.parse(fs.readFileSync(path.join(malformed.runDir, "orchestration", "session-validation.json"), "utf8"));
assert.ok(validation.errors.some((error) => error.includes("next_actions[0].kind")));

const { project: dependencyProject } = makeGitProject("imfine-bad-dep-");
const dependency = JSON.parse(run(["run", "Bad dependency", "--plan-only", "--json"], dependencyProject));
writeOrchestratorSession(dependency.runDir, dependency.runId);
const dependencySession = JSON.parse(fs.readFileSync(path.join(dependency.runDir, "orchestration", "orchestrator-session.json"), "utf8"));
dependencySession.next_actions[1].dependsOn = ["missing-action"];
fs.writeFileSync(path.join(dependency.runDir, "orchestration", "orchestrator-session.json"), `${JSON.stringify(dependencySession, null, 2)}\n`);
const dependencyResume = JSON.parse(run(["resume", dependency.runId, "--json"], dependencyProject, { IMFINE_INTERNAL: "1" }));
assert.equal(dependencyResume.status, "blocked");
const dependencyValidation = JSON.parse(fs.readFileSync(path.join(dependency.runDir, "orchestration", "session-validation.json"), "utf8"));
assert.ok(dependencyValidation.errors.some((error) => error.includes("references unknown action missing-action")));

const { project: mismatchProject } = makeGitProject("imfine-mismatch-");
const mismatch = JSON.parse(run(["run", "Mismatched agent", "--plan-only", "--json"], mismatchProject));
writeOrchestratorSession(mismatch.runDir, mismatch.runId);
const mismatchSession = JSON.parse(fs.readFileSync(path.join(mismatch.runDir, "orchestration", "orchestrator-session.json"), "utf8"));
mismatchSession.agent_runs = [];
fs.writeFileSync(path.join(mismatch.runDir, "orchestration", "orchestrator-session.json"), `${JSON.stringify(mismatchSession, null, 2)}\n`);
const mismatchResume = JSON.parse(run(["resume", mismatch.runId, "--json"], mismatchProject, { IMFINE_INTERNAL: "1" }));
assert.equal(mismatchResume.status, "blocked");
const mismatchValidation = JSON.parse(fs.readFileSync(path.join(mismatch.runDir, "orchestration", "session-validation.json"), "utf8"));
assert.ok(mismatchValidation.errors.some((error) => error.includes("has no matching agent_run")));

const { project: handoffProject } = makeGitProject("imfine-invalid-handoff-");
const handoff = JSON.parse(run(["run", "Invalid handoff", "--plan-only", "--json"], handoffProject));
writeOrchestratorSession(handoff.runDir, handoff.runId);
fs.mkdirSync(path.join(handoff.runDir, "agents", "T1"), { recursive: true });
fs.writeFileSync(path.join(handoff.runDir, "agents", "T1", "handoff.json"), JSON.stringify({
  run_id: handoff.runId,
  from: "dev",
  status: "ready"
}, null, 2) + "\n");
const handoffResume = JSON.parse(run(["resume", handoff.runId, "--json"], handoffProject, { IMFINE_INTERNAL: "1" }));
assert.equal(handoffResume.status, "blocked");
const handoffValidation = JSON.parse(fs.readFileSync(path.join(handoff.runDir, "orchestration", "handoff-validation.json"), "utf8"));
assert.ok(handoffValidation.errors.some((error) => error.includes("handoff invalid")));

console.log("smoke ok");
