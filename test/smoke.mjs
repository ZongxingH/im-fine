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

writeTaskGraph(created.runDir, created.runId);
writeOrchestratorSession(created.runDir, created.runId);

const resumed = JSON.parse(run(["resume", created.runId, "--json"], project));
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

const orchestrated = JSON.parse(run(["orchestrate", created.runId, "--json"], project));
assert.equal(orchestrated.status, "waiting_for_agent_output");
assert.ok(orchestrated.steps.some((step) => step.actionId === "runtime-worktree-prepare"));
assert.ok(orchestrated.steps.some((step) => step.status === "waiting_for_agent_output"));

console.log("smoke ok");
