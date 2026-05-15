import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateTaskGraph } from "../dist/core/plan.js";
import { RUNTIME_ROLES, allowedTransitionsForRole, evidenceRequirementsForRole, handoffSchemaForRole, runtimeRoleContracts } from "../dist/core/role-registry.js";
import { buildDispatchContracts } from "../dist/core/dispatch.js";
import { isHandoffRole } from "../dist/core/handoff-evidence.js";
import { validateAgentSkills } from "../dist/core/skill-registry.js";
import { writeProviderCapabilitySnapshot, writeProviderExecutionReceipt } from "../dist/core/provider-evidence.js";
import { writePreArchiveHarnessEvidence, writeTrueHarnessEvidence } from "../dist/core/true-harness-evidence.js";
import { status } from "../dist/core/status.js";

function makeRun(prefix = "imfine-implementation-optimization-") {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const runId = "run-1";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "agents", "T1"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "planned",
    execution_mode: "true_harness",
    project_kind: "existing_project",
    source: { type: "text", value: "test" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({
    schema_version: 1,
    current_run_id: runId
  }, null, 2) + "\n");
  return { cwd, runId, runDir };
}

function validTaskGraph(runId = "run-1") {
  return {
    run_id: runId,
    strategy: "parallel",
    tasks: [
      {
        id: "T1",
        title: "Task",
        type: "dev",
        depends_on: [],
        read_scope: ["src/**"],
        write_scope: ["src/**"],
        acceptance: ["done"],
        dev_plan: ["dev"],
        test_plan: ["test"],
        review_plan: ["review"],
        verification: ["npm test"],
        commit: { mode: "task", message: "feat: task" }
      }
    ]
  };
}

function writeHarnessFixture(fixture, options = {}) {
  const { cwd, runId, runDir } = fixture;
  const patchFile = path.join(runDir, "agents", "T1", "patch.diff");
  if (options.writePatch !== false) fs.writeFileSync(patchFile, "diff --git a/src/index.js b/src/index.js\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness"
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-runs.json"), JSON.stringify({
    agents: [{
      id: "T1",
      role: "dev",
      taskId: "T1",
      status: "completed",
      executionSource: "true_harness",
      executionStatus: "completed",
      skills: options.skills || ["implementation"]
    }]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "dispatch-contracts.json"), JSON.stringify({
    contracts: [{ id: "T1", role: "dev", task_id: "T1", status: "done" }]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "parallel-execution.json"), JSON.stringify({
    wave_history: options.completedWave === false ? [] : [{ status: "completed", action_ids: ["agent-dev-T1"], roles: ["dev"], task_ids: ["T1"] }]
  }, null, 2) + "\n");
  if (options.handoff !== false) {
    fs.writeFileSync(path.join(runDir, "agents", "T1", "handoff.json"), JSON.stringify({
      run_id: runId,
      task_id: "T1",
      role: "dev",
      from: "dev",
      to: "qa",
      status: "ready",
      summary: "done",
      commands: [],
      evidence: options.evidence || [patchFile],
      next_state: "verifying",
      files_changed: ["src/index.js"],
      verification: []
    }, null, 2) + "\n");
  }
  if (options.receipt !== false) {
    writeProviderExecutionReceipt(cwd, runId, {
      actionId: "agent-dev-T1",
      agentId: "T1",
      role: "dev",
      taskId: "T1",
      parallelGroup: "delivery",
      status: "completed"
    });
  }
  return { patchFile };
}

for (const contract of runtimeRoleContracts()) {
  assert.ok(RUNTIME_ROLES.includes(contract.role), `missing role ${contract.role}`);
  assert.equal(isHandoffRole(contract.role), true, `handoff role not accepted: ${contract.role}`);
  assert.deepEqual(allowedTransitionsForRole(contract.role), contract.allowedTransitions);
  assert.equal(handoffSchemaForRole(contract.role), "library/templates/handoff.schema.json");
  assert.ok(evidenceRequirementsForRole(contract.role).length > 0, `missing role evidence for ${contract.role}`);
  assert.ok(contract.requiredFields.includes("run_id"));
  assert.ok(contract.requiredFields.includes("evidence"));
}
assert.deepEqual(validateAgentSkills("dev", ["implementation"]), []);
assert.ok(validateAgentSkills("dev", ["archive"]).some((error) => error.includes("not allowed")));
assert.ok(validateAgentSkills("dev", ["missing-skill"]).some((error) => error.includes("unknown skill")));

let result = validateTaskGraph(validTaskGraph("run-1"), { expectedRunId: "other" });
assert.equal(result.passed, false);
assert.ok(result.errors.some((error) => error.includes("run_id mismatch")));

const illegalType = validTaskGraph();
illegalType.tasks[0].type = "unknown";
result = validateTaskGraph(illegalType, { expectedRunId: "run-1" });
assert.equal(result.passed, false);
assert.ok(result.errors.some((error) => error.includes("unsupported type")));

const nonArray = validTaskGraph();
nonArray.tasks[0].read_scope = "src/**";
result = validateTaskGraph(nonArray, { expectedRunId: "run-1" });
assert.equal(result.passed, false);
assert.ok(result.errors.some((error) => error.includes("read_scope must be an array")));

const cycle = validTaskGraph();
cycle.tasks.push({
  ...cycle.tasks[0],
  id: "T2",
  depends_on: ["T1"],
  write_scope: ["test/**"]
});
cycle.tasks[0].depends_on = ["T2"];
result = validateTaskGraph(cycle, { expectedRunId: "run-1" });
assert.equal(result.passed, false);
assert.ok(result.errors.some((error) => error.includes("cycle")));

result = validateTaskGraph(validTaskGraph(), {
  expectedRunId: "run-1",
  orchestratorSession: { next_actions: [], agent_runs: [] }
});
assert.equal(result.passed, false);
assert.ok(result.errors.some((error) => error.includes("no matching orchestrator action")));

{
  const { cwd, runId, runDir } = makeRun("imfine-dispatch-role-contract-");
  const sessionFile = path.join(runDir, "orchestration", "orchestrator-session.json");
  fs.writeFileSync(sessionFile, JSON.stringify({
    next_actions: [{
      id: "agent-dev-T1",
      kind: "agent",
      status: "ready",
      role: "dev",
      taskId: "T1",
      reason: "test",
      inputs: [],
      outputs: [],
      dependsOn: [],
      parallelGroup: "delivery"
    }],
    agent_runs: [{
      id: "T1",
      role: "dev",
      taskId: "T1",
      status: "ready",
      skills: ["implementation"],
      inputs: [],
      outputs: [],
      readScope: ["src/**"],
      writeScope: ["src/**"],
      dependsOn: [],
      parallelGroup: "delivery"
    }]
  }, null, 2) + "\n");
  const contracts = buildDispatchContracts(cwd, runId, runDir, sessionFile);
  assert.equal(contracts[0].handoff_schema, "library/templates/handoff.schema.json");
  assert.ok(contracts[0].role_required_evidence.includes("agents/*/patch.diff"));
}

const previousProvider = process.env.IMFINE_PROVIDER;
const previousSubagent = process.env.IMFINE_SUBAGENT_SUPPORTED;
try {
  const { cwd, runId } = makeRun("imfine-provider-capability-");
  process.env.IMFINE_PROVIDER = "codex";
  process.env.IMFINE_SUBAGENT_SUPPORTED = "unsupported";
  const unsupported = writeProviderCapabilitySnapshot(cwd, runId);
  assert.equal(unsupported.provider, "codex");
  assert.equal(unsupported.subagent_supported, "unsupported");
  assert.equal(unsupported.blocked, true);
  process.env.IMFINE_SUBAGENT_SUPPORTED = "supported";
  const supported = writeProviderCapabilitySnapshot(cwd, runId);
  assert.equal(supported.subagent_supported, "supported");
  assert.equal(supported.blocked, false);
  delete process.env.IMFINE_PROVIDER;
  delete process.env.IMFINE_SUBAGENT_SUPPORTED;
  const unknown = writeProviderCapabilitySnapshot(cwd, runId);
  assert.equal(unknown.provider, "unknown");
  assert.equal(unknown.subagent_supported, "unknown");
  assert.equal(unknown.blocked, false);
} finally {
  if (previousProvider === undefined) delete process.env.IMFINE_PROVIDER;
  else process.env.IMFINE_PROVIDER = previousProvider;
  if (previousSubagent === undefined) delete process.env.IMFINE_SUBAGENT_SUPPORTED;
  else process.env.IMFINE_SUBAGENT_SUPPORTED = previousSubagent;
}

try {
  const { cwd, runId } = makeRun("imfine-provider-blocker-summary-");
  process.env.IMFINE_PROVIDER = "codex";
  process.env.IMFINE_SUBAGENT_SUPPORTED = "unsupported";
  writeProviderCapabilitySnapshot(cwd, runId);
  const value = status(cwd);
  assert.equal(value.currentRunBlockers.status, "blocked");
  assert.equal(value.currentRunBlockers.items, 1);
} finally {
  if (previousProvider === undefined) delete process.env.IMFINE_PROVIDER;
  else process.env.IMFINE_PROVIDER = previousProvider;
  if (previousSubagent === undefined) delete process.env.IMFINE_SUBAGENT_SUPPORTED;
  else process.env.IMFINE_SUBAGENT_SUPPORTED = previousSubagent;
}

{
  const fixture = makeRun("imfine-true-harness-negative-");
  const { cwd, runId } = fixture;
  writeHarnessFixture(fixture, { receipt: false });
  const negative = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(negative.true_harness_passed, false);
  assert.deepEqual(negative.provider_execution_receipts.missing_provider_receipt_contracts, ["T1"]);
  writeProviderExecutionReceipt(cwd, runId, {
    actionId: "agent-dev-T1",
    agentId: "T1",
    role: "dev",
    taskId: "T1",
    parallelGroup: "delivery",
    status: "completed"
  });
  const positive = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(positive.true_harness_passed, true);
}

{
  const fixture = makeRun("imfine-missing-wave-");
  const { cwd, runId } = fixture;
  writeHarnessFixture(fixture, { completedWave: false });
  const value = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(value.true_harness_passed, false);
  assert.deepEqual(value.parallel_execution.missing_completed_wave_contracts, ["T1"]);
}

{
  const fixture = makeRun("imfine-missing-handoff-");
  const { cwd, runId } = fixture;
  writeHarnessFixture(fixture, { handoff: false });
  const value = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(value.true_harness_passed, false);
  assert.equal(value.handoff_validation.invalid[0].errors[0], "handoff is missing");
}

{
  const fixture = makeRun("imfine-missing-handoff-evidence-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture, { evidence: [path.join(runDir, "agents", "T1", "missing.diff")] });
  const value = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(value.true_harness_passed, false);
  assert.ok(value.handoff_validation.invalid[0].errors.some((error) => error.includes("missing evidence")));
}

{
  const fixture = makeRun("imfine-missing-skill-evidence-");
  const { cwd, runId } = fixture;
  writeHarnessFixture(fixture, { evidence: [], writePatch: false });
  const value = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(value.true_harness_passed, false);
  assert.equal(value.skill_evidence_contracts.passed, false);
  assert.deepEqual(value.skill_evidence_contracts.checks[0].missing_evidence, ["agents/*/patch.diff"]);
}

{
  const fixture = makeRun("imfine-pre-archive-incomplete-");
  const { cwd, runId } = fixture;
  writeHarnessFixture(fixture);
  const value = JSON.parse(fs.readFileSync(writePreArchiveHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(value.pre_archive_harness_passed, false);
  assert.ok(value.missing_standard_evidence.some((item) => item.endsWith("evidence/test-results.md")));
  assert.ok(value.missing_standard_evidence.some((item) => item.endsWith("agents/committer/handoff.json")));
}

{
  const { cwd, runId, runDir } = makeRun("imfine-status-matrix-");
  fs.writeFileSync(path.join(runDir, "orchestration", "final-gates.json"), JSON.stringify({
    gates: { qa: "pass", review: "blocked", committer: "blocked", archive: "blocked" },
    checks: [{ id: "review", status: "fail", detail: "missing review" }]
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "queue.json"), JSON.stringify({
    actions: [
      { status: "ready", parallelGroup: "delivery" },
      { status: "waiting", parallelGroup: "qa" },
      { status: "blocked", parallelGroup: "review" }
    ]
  }, null, 2) + "\n");
  fs.mkdirSync(path.join(runDir, "orchestration", "checkpoints"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "orchestration", "checkpoints", "latest.json"), JSON.stringify({
    file: path.join(runDir, "orchestration", "checkpoints", "agent-review-T1.json"),
    action_id: "agent-review-T1",
    status: "blocked",
    detail: "missing review",
    recorded_at: "2026-01-01T00:00:00.000Z"
  }, null, 2) + "\n");
  const value = status(cwd);
  assert.equal(value.currentRunStatus, "planned");
  assert.equal(value.currentRunGates.qa, "pass");
  assert.equal(value.currentRunGates.review, "blocked");
  assert.equal(value.currentRunActions.ready, 1);
  assert.equal(value.currentRunActions.waiting, 1);
  assert.equal(value.currentRunActions.blocked, 1);
  assert.equal(value.currentRunBlockers.items, 1);
  assert.equal(value.currentRunLatestCheckpoint.actionId, "agent-review-T1");
}

for (const runStatus of ["completed", "blocked", "waiting_for_agent_output", "needs_dev_fix", "needs_task_replan"]) {
  const { cwd, runDir } = makeRun(`imfine-status-${runStatus}-`);
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: "run-1",
    status: runStatus,
    execution_mode: "true_harness",
    project_kind: "existing_project",
    source: { type: "text", value: "test" }
  }, null, 2) + "\n");
  const value = status(cwd);
  assert.equal(value.currentRunStatus, runStatus);
  assert.equal(value.currentRunGates.true_harness, "missing");
}

console.log("implementation optimization ok");
