import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { completeAgentAction } from "../dist/core/agent-complete.js";
import { orchestrateRun, resumeRun } from "../dist/core/orchestrator.js";
import { reconcileRun } from "../dist/core/reconcile.js";
import { status as readStatus } from "../dist/core/status.js";
import { writeProviderExecutionReceipt } from "../dist/core/provider-evidence.js";

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-reconcile-home-"));

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, HOME: tempHome } });
}

function makeProject(prefix, withCommit = false) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(["init"], cwd);
  git(["config", "user.email", "imfine@example.test"], cwd);
  git(["config", "user.name", "imfine test"], cwd);
  if (withCommit) {
    fs.writeFileSync(path.join(cwd, "README.md"), "# demo\n");
    git(["add", "."], cwd);
    git(["commit", "-m", "feat: demo delivery"], cwd);
  }
  return cwd;
}

function makeRun(cwd, runId, status = "planned", requirement = "Build a system") {
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "request"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "review"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "agents", "T1"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status,
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: requirement },
    created_at: "2026-01-01T00:00:00.000Z"
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "request", "normalized.md"), requirement + "\n");
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({
    schema_version: 1,
    current_run_id: runId
  }, null, 2) + "\n");
  return runDir;
}

function writeProviderSupported(runDir, runId) {
  fs.writeFileSync(path.join(runDir, "orchestration", "provider-capability.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    provider: "codex",
    entry_installed: true,
    subagent_supported: "supported",
    detection_source: "test",
    detected_at: "2026-01-01T00:00:00.000Z",
    blocked: false
  }, null, 2) + "\n");
}

function writeSession(runDir, runId) {
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "planned",
    next_actions: [{
      id: "agent-dev-T1",
      kind: "agent",
      status: "ready",
      role: "dev",
      taskId: "T1",
      reason: "implement",
      inputs: [],
      outputs: [],
      dependsOn: [],
      parallelGroup: "delivery"
    }],
    agent_runs: [{
      id: "T1",
      role: "dev",
      taskId: "T1",
      status: "completed",
      executionSource: "true_harness",
      executionStatus: "completed",
      skills: ["implementation"],
      inputs: [],
      outputs: [],
      readScope: ["src/**"],
      writeScope: ["src/**"],
      dependsOn: [],
      parallelGroup: "delivery"
    }]
  }, null, 2) + "\n");
}

function writeHappyHarness(cwd, runDir, runId) {
  writeProviderSupported(runDir, runId);
  writeSession(runDir, runId);
  const patch = path.join(runDir, "agents", "T1", "patch.diff");
  fs.writeFileSync(patch, "diff --git a/src/index.js b/src/index.js\n");
  fs.writeFileSync(path.join(runDir, "agents", "T1", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "dev",
    from: "dev",
    to: "qa",
    status: "ready",
    summary: "implemented",
    commands: [],
    evidence: [patch],
    next_state: "verifying",
    files_changed: ["src/index.js"],
    verification: []
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-runs.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    agents: [{
      id: "T1",
      role: "dev",
      taskId: "T1",
      status: "completed",
      executionSource: "true_harness",
      executionStatus: "completed",
      skills: ["implementation"]
    }]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    contracts: [{ id: "T1", role: "dev", task_id: "T1", status: "done" }]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    wave_history: [{ status: "completed", action_ids: ["agent-dev-T1"], roles: ["dev"], task_ids: ["T1"] }]
  }, null, 2) + "\n");
  writeProviderExecutionReceipt(cwd, runId, {
    actionId: "agent-dev-T1",
    agentId: "T1",
    role: "dev",
    taskId: "T1",
    parallelGroup: "delivery",
    status: "completed"
  });
  fs.mkdirSync(path.join(runDir, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Tests\n\npass\n");
  fs.writeFileSync(path.join(runDir, "evidence", "review.md"), "# Review\n\npass\n");
  fs.writeFileSync(path.join(runDir, "evidence", "risk-review.md"), "# Risk\n\npass\n");
  fs.mkdirSync(path.join(runDir, "agents", "archive"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "archive"), { recursive: true });
  const archiveReport = path.join(runDir, "archive", "archive-report.md");
  fs.writeFileSync(archiveReport, "# Archive\n");
  fs.writeFileSync(path.join(runDir, "agents", "archive", "status.json"), JSON.stringify({ status: "completed" }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "agents", "archive", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "run",
    role: "archive",
    from: "archive",
    to: "orchestrator",
    status: "completed",
    summary: "archive complete",
    commands: [],
    evidence: [archiveReport],
    next_state: "completed",
    archive_report: archiveReport,
    project_updates: [],
    blocked_items: []
  }, null, 2) + "\n");
  fs.mkdirSync(path.join(cwd, "backend"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "backend", "run-tests.sh"), "#!/bin/sh\n");
  fs.mkdirSync(path.join(cwd, "docs"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "api.md"), "# API\n");
}

{
  const cwd = makeProject("imfine-early-demo-replay-", false);
  const runId = "early";
  const runDir = makeRun(cwd, runId, "completed", "从零搭建一个校园自习室预约管理系统，包含用户端小程序页面、管理后台页面、数据库设计。");
  fs.mkdirSync(path.join(cwd, "frontend", "miniprogram"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "frontend", "admin"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "backend", "db"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "frontend", "miniprogram", "app.json"), "{}\n");
  fs.writeFileSync(path.join(cwd, "frontend", "miniprogram", "app.js"), "\n");
  fs.writeFileSync(path.join(cwd, "frontend", "admin", "index.html"), "<!doctype html>\n");
  fs.writeFileSync(path.join(cwd, "frontend", "admin", "rooms.html"), "<!doctype html>\n");
  fs.writeFileSync(path.join(cwd, "backend", "db", "schema.sql"), "create table users(id integer);\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "final-gates.json"), JSON.stringify({ gates: { archive: "pass" } }, null, 2) + "\n");
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "commit").status, "blocked");
  const matrix = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.equal(matrix.items.find((item) => item.id === "product_shape.user-mini-program").status, "pass");
  assert.equal(matrix.items.find((item) => item.id === "git_delivery.commits").status, "blocked");
}

{
  const cwd = makeProject("imfine-current-demo-replay-", true);
  const runId = "current";
  const runDir = makeRun(cwd, runId, "waiting_for_agent_output", "从零搭建一个校园自习室预约管理系统，包含用户端小程序页面、管理后台页面、数据库设计。");
  fs.mkdirSync(path.join(cwd, "frontend"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "frontend", "index.html"), "<!doctype html>\n");
  fs.mkdirSync(path.join(cwd, "backend", "src", "main", "resources"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "backend", "src", "main", "resources", "schema.sql"), "create table users(id integer);\n");
  fs.writeFileSync(path.join(runDir, "review", "qa-report.md"), "Status: pass\n");
  fs.writeFileSync(path.join(runDir, "review", "code-review.md"), "Status: pass\nBlocker: 普通用户 stats 403 需要修复\nBlocker: 资源管理缺 CRUD\n");
  fs.writeFileSync(path.join(runDir, "review", "risk-review.md"), "Status: pass\nBlocker: 举报审核语义错误，需要复审证据\n");
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "acceptance_matrix").status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "true_harness").status, "blocked");
  assert.ok(fs.existsSync(path.join(runDir, "tasks", "FIX-acceptance_matrix", "status.json")));
  const matrix = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.equal(matrix.items.find((item) => item.id === "product_shape.user-mini-program").classification, "demo-substitute");
  assert.equal(matrix.items.find((item) => item.id === "product_shape.user-mini-program").status, "blocked");
  assert.ok(fs.existsSync(path.join(runDir, "orchestration", "structured-blockers.json")));
  const blockerTasks = fs.readdirSync(path.join(runDir, "tasks")).filter((name) => name.startsWith("FIX-reviewer") || name.startsWith("FIX-risk-reviewer"));
  assert.ok(blockerTasks.length >= 3);
  const finalReport = fs.readFileSync(path.join(runDir, "archive", "final-report.md"), "utf8");
  assert.match(finalReport, /## Required/);
  assert.match(finalReport, /## Demo Substitute/);
  assert.match(finalReport, /QA\/Review accepted=no/);
}

{
  const cwd = makeProject("imfine-happy-reconcile-", true);
  const runId = "happy";
  const runDir = makeRun(cwd, runId, "planned", "Build a backend system with tests.");
  writeHappyHarness(cwd, runDir, runId);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "completed");
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8")).status, "completed");
}

{
  const cwd = makeProject("imfine-agent-complete-", true);
  const runId = "agent";
  const runDir = makeRun(cwd, runId);
  writeProviderSupported(runDir, runId);
  writeSession(runDir, runId);
  const patch = path.join(runDir, "agents", "T1", "patch.diff");
  fs.writeFileSync(patch, "diff --git a/src/index.js b/src/index.js\n");
  fs.writeFileSync(path.join(runDir, "agents", "T1", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "dev",
    from: "dev",
    to: "qa",
    status: "ready",
    summary: "done",
    commands: [],
    evidence: [patch],
    next_state: "verifying",
    files_changed: ["src/index.js"],
    verification: []
  }, null, 2) + "\n");
  const orchestrated = orchestrateRun(cwd, runId);
  assert.equal(orchestrated.status, "planned");
  const startedReceipt = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "provider-receipts", "agent-dev-T1.json"), "utf8"));
  assert.equal(startedReceipt.status, "waiting_for_agent_output");
  assert.ok(startedReceipt.started_at);
  assert.ok(startedReceipt.output_path.endsWith(path.join("agents", "T1", "handoff.json")));
  const result = completeAgentAction(cwd, runId, "agent-dev-T1");
  assert.equal(result.status, "completed");
  const completedReceipt = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "provider-receipts", "agent-dev-T1.json"), "utf8"));
  assert.equal(completedReceipt.status, "completed");
  assert.ok(completedReceipt.completed_at);
  assert.equal(completedReceipt.started_at, startedReceipt.started_at);
  assert.ok(JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), "utf8")).wave_history.length > 0);
}

{
  const cwd = makeProject("imfine-resume-idempotent-", true);
  const runId = "done";
  const runDir = makeRun(cwd, runId, "planned", "Build a backend system with tests.");
  writeHappyHarness(cwd, runDir, runId);
  const completed = reconcileRun(cwd, runId);
  assert.equal(completed.status, "completed");
  const before = new Set(fs.readdirSync(path.join(runDir, "orchestration")));
  const resumed = resumeRun(cwd, runId);
  const afterResume = new Set(fs.readdirSync(path.join(runDir, "orchestration")));
  assert.equal(resumed.status, "completed");
  assert.deepEqual(afterResume, before);
  const statusValue = readStatus(cwd);
  const afterStatus = new Set(fs.readdirSync(path.join(runDir, "orchestration")));
  assert.equal(statusValue.currentRunStatus, "completed");
  assert.deepEqual(afterStatus, before);
}

for (const initialStatus of ["waiting_for_agent_output", "blocked", "completed"]) {
  const cwd = makeProject(`imfine-resume-${initialStatus}-`, true);
  const runId = `idempotent-${initialStatus}`;
  const runDir = makeRun(cwd, runId, initialStatus, "Build a backend system with tests.");
  const before = new Set(fs.existsSync(path.join(runDir, "orchestration")) ? fs.readdirSync(path.join(runDir, "orchestration")) : []);
  const resumed = resumeRun(cwd, runId);
  const after = new Set(fs.readdirSync(path.join(runDir, "orchestration")));
  assert.equal(resumed.status, initialStatus);
  assert.deepEqual(after, before);
}

console.log("reconcile ok");
