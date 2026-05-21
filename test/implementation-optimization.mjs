import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateTaskGraph } from "../dist/core/plan.js";
import { RUNTIME_ROLES, allowedTransitionsForRole, evidenceRequirementsForRole, handoffSchemaForRole, runtimeRoleContracts } from "../dist/core/role-registry.js";
import { buildDispatchContracts } from "../dist/core/dispatch.js";
import { isHandoffRole } from "../dist/core/handoff-evidence.js";
import { validateAgentSkills } from "../dist/core/skill-registry.js";
import { writeProviderCapabilitySnapshot, writeProviderExecutionReceipt, writeProviderOriginReceipt } from "../dist/core/provider-evidence.js";
import { staleTrueHarnessEvidence, writePreArchiveHarnessEvidence, writeTrueHarnessEvidence } from "../dist/core/true-harness-evidence.js";
import { status } from "../dist/core/status.js";
import { doctor } from "../dist/core/doctor.js";
import { initProject } from "../dist/core/init.js";
import { transitionRunState } from "../dist/core/state-machine.js";
import { codexSkillTemplate, claudeCommandTemplate } from "../dist/core/templates.js";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "imfine.js");

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
  const provider = options.provider || "codex";
  fs.writeFileSync(path.join(runDir, "orchestration", "provider-capability.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    provider,
    entry_installed: true,
    subagent_supported: "supported",
    capabilities: {
      supports_subagent: "supported",
      supports_parallel_subagent: "supported",
      supports_agent_file_output: "supported",
      supports_agent_wait: "supported",
      supports_agent_interrupt: "unknown"
    },
    detection_source: "test-fixture",
    detected_at: "2026-01-01T00:00:00.000Z",
    blocked: false
  }, null, 2) + "\n");
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
  const handoffFile = path.join(runDir, "agents", "T1", "handoff.json");
  if (options.receipt !== false && fs.existsSync(handoffFile)) {
    writeProviderOriginReceipt(cwd, runId, {
      actionId: "agent-dev-T1",
      agentId: "T1",
      role: "dev",
      taskId: "T1",
      parallelGroup: "delivery",
      provider,
      providerAgentId: `${provider}-agent-real-T1`,
      providerSessionId: `${provider}-session-real-run-1`,
      providerTaskHandle: `${provider}-task-handle-T1`,
      outputPath: handoffFile
    });
  }
  return { patchFile };
}

function writeAgentAcceptanceMatrix(runDir, items) {
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-acceptance-matrix.json"), JSON.stringify({
    schema_version: 1,
    items
  }, null, 2) + "\n");
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
  assert.equal(unsupported.capabilities.supports_subagent, "unsupported");
  process.env.IMFINE_SUBAGENT_SUPPORTED = "supported";
  process.env.IMFINE_SUPPORTS_PARALLEL_SUBAGENT = "unsupported";
  const supported = writeProviderCapabilitySnapshot(cwd, runId);
  assert.equal(supported.subagent_supported, "supported");
  assert.equal(supported.blocked, false);
  assert.equal(supported.capabilities.supports_parallel_subagent, "unsupported");
  delete process.env.IMFINE_PROVIDER;
  delete process.env.IMFINE_SUBAGENT_SUPPORTED;
  delete process.env.IMFINE_SUPPORTS_PARALLEL_SUBAGENT;
  const unknown = writeProviderCapabilitySnapshot(cwd, runId);
  assert.equal(unknown.provider, "unknown");
  assert.equal(unknown.subagent_supported, "unknown");
  assert.equal(unknown.blocked, true);
} finally {
  if (previousProvider === undefined) delete process.env.IMFINE_PROVIDER;
  else process.env.IMFINE_PROVIDER = previousProvider;
  if (previousSubagent === undefined) delete process.env.IMFINE_SUBAGENT_SUPPORTED;
  else process.env.IMFINE_SUBAGENT_SUPPORTED = previousSubagent;
  delete process.env.IMFINE_SUPPORTS_PARALLEL_SUBAGENT;
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-init-architect-"));
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "index.js"), "export const value = 1;\n");
  fs.mkdirSync(path.join(cwd, "test"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "test", "index.test.js"), "import test from 'node:test';\n");
  const result = initProject(cwd);
  assert.equal(result.projectMode, "existing");
  assert.equal(result.architecture.status, "confirmed");
  assert.ok(result.architecture.architectHandoff);
  assert.ok(fs.existsSync(result.architecture.architectHandoff));
  const freshness = JSON.parse(fs.readFileSync(path.join(cwd, ".imfine", "project", "project-knowledge-freshness.json"), "utf8"));
  assert.equal(freshness.status, "confirmed");
  const architecture = fs.readFileSync(path.join(cwd, ".imfine", "project", "architecture.md"), "utf8");
  assert.match(architecture, /src\/index\.js/);
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-forbid-provider-launch-"));
  assert.throws(
    () => execFileSync(process.execPath, [cli, "launch-codex-agent"], { cwd, encoding: "utf8", stdio: "pipe" }),
    /provider agent launch commands/
  );
}

{
  for (const content of [codexSkillTemplate("en"), claudeCommandTemplate("zh")]) {
    assert.match(content, /Completion Preconditions|完成前置条件/);
    assert.match(content, /acceptance-deviation\.json/);
    assert.match(content, /awaiting_user_approval/);
    assert.match(content, /true_harness_passed=true/);
  }
  const schema = JSON.parse(fs.readFileSync(path.join(root, "library", "templates", "orchestrator-session.schema.json"), "utf8"));
  assert.ok(schema.properties.completion_preconditions.required.includes("final_gates_pass"));
  assert.ok(schema.properties.completion_preconditions.required.includes("commit_push_archive_policy_satisfied"));
}

try {
  const { cwd, runId } = makeRun("imfine-provider-blocker-summary-");
  process.env.IMFINE_PROVIDER = "codex";
  process.env.IMFINE_SUBAGENT_SUPPORTED = "unsupported";
  writeProviderCapabilitySnapshot(cwd, runId);
  const value = status(cwd);
  assert.equal(value.currentRunBlockers.status, "blocked");
  assert.equal(value.currentRunBlockers.items, 1);
  assert.equal(value.currentRunBlockers.diagnosticDoc, "docs/harness-evidence.md#provider-capability");
} finally {
  if (previousProvider === undefined) delete process.env.IMFINE_PROVIDER;
  else process.env.IMFINE_PROVIDER = previousProvider;
  if (previousSubagent === undefined) delete process.env.IMFINE_SUBAGENT_SUPPORTED;
  else process.env.IMFINE_SUBAGENT_SUPPORTED = previousSubagent;
}

for (const provider of ["codex", "claude"]) {
  const fixture = makeRun(`imfine-${provider}-true-harness-negative-`);
  const { cwd, runId } = fixture;
  writeHarnessFixture(fixture, { provider, receipt: false });
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
  const runtimeOnly = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(runtimeOnly.true_harness_passed, false);
  assert.deepEqual(runtimeOnly.provider_execution_receipts.missing_provider_receipt_contracts, ["T1"]);
  assert.equal(runtimeOnly.provider_execution_receipts.receipts[0].valid_native_subagent_proof, false);
  writeProviderOriginReceipt(cwd, runId, {
    actionId: "agent-dev-T1",
    agentId: "T1",
    role: "dev",
    taskId: "T1",
    parallelGroup: "delivery",
    provider,
    providerAgentId: `${provider}-agent-real-T1`,
    providerSessionId: `${provider}-session-real-run-1`,
    providerTaskHandle: `${provider}-task-handle-T1`,
    outputPath: path.join(fixture.runDir, "agents", "T1", "handoff.json")
  });
  const positive = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(positive.true_harness_passed, true);
  assert.equal(positive.provider_execution_receipts.receipts[0].provider_agent_id, `${provider}-agent-real-T1`);
  assert.ok(fs.existsSync(path.join(fixture.runDir, "orchestration", "method-provenance.json")));
  const provenance = JSON.parse(fs.readFileSync(path.join(fixture.runDir, "orchestration", "method-provenance.json"), "utf8"));
  assert.ok(provenance.sources.openspec_inspired.some((item) => item.artifact === "archive"));
  assert.ok(provenance.sources.imfine_specific_contracts.some((item) => item.contract === "dispatch-contracts"));
}

for (const provider of ["codex", "claude"]) {
  const fixture = makeRun(`imfine-${provider}-provider-origin-`);
  const { cwd, runId } = fixture;
  writeHarnessFixture(fixture, { provider });
  const value = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(value.true_harness_passed, true);
  assert.equal(value.provider_execution_receipts.valid_receipt_count, 1);
  assert.equal(value.provider_execution_receipts.receipts[0].valid_native_subagent_proof, true);
  assert.equal(value.provider_execution_receipts.receipts[0].provider_agent_id, `${provider}-agent-real-T1`);
}

{
  const fixture = makeRun("imfine-provider-resolved-by-receipts-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture);
  fs.writeFileSync(path.join(runDir, "orchestration", "provider-capability.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    provider: "codex",
    entry_installed: true,
    subagent_supported: "unknown",
    detection_source: "test-fixture",
    detected_at: "2026-01-01T00:00:00.000Z",
    blocked: true,
    blocked_reason: "not resolved yet"
  }, null, 2) + "\n");
  const value = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(value.provider_capability.subagent_supported, "supported");
  assert.equal(value.provider_capability.resolved_by_receipts, true);
  assert.equal(value.true_harness_passed, true);
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
  const fixture = makeRun("imfine-true-harness-freshness-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture);
  const files = writeTrueHarnessEvidence(cwd, runId);
  assert.deepEqual(staleTrueHarnessEvidence(files.json), []);
  const sessionFile = path.join(runDir, "orchestration", "orchestrator-session.json");
  const session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  session.updated_at = "2026-05-20T07:00:34.000Z";
  fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2) + "\n");
  assert.ok(staleTrueHarnessEvidence(files.json).some((item) => item.includes("orchestrator_session")));
  const value = status(cwd);
  assert.equal(value.currentRunGates.true_harness, "stale");
  assert.equal(value.currentRunConsistency, "inconsistent");
}

{
  const fixture = makeRun("imfine-provider-observations-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture);
  const obsDir = path.join(runDir, "orchestration", "provider-observations");
  fs.mkdirSync(obsDir, { recursive: true });
  fs.writeFileSync(path.join(obsDir, "ui-screenshot.json"), JSON.stringify({
    timestamp: "2026-05-20T08:00:00.000Z",
    observed_agent_names: ["Tesla", "Rawls"],
    observed_closed_count: 2,
    screenshot_path: "screenshots/demo.png"
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-name-map.json"), JSON.stringify({
    mappings: [{ provider_display_name: "Tesla", action_id: "agent-dev-T1", role: "dev", parallel_group: "delivery", started_at: "2026-05-20T08:00:00.000Z", expected_output: "agents/T1/handoff.json" }]
  }, null, 2) + "\n");
  const evidence = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(evidence.provider_observations.present, true);
  assert.deepEqual(evidence.provider_observations.observed_native_agents, ["Tesla", "Rawls"]);
  assert.equal(evidence.provider_observations.proof_boundary, "diagnostic_only_not_true_harness_proof");
  assert.equal(evidence.agent_name_map.present, true);
}

{
  const fixture = makeRun("imfine-doctor-harness-mismatch-");
  const { cwd, runId, runDir } = fixture;
  fs.writeFileSync(path.join(runDir, "orchestration", "true-harness-evidence.json"), JSON.stringify({
    true_harness_passed: true
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "true-harness-evidence.md"), "# True Harness Evidence\n\n- true harness passed: no\n");
  const report = doctor(cwd);
  assert.ok(report.checks.some((item) => item.id === "run.true_harness.evidence_consistency" && item.status === "fail"));
  assert.ok(report.checks.some((item) => item.id === "run.true_harness.runtime_evidence" && item.status === "fail"));
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
  if (runStatus === "completed") {
    assert.equal(value.currentRunConsistency, "inconsistent");
    assert.equal(value.currentRunGates.status_consistency, "inconsistent_missing_final_gates");
  }
}

{
  const { cwd, runId, runDir } = makeRun("imfine-commit-approval-state-");
  fs.mkdirSync(path.join(runDir, "agents", "committer"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "agents", "committer", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "run",
    role: "committer",
    from: "committer",
    to: "orchestrator",
    status: "ready",
    summary: "commit ready but approval required",
    commands: [],
    evidence: [path.join(runDir, "agents", "committer", "handoff.json")],
    next_state: "awaiting_user_approval"
  }, null, 2) + "\n");
  const moved = transitionRunState(cwd, runId, "awaiting_user_approval", {
    commit_blocked_reason: "run commit requires user approval"
  });
  assert.equal(moved.accepted, true);
  const blocked = transitionRunState(cwd, runId, "completed");
  assert.equal(blocked.accepted, false);
  assert.match(blocked.reason, /true harness evidence/);
}

{
  const { cwd, runDir } = makeRun("imfine-status-incomplete-final-gates-");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: "run-1",
    status: "completed",
    execution_mode: "true_harness",
    project_kind: "existing_project",
    source: { type: "text", value: "test" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "final-gates.json"), JSON.stringify({
    gates: { qa: "pass", review: "pass" }
  }, null, 2) + "\n");
  const value = status(cwd);
  assert.equal(value.currentRunConsistency, "inconsistent");
  const report = doctor(cwd);
  assert.ok(report.checks.some((item) => item.id === "run.review.blocker_matrix" && item.status === "fail"));
}

{
  const { cwd, runDir } = makeRun("imfine-status-session-runtime-split-");
  fs.writeFileSync(path.join(runDir, "orchestration", "orchestrator-session.json"), JSON.stringify({
    schema_version: 1,
    run_id: "run-1",
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "completed",
    next_actions: [],
    agent_runs: []
  }, null, 2) + "\n");
  const value = status(cwd);
  assert.equal(value.currentRunConsistency, "inconsistent");
  assert.equal(value.currentRunGates.status_consistency, "orchestrator_session_unadopted");
}

console.log("implementation optimization ok");
