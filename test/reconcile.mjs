import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { recordProviderOriginAgentCompletion } from "../dist/core/agent-complete.js";
import { blockerSummary } from "../dist/core/blocker-summary.js";
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

function makeNonGitProject(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
    required_coverage_declared_complete: true,
    items
  }, null, 2) + "\n");
}

const requiredAcceptanceIds = [
  "user_auth.register_login",
  "seat.floor_management",
  "seat.seat_management",
  "reservation.timeslot_booking",
  "reservation.timeout_auto_release",
  "report.occupancy_report",
  "admin.review_workflow",
  "analytics.seat_usage_statistics",
  "architecture.frontend_backend_separation",
  "api.rest_api",
  "frontend.user_mini_program",
  "frontend.admin_pages",
  "database.entities_and_relations",
  "tests.interface_unit_tests",
  "frontend.form_validation_and_pagination"
];

function fullAcceptanceItems(evidence = "backend/run-tests.sh") {
  return requiredAcceptanceIds.map((id) => ({
    id,
    category: "required_acceptance_coverage",
    requirement_level: "required",
    classification: "required",
    status: "pass",
    detail: `agent accepted ${id}`,
    expected: id,
    observed: evidence,
    accepted_by_review: true,
    evidence: [evidence]
  }));
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
  fs.writeFileSync(path.join(cwd, "README.md"), "# Demo\n\nRuntime: Node.js >=22.\n\nRun tests with `npm run test`.\n");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    engines: { node: ">=22" },
    scripts: { test: "node --test" }
  }, null, 2) + "\n");
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
  fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Tests\n\n- runtime version: node v22.17.0\n- command: npm run test\n\n```text\nPASS 4 tests\n```\n");
  fs.writeFileSync(path.join(runDir, "evidence", "review.md"), "# Review\n\npass\n");
  fs.writeFileSync(path.join(runDir, "evidence", "risk-review.md"), "# Risk\n\npass\n");
  fs.mkdirSync(path.join(runDir, "agents", "qa-T1"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "agents", "qa-T1", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "qa passed",
    commands: [],
    failures: [],
    evidence: [path.join(runDir, "evidence", "test-results.md")],
    next_state: "reviewing"
  }, null, 2) + "\n");
  fs.mkdirSync(path.join(runDir, "agents", "reviewer-T1"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "agents", "reviewer-T1", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "reviewer",
    from: "reviewer",
    to: "archive",
    status: "approved",
    summary: "review approved",
    commands: [],
    findings: [],
    evidence: [path.join(runDir, "evidence", "review.md")],
    next_state: "committing"
  }, null, 2) + "\n");
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
  writeAgentAcceptanceMatrix(runDir, fullAcceptanceItems());
  const existing = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "agent-acceptance-matrix.json"), "utf8"));
  existing.items.push({
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
  });
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-acceptance-matrix.json"), JSON.stringify(existing, null, 2) + "\n");
}

function writeMinimalTaskGraph(runDir, runId) {
  fs.mkdirSync(path.join(runDir, "planning"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "planning", "task-graph.json"), JSON.stringify({
    run_id: runId,
    strategy: "parallel",
    tasks: []
  }, null, 2) + "\n");
}

function writeQualityHandoff(runDir, agentId, payload) {
  const agentDir = path.join(runDir, "agents", agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "handoff.json"), JSON.stringify(payload, null, 2) + "\n");
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
      evidence: ["frontend/index.html"],
      deviation: {
        requested: "frontend/miniprogram app files",
        delivered: "static frontend substitute",
        reason: "demo fixture intentionally omits mini-program runtime",
        risk: "cannot prove real mini-program behavior",
        accepted_by: [],
        evidence: ["frontend/index.html"],
        required_follow_up: ["build real mini-program pages"]
      }
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
  assert.match(finalReport, /^# Blocked Archive Report/);
  assert.match(finalReport, /## Evidence Origin/);
  assert.match(finalReport, /Agent-authored:/);
  assert.match(finalReport, /Runtime-derived:/);
  assert.match(finalReport, /## Gate Phase/);
  assert.match(finalReport, /\[gate:role-purity\] role purity:/);
  assert.match(finalReport, /\[gate:final-gates\] final gates:/);
  assert.match(finalReport, /## Required/);
  assert.match(finalReport, /## Demo Substitute/);
  assert.match(finalReport, /QA\/Review accepted=no/);
}

{
  const cwd = makeProject("imfine-acceptance-agent-declared-coverage-", true);
  const runId = "declared-coverage";
  const runDir = makeRun(cwd, runId, "planned", "Build a small API.");
  fs.mkdirSync(path.join(cwd, "api"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "api", "index.js"), "export const ok = true;\n");
  writeAgentAcceptanceMatrix(runDir, [{
    id: "api.basic-delivery",
    category: "api",
    requirement_level: "required",
    classification: "required",
    status: "pass",
    detail: "Agent declared API requirement covered.",
    expected: "API implementation",
    observed: "api/index.js",
    accepted_by_review: true,
    evidence: ["api/index.js"]
  }]);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "acceptance_matrix").status, "pass");
  const matrix = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.equal(matrix.summary.required_coverage_declared_complete, true);
  assert.equal(matrix.items.some((item) => item.id === "frontend.user_mini_program"), false);
}

{
  const cwd = makeProject("imfine-acceptance-coverage-not-declared-", true);
  const runId = "coverage-not-declared";
  const runDir = makeRun(cwd, runId, "planned", "Build a small API.");
  fs.mkdirSync(path.join(cwd, "api"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "api", "index.js"), "export const ok = true;\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-acceptance-matrix.json"), JSON.stringify({
    schema_version: 1,
    items: [{
      id: "api.basic-delivery",
      category: "api",
      requirement_level: "required",
      classification: "required",
      status: "pass",
      detail: "Agent listed one requirement but did not declare complete coverage.",
      expected: "API implementation",
      observed: "api/index.js",
      accepted_by_review: true,
      evidence: ["api/index.js"]
    }]
  }, null, 2) + "\n");
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "acceptance_matrix").status, "blocked");
  const matrix = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.ok(matrix.items.some((item) => item.id === "agent_authored_acceptance_matrix.required_coverage_not_declared"));
}

{
  const cwd = makeProject("imfine-acceptance-required-evidence-missing-", true);
  const runId = "required-evidence-missing";
  const runDir = makeRun(cwd, runId, "planned", "Build a small API.");
  writeAgentAcceptanceMatrix(runDir, [{
    id: "api.basic-delivery",
    category: "api",
    requirement_level: "required",
    classification: "required",
    status: "pass",
    detail: "Agent accepted without evidence.",
    expected: "API implementation",
    observed: "claimed",
    accepted_by_review: true,
    evidence: []
  }]);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "acceptance_matrix").status, "blocked");
  const matrix = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.match(matrix.items.find((item) => item.id === "api.basic-delivery").detail, /required item lacks evidence/);
}

{
  const cwd = makeProject("imfine-acceptance-deviation-not-qa-review-", true);
  const runId = "deviation-not-qa-review";
  const runDir = makeRun(cwd, runId, "planned", "Build durable storage.");
  fs.mkdirSync(path.join(cwd, "backend"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "backend", "run-tests.sh"), "#!/bin/sh\n");
  writeAgentAcceptanceMatrix(runDir, [{
    id: "storage.demo-substitute",
    category: "storage",
    requirement_level: "required",
    classification: "deviation",
    status: "pass",
    detail: "Agent accepted substitute without QA/Reviewer approval.",
    expected: "durable storage",
    observed: "in-memory store",
    accepted_by_review: true,
    evidence: ["backend/run-tests.sh"],
    deviation: {
      requested: "durable storage",
      delivered: "in-memory store",
      reason: "demo scope",
      risk: "data is not durable",
      accepted_by: ["architect"],
      evidence: ["backend/run-tests.sh"],
      required_follow_up: ["replace with durable storage"]
    }
  }]);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "acceptance_matrix").status, "blocked");
  const matrix = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.match(matrix.items.find((item) => item.id === "storage.demo-substitute").detail, /accepted_by_qa_or_reviewer/);
}

{
  const cwd = makeProject("imfine-deviation-template-accepted-", true);
  const runId = "deviation";
  const runDir = makeRun(cwd, runId, "planned", "Build a backend system with tests.");
  writeHappyHarness(cwd, runDir, runId);
  writeAgentAcceptanceMatrix(runDir, fullAcceptanceItems());
  const existing = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "agent-acceptance-matrix.json"), "utf8"));
  existing.items.push({
    id: "database.demo-substitute",
    category: "storage",
    requirement_level: "required",
    classification: "deviation",
    status: "pass",
    detail: "Reviewer accepted in-memory demo substitute with follow-up",
    expected: "database tables",
    observed: "in-memory store",
    accepted_by_review: true,
    evidence: ["backend/run-tests.sh"],
    deviation: {
      requested: "database tables",
      delivered: "in-memory store",
      reason: "demo scope",
      risk: "data is not durable",
      accepted_by: ["qa", "reviewer"],
      evidence: ["backend/run-tests.sh"],
      required_follow_up: ["replace with persistent database before production"]
    }
  });
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-acceptance-matrix.json"), JSON.stringify(existing, null, 2) + "\n");
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "acceptance_matrix").status, "pass");
  const matrix = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.equal(matrix.items.find((item) => item.id === "database.demo-substitute").deviation.required_follow_up[0], "replace with persistent database before production");
}

{
  const cwd = makeProject("imfine-handoff-evidence-collector-", true);
  const runId = "collector";
  const runDir = makeRun(cwd, runId, "planned", "Collect standard evidence from handoff references.");
  fs.mkdirSync(path.join(cwd, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "evidence", "qa-output.md"), "# QA\n\npass\n");
  fs.mkdirSync(path.join(runDir, "agents", "qa-T1"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "agents", "qa-T1", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "qa pass",
    commands: [],
    evidence: ["evidence/qa-output.md"],
    next_state: "reviewing"
  }, null, 2) + "\n");
  reconcileRun(cwd, runId);
  const testEvidence = path.join(runDir, "evidence", "test-results.md");
  assert.ok(fs.existsSync(testEvidence));
  assert.match(fs.readFileSync(testEvidence, "utf8"), /Indexed from standard handoff evidence references/);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "standard-evidence.json"), "utf8"));
  const qaRecord = manifest.records.find((item) => item.id === "qa");
  assert.equal(qaRecord.exists, true);
  assert.ok(qaRecord.sources.some((item) => item.endsWith("evidence/qa-output.md")));
}

{
  const cwd = makeProject("imfine-quality-lineage-coverage-", true);
  const runId = "quality-coverage";
  const runDir = makeRun(cwd, runId, "planned", "Block partial QA and review coverage.");
  fs.mkdirSync(path.join(runDir, "planning"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "planning", "task-graph.json"), JSON.stringify({
    run_id: runId,
    strategy: "parallel",
    tasks: [
      { id: "T1", type: "dev", title: "one" },
      { id: "T2", type: "dev", title: "two" }
    ]
  }, null, 2) + "\n");
  fs.mkdirSync(path.join(runDir, "evidence"), { recursive: true });
  const qaEvidence = path.join(runDir, "evidence", "qa-T1.md");
  const reviewEvidence = path.join(runDir, "evidence", "review-T1.md");
  fs.writeFileSync(qaEvidence, "# QA T1\n\npass\n");
  fs.writeFileSync(reviewEvidence, "# Review T1\n\napproved\n");
  writeQualityHandoff(runDir, "qa-T1", {
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "QA passed T1",
    commands: [],
    failures: [],
    evidence: [qaEvidence],
    next_state: "reviewing"
  });
  writeQualityHandoff(runDir, "reviewer-T1", {
    run_id: runId,
    task_id: "T1",
    role: "reviewer",
    from: "reviewer",
    to: "archive",
    status: "approved",
    summary: "Review approved T1",
    commands: [],
    findings: [],
    evidence: [reviewEvidence],
    next_state: "committing"
  });
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "qa").status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "review").status, "blocked");
  const lineage = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "quality-lineage.json"), "utf8"));
  assert.equal(lineage.summary.qa, "blocked");
  assert.equal(lineage.summary.review, "blocked");
  assert.deepEqual(lineage.summary.coverage.qa, { passed: 1, expected: 2, missing: ["T2"] });
  assert.deepEqual(lineage.summary.coverage.review, { passed: 1, expected: 2, missing: ["T2"] });
}

{
  const cwd = makeProject("imfine-stale-blocker-summary-", true);
  const runId = "stale-blocker";
  const runDir = makeRun(cwd, runId, "waiting_for_agent_output", "Clear stale blocker files from current evidence.");
  const handoff = path.join(runDir, "agents", "T1", "handoff.json");
  const patch = path.join(runDir, "agents", "T1", "patch.diff");
  fs.mkdirSync(path.dirname(handoff), { recursive: true });
  fs.writeFileSync(patch, "diff --git a/src/index.js b/src/index.js\n");
  fs.writeFileSync(handoff, JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "dev",
    from: "dev",
    to: "qa",
    status: "ready",
    summary: "implementation ready",
    commands: [],
    evidence: [patch],
    next_state: "verifying",
    files_changed: ["src/index.js"],
    verification: []
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "provider-capability.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    provider: "codex",
    entry_installed: "unknown",
    subagent_supported: "unknown",
    capabilities: {
      supports_subagent: "unknown",
      supports_parallel_subagent: "unknown",
      supports_agent_file_output: "unknown",
      supports_agent_wait: "unknown",
      supports_agent_interrupt: "unknown"
    },
    detection_source: "test",
    detected_at: "2026-01-01T00:00:00.000Z",
    blocked: true,
    blocked_reason: "current provider has not confirmed native subagent dispatch support"
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "handoff-validation.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    passed: false,
    errors: ["architect: handoff evidence missing design/design.md"]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    contracts: [
      {
        id: "T1",
        kind: "agent",
        action_id: "agent-dev-T1",
        role: "dev",
        task_id: "T1",
        status: "done",
        expected_handoff_path: handoff
      },
      {
        id: "T2",
        kind: "agent",
        action_id: "agent-dev-T2",
        role: "dev",
        task_id: "T2",
        status: "ready",
        expected_handoff_path: path.join(runDir, "agents", "T2", "handoff.json")
      }
    ]
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
    outputPath: handoff
  });
  const summary = blockerSummary(cwd, runId);
  assert.equal(summary.status, "clear");
  assert.equal(summary.sources.flatMap((source) => source.blockers).length, 0);
}

{
  const cwd = makeProject("imfine-qa-recheck-lineage-", true);
  const runId = "qa-recheck";
  const runDir = makeRun(cwd, runId, "planned", "Model QA recheck lineage.");
  writeMinimalTaskGraph(runDir, runId);
  const firstEvidence = path.join(runDir, "evidence", "qa-first.md");
  const recheckEvidence = path.join(runDir, "evidence", "qa-recheck.md");
  fs.mkdirSync(path.dirname(firstEvidence), { recursive: true });
  fs.writeFileSync(firstEvidence, "# QA first\n\nfail\n");
  fs.writeFileSync(recheckEvidence, "# QA recheck\n\npass\n");
  writeQualityHandoff(runDir, "qa-T1", {
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "dev",
    status: "fail",
    summary: "QA found login failure",
    commands: [],
    failures: ["qa-login-failure"],
    finding_ids: ["qa-login-failure"],
    evidence: [firstEvidence],
    next_state: "needs_dev_fix",
    fix_task_id: "FIX-T1-1"
  });
  writeQualityHandoff(runDir, "qa-T1-recheck", {
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "QA recheck passed after fix",
    commands: [],
    failures: [],
    evidence: [recheckEvidence],
    resolves: ["qa-login-failure"],
    supersedes: ["qa-login-failure"],
    next_state: "reviewing"
  });
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "qa").status, "pass");
  assert.equal(result.gates.find((gate) => gate.id === "recheck_fix_loop").status, "pass");
  const lineage = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "quality-lineage.json"), "utf8"));
  assert.equal(lineage.summary.qa, "pass");
  const qaLineage = lineage.lineages.find((item) => item.role === "qa");
  assert.deepEqual(qaLineage.resolved_findings, ["qa-login-failure"]);
  assert.match(qaLineage.latest_handoff, /qa-T1-recheck\/handoff\.json$/);
}

{
  const cwd = makeProject("imfine-review-recheck-lineage-", true);
  const runId = "review-recheck";
  const runDir = makeRun(cwd, runId, "planned", "Model reviewer recheck lineage.");
  writeMinimalTaskGraph(runDir, runId);
  const firstEvidence = path.join(runDir, "evidence", "review-first.md");
  const recheckEvidence = path.join(runDir, "evidence", "review-recheck.md");
  fs.mkdirSync(path.dirname(firstEvidence), { recursive: true });
  fs.writeFileSync(firstEvidence, "# Review first\n\nchanges requested\n");
  fs.writeFileSync(recheckEvidence, "# Review recheck\n\napproved\n");
  writeQualityHandoff(runDir, "reviewer-T1", {
    run_id: runId,
    task_id: "T1",
    role: "reviewer",
    from: "reviewer",
    to: "dev",
    status: "changes_requested",
    summary: "Review found missing authorization",
    commands: [],
    findings: [{ id: "review-authz-missing", severity: "high", file: "src/api.js", line: 1, issue: "missing authz", required_change: "add authz" }],
    evidence: [firstEvidence],
    next_state: "needs_dev_fix",
    fix_task_id: "FIX-T1-2"
  });
  writeQualityHandoff(runDir, "reviewer-T1-recheck", {
    run_id: runId,
    task_id: "T1",
    role: "reviewer",
    from: "reviewer",
    to: "archive",
    status: "approved",
    summary: "Reviewer recheck approved fix",
    commands: [],
    findings: [],
    evidence: [recheckEvidence],
    resolves: ["review-authz-missing"],
    supersedes: ["review-authz-missing"],
    next_state: "committing"
  });
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "review").status, "pass");
  assert.equal(result.gates.find((gate) => gate.id === "recheck_fix_loop").status, "pass");
  const evidence = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "true-harness-evidence.json"), "utf8"));
  assert.equal(evidence.quality_lineage.summary.review, "pass");
  const reviewLineage = evidence.quality_lineage.lineages.find((item) => item.role === "reviewer");
  assert.deepEqual(reviewLineage.resolved_findings, ["review-authz-missing"]);
  assert.match(reviewLineage.latest_handoff, /reviewer-T1-recheck\/handoff\.json$/);
}

{
  const cwd = makeProject("imfine-recheck-without-lineage-", true);
  const runId = "recheck-without-lineage";
  const runDir = makeRun(cwd, runId, "planned", "Reject recheck without lineage.");
  writeMinimalTaskGraph(runDir, runId);
  const firstEvidence = path.join(runDir, "evidence", "qa-first.md");
  const recheckEvidence = path.join(runDir, "evidence", "qa-recheck.md");
  fs.mkdirSync(path.dirname(firstEvidence), { recursive: true });
  fs.writeFileSync(firstEvidence, "# QA first\n\nfail\n");
  fs.writeFileSync(recheckEvidence, "# QA recheck\n\npass\n");
  writeQualityHandoff(runDir, "qa-T1", {
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "dev",
    status: "fail",
    summary: "QA found blocker",
    commands: [],
    failures: ["qa-blocker"],
    finding_ids: ["qa-blocker"],
    evidence: [firstEvidence],
    next_state: "needs_dev_fix",
    fix_task_id: "FIX-T1-1"
  });
  writeQualityHandoff(runDir, "qa-T1-recheck", {
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "QA recheck passed but forgot lineage",
    commands: [],
    failures: [],
    evidence: [recheckEvidence],
    next_state: "reviewing"
  });
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "qa").status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "recheck_fix_loop").status, "blocked");
  const lineage = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "quality-lineage.json"), "utf8"));
  assert.deepEqual(lineage.lineages.find((item) => item.role === "qa").unresolved_findings, ["qa-blocker"]);
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
  for (const gate of ["planning", "dispatch", "qa", "review", "recheck_fix_loop", "runtime_requirements", "committer", "push", "archive", "true_harness", "project_knowledge"]) {
    assert.equal(gates[gate], "pass", `${gate} should pass`);
  }
  assert.equal(gates.orchestrator_runtime_consistency, "pass");
  const finalReport = fs.readFileSync(path.join(runDir, "archive", "final-report.md"), "utf8");
  assert.match(finalReport, /^# Final Archive Report/);
  assert.match(finalReport, /## Evidence Origin/);
  assert.match(finalReport, /## Gate Phase/);
  assert.match(finalReport, /\[gate:final-gates\] final gates: pass/);
  const userReport = fs.readFileSync(path.join(cwd, ".imfine", "reports", `${runId}.md`), "utf8");
  assert.equal(userReport, finalReport);
  const freshness = JSON.parse(fs.readFileSync(path.join(cwd, ".imfine", "project", "project-knowledge-freshness.json"), "utf8"));
  assert.equal(freshness.status, "fresh");
}

{
  const cwd = makeProject("imfine-runtime-requirements-reconcile-blocked-", true);
  const runId = "runtime-req-blocked";
  const runDir = makeRun(cwd, runId, "planned", "Build a backend system with tests.");
  writeHappyHarness(cwd, runDir, runId);
  fs.rmSync(path.join(cwd, "README.md"));
  fs.rmSync(path.join(cwd, "package.json"));
  fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Tests\n\npass\n");
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  const gate = result.gates.find((item) => item.id === "runtime_requirements");
  assert.equal(gate.status, "blocked");
  assert.match(gate.detail, /runtime_version_declaration/);
  assert.match(gate.detail, /qa_records_runtime_version/);
  const runtimeRequirements = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "runtime-requirements.json"), "utf8"));
  assert.equal(runtimeRequirements.status, "blocked");
  const finalGates = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "final-gates.json"), "utf8"));
  assert.equal(finalGates.gates.runtime_requirements, "blocked");
}

{
  const cwd = makeProject("imfine-runtime-requirements-reconcile-pass-", true);
  const runId = "runtime-req-pass";
  const runDir = makeRun(cwd, runId, "planned", "Build a backend system with tests.");
  writeHappyHarness(cwd, runDir, runId);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((item) => item.id === "runtime_requirements").status, "pass");
  const finalReport = fs.readFileSync(path.join(runDir, "archive", "final-report.md"), "utf8");
  assert.match(finalReport, /## Runtime Requirements/);
  assert.match(finalReport, /runtime-requirements\.json/);
}

{
  const cwd = makeNonGitProject("imfine-non-git-commit-policy-");
  const runId = "non-git";
  const runDir = makeRun(cwd, runId, "planned", "Build without git should not complete.");
  writeHappyHarness(cwd, runDir, runId);
  fs.writeFileSync(path.join(runDir, "evidence", "commits.md"), "# Commit Evidence\n\n- stale old file\n");
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "commit").status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "committer").status, "blocked");
  const run = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
  assert.equal(run.status, "blocked");
  assert.equal(run.commit_blocked_reason, "git repository is not initialized");
  assert.match(fs.readFileSync(path.join(runDir, "evidence", "commits.md"), "utf8"), /blocked_no_git_repository/);
}

{
  const cwd = makeProject("imfine-no-remote-push-policy-", true);
  const runId = "no-remote";
  const runDir = makeRun(cwd, runId, "planned", "No remote should record push blocker.");
  writeHappyHarness(cwd, runDir, runId);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.gates.find((gate) => gate.id === "push").status, "pass");
  const run = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
  assert.equal(run.push_status, "push_blocked_no_remote");
  assert.match(fs.readFileSync(path.join(runDir, "evidence", "push.md"), "utf8"), /configure origin remote/);
}

{
  const cwd = makeProject("imfine-completed-report-commit-hash-", true);
  const runId = "completed-commit-hash";
  const runDir = makeRun(cwd, runId, "planned", "Completed report must cite commit hash.");
  writeHappyHarness(cwd, runDir, runId);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "completed");
  const run = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
  assert.ok(Array.isArray(run.commit_hashes) && run.commit_hashes.length > 0);
  const finalReport = fs.readFileSync(path.join(runDir, "archive", "final-report.md"), "utf8");
  assert.match(finalReport, /## Commit Trace/);
  assert.match(finalReport, new RegExp(run.commit_hashes[0].slice(0, 12)));
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
