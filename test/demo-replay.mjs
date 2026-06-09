import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileRun } from "../dist/core/reconcile.js";
import { status as readStatus } from "../dist/core/status.js";
import { writeTrueHarnessEvidence } from "../dist/core/true-harness-evidence.js";

const demoRoots = {
  early: "/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo",
  current: "/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo1"
};

function copyDemo(source, prefix) {
  assert.ok(fs.existsSync(source), `demo fixture missing: ${source}`);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(source, target, {
    recursive: true,
    dereference: false,
    filter: (file) => !file.includes(`${path.sep}backend${path.sep}build${path.sep}`)
  });
  return target;
}

function runIds(cwd) {
  const runs = path.join(cwd, ".imfine", "runs");
  return fs.readdirSync(runs)
    .filter((entry) => fs.existsSync(path.join(runs, entry, "run.json")))
    .sort();
}

function ensureAgentAcceptanceMatrix(cwd, runId, items) {
  const file = path.join(cwd, ".imfine", "runs", runId, "orchestration", "agent-acceptance-matrix.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, required_coverage_declared_complete: true, items }, null, 2) + "\n");
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-current-run-warning-"));
  const currentRunId = "current-low-evidence";
  const richerRunId = "previous-rich-evidence";
  const currentRunDir = path.join(cwd, ".imfine", "runs", currentRunId);
  const richerRunDir = path.join(cwd, ".imfine", "runs", richerRunId);
  fs.mkdirSync(path.join(currentRunDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(richerRunDir, "agents", "T1"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({ current_run_id: currentRunId }, null, 2) + "\n");
  for (const [runId, runDir, status] of [
    [currentRunId, currentRunDir, "waiting_for_agent_output"],
    [richerRunId, richerRunDir, "blocked"]
  ]) {
    fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
      schema_version: 1,
      run_id: runId,
      status,
      execution_mode: "true_harness",
      project_kind: "new_project",
      source: { type: "text", value: "warning fixture" }
    }, null, 2) + "\n");
  }
  fs.writeFileSync(path.join(richerRunDir, "agents", "T1", "handoff.json"), JSON.stringify({
    run_id: richerRunId,
    task_id: "T1",
    role: "dev",
    from: "dev",
    to: "qa",
    status: "ready",
    summary: "previous evidence",
    commands: [],
    evidence: [],
    next_state: "verifying"
  }, null, 2) + "\n");

  const value = readStatus(cwd);
  assert.ok(value.currentRunDemoWarnings.some((warning) => warning.includes(richerRunId)));
}

{
  const cwd = copyDemo(demoRoots.early, "imfine-real-early-demo-");
  const runId = runIds(cwd).find((id) => !id.endsWith("-2"));
  if (runId) {
    ensureAgentAcceptanceMatrix(cwd, runId, [{
      id: "git_delivery.commits",
      category: "git_delivery",
      requirement_level: "required",
      classification: "required",
      status: "blocked",
      detail: "commit evidence missing",
      expected: "commit evidence",
      observed: "missing",
      accepted_by_review: false,
      evidence: []
    }]);
    const result = reconcileRun(cwd, runId);
    assert.equal(result.status, "blocked");
    assert.equal(result.gates.find((gate) => gate.id === "commit").status, "blocked");
    const run = JSON.parse(fs.readFileSync(path.join(cwd, ".imfine", "runs", runId, "run.json"), "utf8"));
    assert.equal(run.status, "blocked");
  } else {
    const status = readStatus(cwd);
    assert.equal(status.initialized, true);
    assert.equal(status.currentRunId, null);
  }
}

{
  const cwd = copyDemo(demoRoots.current, "imfine-real-current-demo-");
  const runId = runIds(cwd)[0];
  assert.ok(runId);
  ensureAgentAcceptanceMatrix(cwd, runId, [{
    id: "product_shape.user-mini-program",
    category: "product_shape",
    requirement_level: "required",
    classification: "demo-substitute",
    status: "blocked",
    detail: "QA rejected substitute frontend as final mini-program evidence",
    expected: "mini-program frontend",
    observed: "static frontend substitute",
    accepted_by_review: false,
    evidence: []
  }]);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "commit").status, "pass");
  assert.equal(result.gates.find((gate) => gate.id === "true_harness").status, "blocked");
  const matrix = JSON.parse(fs.readFileSync(path.join(cwd, ".imfine", "runs", runId, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.ok(matrix.items.some((item) => item.id === "product_shape.user-mini-program" && item.classification === "demo-substitute" && item.status === "blocked"));
  const report = fs.readFileSync(path.join(cwd, ".imfine", "runs", runId, "archive", "final-report.md"), "utf8");
  assert.match(report, /^# Blocked Archive Report/);
  assert.match(report, /## Demo Substitute/);
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-demo1-minimized-"));
  const runId = "demo1-minimized";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({ current_run_id: runId }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: "demo1 minimized" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "completed",
    next_actions: [{
      id: "agent-qa",
      kind: "agent",
      status: "done",
      role: "qa",
      reason: "claimed complete",
      inputs: [],
      outputs: [],
      dependsOn: [],
      parallelGroup: "qa"
    }],
    agent_runs: [{
      id: "qa",
      role: "qa",
      status: "completed",
      skills: ["verification"],
      inputs: [],
      outputs: [],
      readScope: [],
      writeScope: [],
      dependsOn: [],
      parallelGroup: "qa"
    }]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-runs.json"), JSON.stringify({ schema_version: 1, run_id: runId, agents: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), JSON.stringify({ schema_version: 1, run_id: runId, contracts: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), JSON.stringify({ schema_version: 1, run_id: runId, wave_history: [] }, null, 2) + "\n");
  const before = readStatus(cwd);
  assert.equal(before.currentRunConsistency, "inconsistent");
  assert.equal(before.currentRunGates.status_consistency, "orchestrator_session_unadopted");
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "true_harness").status, "blocked");
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8")).status, "completed");
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-ingest-session-"));
  const runId = "ingest-session";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "agents", "qa"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({ current_run_id: runId }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: "ingest session" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "waiting_for_agent_output",
    next_actions: [{
      id: "agent-qa",
      kind: "agent",
      status: "ready",
      role: "qa",
      reason: "verify",
      inputs: [],
      outputs: [path.join(runDir, "agents", "qa", "handoff.json")],
      dependsOn: [],
      parallelGroup: "qa"
    }],
    agent_runs: [{
      id: "qa",
      role: "qa",
      status: "ready",
      skills: ["verification"],
      inputs: [],
      outputs: [path.join(runDir, "agents", "qa", "handoff.json")],
      readScope: [],
      writeScope: [path.join(runDir, "agents", "qa", "**")],
      dependsOn: [],
      parallelGroup: "qa"
    }]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-runs.json"), JSON.stringify({ schema_version: 1, run_id: runId, agents: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), JSON.stringify({ schema_version: 1, run_id: runId, contracts: [] }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), JSON.stringify({ schema_version: 1, run_id: runId, wave_history: [] }, null, 2) + "\n");

  const value = readStatus(cwd);
  assert.equal(value.currentRunStatus, "waiting_for_agent_output");
  const dispatch = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), "utf8"));
  const agentRuns = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "agent-runs.json"), "utf8"));
  const consistency = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "orchestrator-runtime-consistency.json"), "utf8"));
  assert.equal(dispatch.contracts.length, 1);
  assert.equal(dispatch.contracts[0].action_id, "agent-qa");
  assert.equal(agentRuns.agents.length, 1);
  assert.equal(agentRuns.agents[0].id, "qa");
  assert.deepEqual(value.currentRunDispatch.missingCompletedWaveActionIds, ["agent-qa"]);
  const parallel = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), "utf8"));
  assert.equal(parallel.wave_history.length, 1);
  assert.equal(parallel.wave_history[0].status, "waiting_for_agent_output");
  assert.deepEqual(parallel.wave_history[0].action_ids, ["agent-qa"]);
  assert.equal(consistency.status, "pass");
  assert.equal(consistency.session_action_count, 1);
  assert.equal(consistency.dispatch_contract_count, 1);

  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8")).status, "completed");
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-ingest-completed-wave-"));
  const runId = "ingest-completed-wave";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  const handoff = path.join(runDir, "agents", "qa-T1", "handoff.json");
  fs.mkdirSync(path.dirname(handoff), { recursive: true });
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({ current_run_id: runId }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: "ingest completed wave" }
  }, null, 2) + "\n");
  fs.writeFileSync(handoff, JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "qa finished",
    commands: [],
    failures: [],
    evidence: [handoff],
    next_state: "reviewing"
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "waiting_for_agent_output",
    next_actions: [{
      id: "agent-qa-T1",
      kind: "agent",
      status: "done",
      role: "qa",
      taskId: "T1",
      reason: "qa complete",
      inputs: [],
      outputs: [handoff],
      dependsOn: [],
      parallelGroup: "qa"
    }],
    agent_runs: [{
      id: "qa-T1",
      role: "qa",
      taskId: "T1",
      status: "completed",
      skills: ["verification"],
      inputs: [],
      outputs: [handoff],
      readScope: [],
      writeScope: [path.join(runDir, "agents", "qa-T1", "**")],
      dependsOn: [],
      parallelGroup: "qa"
    }]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), JSON.stringify({ schema_version: 1, run_id: runId, wave_history: [] }, null, 2) + "\n");

  const value = readStatus(cwd);
  assert.deepEqual(value.currentRunDispatch.missingCompletedWaveActionIds, []);
  const parallel = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), "utf8"));
  assert.equal(parallel.wave_history.length, 2);
  assert.equal(parallel.wave_history[0].status, "waiting_for_agent_output");
  assert.equal(parallel.wave_history[1].status, "completed");
  assert.deepEqual(parallel.executed_parallel_groups, ["qa"]);
  const evidence = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.deepEqual(evidence.parallel_execution.missing_completed_wave_contracts, []);
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-planned-action-contract-"));
  const runId = "planned-action-contract";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({ current_run_id: runId }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: "planned action contract" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "waiting_for_agent_output",
    next_actions: [{
      id: "agent-dev-T1",
      kind: "agent",
      status: "ready",
      role: "dev",
      taskId: "T1",
      reason: "implement T1",
      inputs: ["planning/task-graph.json"],
      outputs: [path.join(runDir, "agents", "T1", "handoff.json")],
      dependsOn: [],
      parallelGroup: "delivery"
    }],
    agent_runs: []
  }, null, 2) + "\n");

  const value = readStatus(cwd);
  const dispatch = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), "utf8"));
  const parallel = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), "utf8"));
  assert.equal(dispatch.contracts.length, 1);
  assert.equal(dispatch.contracts[0].action_id, "agent-dev-T1");
  assert.equal(dispatch.contracts[0].role, "dev");
  assert.equal(dispatch.contracts[0].task_id, "T1");
  assert.deepEqual(dispatch.contracts[0].depends_on, []);
  assert.equal(dispatch.contracts[0].parallel_group, "delivery");
  assert.match(dispatch.contracts[0].expected_handoff_path, /agents\/T1\/handoff\.json$/);
  assert.match(dispatch.contracts[0].expected_provider_receipt_path, /provider-receipts\/agent-dev-T1\.json$/);
  assert.deepEqual(parallel.wave_history.map((wave) => wave.status), ["waiting_for_agent_output"]);
  assert.deepEqual(value.currentRunDispatch.missingCompletedWaveActionIds, ["agent-dev-T1"]);
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-adopt-existing-handoff-"));
  const runId = "adopt-existing-handoff";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  const handoff = path.join(runDir, "agents", "T1", "handoff.json");
  const patch = path.join(runDir, "agents", "T1", "patch.diff");
  fs.mkdirSync(path.dirname(handoff), { recursive: true });
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({ current_run_id: runId }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: "adopt handoff" }
  }, null, 2) + "\n");
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
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "waiting_for_agent_output",
    next_actions: [{
      id: "agent-dev-T1",
      kind: "agent",
      status: "ready",
      role: "dev",
      taskId: "T1",
      reason: "implement T1",
      inputs: [],
      outputs: [handoff],
      dependsOn: [],
      parallelGroup: "delivery"
    }],
    agent_runs: []
  }, null, 2) + "\n");

  readStatus(cwd);
  const agentRuns = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "agent-runs.json"), "utf8"));
  assert.equal(agentRuns.agents.length, 1);
  assert.equal(agentRuns.agents[0].id, "T1");
  assert.equal(agentRuns.agents[0].actionId, "agent-dev-T1");
  assert.equal(agentRuns.agents[0].status, "completed");
  assert.equal(agentRuns.agents[0].executionStatus, "completed");
  assert.equal(agentRuns.agents[0].handoffFile, handoff);
  const dispatch = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), "utf8"));
  assert.equal(dispatch.contracts[0].status, "done");
  const queue = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "queue.json"), "utf8"));
  assert.deepEqual(queue.actions, []);
  assert.deepEqual(queue.contracts, []);
  const consistency = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "orchestrator-runtime-consistency.json"), "utf8"));
  assert.equal(consistency.session_action_count, 1);
  const parallel = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), "utf8"));
  assert.ok(parallel.wave_history.some((wave) => wave.status === "completed" && wave.action_ids.includes("agent-dev-T1")));
  const value = readStatus(cwd);
  assert.equal(value.currentRunActions.ready, 0);
  const evidence = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(evidence.handoff_validation.passed, true);
  assert.deepEqual(evidence.parallel_execution.missing_completed_wave_contracts, []);
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-invalid-handoff-evidence-"));
  const runId = "invalid-handoff-evidence";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  const handoff = path.join(runDir, "agents", "T1", "handoff.json");
  const missingEvidence = path.join(runDir, "agents", "T1", "missing.patch");
  fs.mkdirSync(path.dirname(handoff), { recursive: true });
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({ current_run_id: runId }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: "invalid handoff evidence" }
  }, null, 2) + "\n");
  fs.writeFileSync(handoff, JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "dev",
    from: "dev",
    to: "qa",
    status: "ready",
    summary: "implementation ready but evidence missing",
    commands: [],
    evidence: [missingEvidence],
    next_state: "verifying",
    files_changed: ["src/index.js"],
    verification: []
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "waiting_for_agent_output",
    next_actions: [{
      id: "agent-dev-T1",
      kind: "agent",
      status: "ready",
      role: "dev",
      taskId: "T1",
      reason: "implement T1",
      inputs: [],
      outputs: [handoff],
      dependsOn: [],
      parallelGroup: "delivery"
    }],
    agent_runs: []
  }, null, 2) + "\n");

  readStatus(cwd);
  const agentRuns = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "agent-runs.json"), "utf8"));
  assert.equal(agentRuns.agents.length, 0);
  const evidence = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(evidence.handoff_validation.passed, false);
  assert.ok(evidence.handoff_validation.invalid[0].errors.some((error) => error.includes("missing evidence")));
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-markdown-only-report-"));
  const runId = "markdown-only-report";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({ current_run_id: runId }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: "markdown only report" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Tests\n\npass\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "waiting_for_agent_output",
    next_actions: [{
      id: "agent-qa-T1",
      kind: "agent",
      status: "ready",
      role: "qa",
      taskId: "T1",
      reason: "verify T1",
      inputs: [],
      outputs: [path.join(runDir, "agents", "qa-T1", "handoff.json")],
      dependsOn: [],
      parallelGroup: "qa"
    }],
    agent_runs: []
  }, null, 2) + "\n");

  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  const gates = Object.fromEntries(result.gates.map((gate) => [gate.id, gate.status]));
  assert.notEqual(gates.true_harness, "pass");
  const evidence = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "true-harness-evidence.json"), "utf8"));
  assert.equal(evidence.handoff_validation.passed, false);
  assert.equal(evidence.handoff_validation.invalid[0].agent_id, "agent-qa-T1");
}

console.log("demo replay ok");
