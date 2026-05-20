import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { recordProviderOriginAgentCompletion } from "../dist/core/agent-complete.js";
import { orchestrateRun, resumeRun } from "../dist/core/orchestrator.js";
import { reconcileRun } from "../dist/core/reconcile.js";
import { status as readStatus } from "../dist/core/status.js";
import { writeProviderOriginReceipt } from "../dist/core/provider-evidence.js";

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
    capabilities: {
      supports_subagent: "supported",
      supports_parallel_subagent: "supported",
      supports_agent_file_output: "supported",
      supports_agent_wait: "supported",
      supports_agent_interrupt: "unknown"
    },
    detection_source: "test",
    detected_at: "2026-01-01T00:00:00.000Z",
    blocked: false
  }, null, 2) + "\n");
}

function writeAgentAcceptanceMatrix(runDir, items) {
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-acceptance-matrix.json"), JSON.stringify({
    schema_version: 1,
    items
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
  writeProviderOriginReceipt(cwd, runId, {
    actionId: "agent-dev-T1",
    agentId: "T1",
    role: "dev",
    taskId: "T1",
    parallelGroup: "delivery",
    provider: "codex",
    providerAgentId: "codex-agent-real-T1",
    providerSessionId: `codex-session-real-${runId}`,
    providerTaskHandle: "codex-task-real-agent-dev-T1",
    outputPath: path.join(runDir, "agents", "T1", "handoff.json")
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
  fs.mkdirSync(path.join(cwd, ".imfine", "project"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "project", "overview.md"), "# Overview\n\nBackend system delivered with tests.\n");
  fs.writeFileSync(path.join(cwd, ".imfine", "project", "product.md"), "# Product\n\nBackend workflow.\n");
  fs.writeFileSync(path.join(cwd, ".imfine", "project", "architecture.md"), "# Architecture\n\nNode runtime harness fixture.\n");
  fs.writeFileSync(path.join(cwd, ".imfine", "project", "test-strategy.md"), "# Test Strategy\n\nRuntime reconcile tests.\n");
  fs.mkdirSync(path.join(runDir, "analysis"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "planning"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "analysis", "project-context.md"), "# Project Context\n\nBackend fixture.\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "context.json"), JSON.stringify({ run_id: runId }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "planning", "task-graph.json"), JSON.stringify({
    run_id: runId,
    strategy: "parallel",
    tasks: []
  }, null, 2) + "\n");
  writeAgentAcceptanceMatrix(runDir, [{
    id: "backend_api.surface",
    category: "backend_api",
    requirement_level: "required",
    classification: "required",
    status: "pass",
    detail: "agent accepted backend fixture",
    expected: "backend test runner",
    observed: "backend/run-tests.sh",
    accepted_by_review: true,
    evidence: ["backend/run-tests.sh"]
  }]);
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
  writeAgentAcceptanceMatrix(runDir, [
    {
      id: "product_shape.user-mini-program",
      category: "product_shape",
      requirement_level: "required",
      classification: "required",
      status: "pass",
      detail: "Product Planner accepted mini-program evidence",
      expected: "frontend/miniprogram app files",
      observed: "mini-program files present",
      accepted_by_review: true,
      evidence: ["frontend/miniprogram/app.json", "frontend/miniprogram/app.js"]
    },
    {
      id: "git_delivery.commits",
      category: "git_delivery",
      requirement_level: "required",
      classification: "required",
      status: "blocked",
      detail: "Commit evidence missing",
      expected: "at least one git commit",
      observed: "no commit",
      accepted_by_review: false,
      evidence: []
    }
  ]);
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
  writeAgentAcceptanceMatrix(runDir, [
    {
      id: "product_shape.user-mini-program",
      category: "product_shape",
      requirement_level: "required",
      classification: "demo-substitute",
      status: "blocked",
      detail: "QA marked static frontend as substitute, not accepted final product",
      expected: "frontend/miniprogram app files",
      observed: "static frontend substitute",
      accepted_by_review: false,
      evidence: ["frontend/index.html"]
    },
    {
      id: "tests.frontend-contract",
      category: "tests",
      requirement_level: "required",
      classification: "required",
      status: "blocked",
      detail: "Reviewer requires frontend contract evidence",
      expected: "frontend contract test",
      observed: "missing",
      accepted_by_review: false,
      evidence: []
    },
    {
      id: "documentation.delivery-set",
      category: "archive_evidence",
      requirement_level: "required",
      classification: "required",
      status: "blocked",
      detail: "Technical Writer requires delivery docs",
      expected: "README and docs",
      observed: "missing",
      accepted_by_review: false,
      evidence: []
    }
  ]);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "acceptance_matrix").status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "true_harness").status, "blocked");
  assert.ok(fs.existsSync(path.join(runDir, "tasks", "FIX-acceptance_matrix", "status.json")));
  const matrix = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.equal(matrix.items.find((item) => item.id === "product_shape.user-mini-program").classification, "demo-substitute");
  assert.equal(matrix.items.find((item) => item.id === "product_shape.user-mini-program").status, "blocked");
  assert.equal(matrix.items.find((item) => item.id === "tests.frontend-contract").status, "blocked");
  assert.equal(matrix.items.find((item) => item.id === "documentation.delivery-set").status, "blocked");
  assert.ok(fs.existsSync(path.join(runDir, "orchestration", "structured-blockers.json")));
  const blockerMatrix = JSON.parse(fs.readFileSync(path.join(runDir, "review", "blocker-matrix.json"), "utf8"));
  assert.ok(blockerMatrix.rows.length > 0);
  assert.ok(blockerMatrix.rows.some((row) => row.status === "still_blocking"));
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
  const gates = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "final-gates.json"), "utf8")).gates;
  for (const gate of ["planning", "dispatch", "qa", "review", "recheck_fix_loop", "committer", "push", "archive", "true_harness", "project_knowledge"]) {
    assert.equal(gates[gate], "pass", `${gate} should pass`);
  }
  const freshness = JSON.parse(fs.readFileSync(path.join(cwd, ".imfine", "project", "project-knowledge-freshness.json"), "utf8"));
  assert.equal(freshness.status, "fresh");
}

{
  const cwd = makeProject("imfine-provider-origin-agent-complete-", true);
  const runId = "agent-provider";
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
  orchestrateRun(cwd, runId);
  const result = recordProviderOriginAgentCompletion(cwd, runId, "agent-dev-T1", {
    provider: "codex",
    providerAgentId: "codex-agent-real-T1",
    providerSessionId: `codex-session-real-${runId}`,
    providerTaskHandle: "codex-task-real-agent-dev-T1"
  });
  assert.equal(result.status, "completed");
  const receipt = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "provider-receipts", "agent-dev-T1.json"), "utf8"));
  assert.equal(receipt.origin, "provider_native_subagent");
  assert.equal(receipt.receipt_type, "provider_completed");
  assert.equal(receipt.provider_task_handle, "codex-task-real-agent-dev-T1");
  assert.ok(receipt.output_path.endsWith(path.join("orchestration", "provider-outputs", "agent-dev-T1.json")));
  assert.equal(receipt.metadata.handoff_file, path.join(runDir, "agents", "T1", "handoff.json"));
  assert.ok(receipt.integrity.output_sha256);
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
