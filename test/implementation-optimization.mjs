import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { validateTaskGraph } from "../dist/core/plan.js";
import { RUNTIME_ROLES, allowedTransitionsForRole, evidenceRequirementsForRole, handoffSchemaForRole, runtimeRoleContracts } from "../dist/core/role-registry.js";
import { buildDispatchContracts } from "../dist/core/dispatch.js";
import { isHandoffRole } from "../dist/core/handoff-evidence.js";
import { normalizeSkillIds, validateAgentSkills } from "../dist/core/skill-registry.js";
import { listLibrary, readLibrary } from "../dist/core/library.js";
import { writeProviderObservation } from "../dist/core/provider-observation.js";
import { validateProviderReceipt, writeProviderCapabilitySnapshot, writeProviderExecutionReceipt, writeProviderOriginReceipt } from "../dist/core/provider-evidence.js";
import { writeRuntimeRequirements } from "../dist/core/runtime-requirements.js";
import { staleTrueHarnessEvidence, writePreArchiveHarnessEvidence, writeTrueHarnessEvidence } from "../dist/core/true-harness-evidence.js";
import { status } from "../dist/core/status.js";
import { doctor } from "../dist/core/doctor.js";
import { initProject } from "../dist/core/init.js";
import { createDeliveryRun } from "../dist/core/run.js";
import { transitionRunState } from "../dist/core/state-machine.js";
import { install } from "../dist/core/install.js";

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
    required_coverage_declared_complete: true,
    items
  }, null, 2) + "\n");
}

for (const contract of runtimeRoleContracts()) {
  assert.ok(RUNTIME_ROLES.includes(contract.role), `missing role ${contract.role}`);
  assert.equal(isHandoffRole(contract.role), true, `handoff role not accepted: ${contract.role}`);
  assert.deepEqual(allowedTransitionsForRole(contract.role), contract.allowedTransitions);
  assert.equal(handoffSchemaForRole(contract.role), "src/imfine-skills/templates/handoff.schema.json");
  assert.ok(evidenceRequirementsForRole(contract.role).length > 0, `missing role evidence for ${contract.role}`);
  assert.ok(contract.requiredFields.includes("run_id"));
  assert.ok(contract.requiredFields.includes("evidence"));
}
assert.deepEqual(validateAgentSkills("dev", ["implementation"]), []);
assert.deepEqual(normalizeSkillIds(["imfine-dev", "imfine-qa", "imfine-review"]), ["execute-task-plan", "verification", "code-review"]);
assert.deepEqual(validateAgentSkills("dev", ["imfine-dev"]), []);
assert.deepEqual(validateAgentSkills("qa", ["imfine-qa"]), []);
assert.deepEqual(validateAgentSkills("reviewer", ["imfine-review"]), []);
assert.deepEqual(validateAgentSkills("risk-reviewer", ["harness-audit"]), []);
assert.deepEqual(validateAgentSkills("qa", ["demo-audit"]), []);
assert.deepEqual(validateAgentSkills("ux-designer", ["imfine-brainstorming", "imfine-product-brief", "imfine-implementation-readiness"]), []);
assert.deepEqual(validateAgentSkills("task-planner", ["imfine-validate-requirement"]), []);
assert.deepEqual(validateAgentSkills("reviewer", ["imfine-correct-course"]), []);
assert.deepEqual(validateAgentSkills("project-knowledge-updater", ["imfine-retrospective"]), []);
assert.ok(validateAgentSkills("dev", ["archive"]).some((error) => error.includes("not allowed")));
assert.ok(validateAgentSkills("dev", ["imfine-product-brief"]).some((error) => error.includes("not allowed")));
assert.ok(validateAgentSkills("dev", ["missing-skill"]).some((error) => error.includes("unknown skill")));

{
  const agentIds = listLibrary("agents").map((entry) => entry.id);
  const skillIds = listLibrary("skills").map((entry) => entry.id);
  const expectedAgents = [
    "imfine-agent-orchestrator",
    "imfine-agent-intake",
    "imfine-agent-project-analyzer",
    "imfine-agent-product-planner",
    "imfine-agent-architect",
    "imfine-agent-task-planner",
    "imfine-agent-dev",
    "imfine-agent-qa",
    "imfine-agent-reviewer",
    "imfine-agent-risk-reviewer",
    "imfine-agent-merge-agent",
    "imfine-agent-committer",
    "imfine-agent-archive",
    "imfine-agent-technical-writer",
    "imfine-agent-project-knowledge-updater",
    "imfine-agent-harness-auditor",
    "imfine-agent-ux-designer"
  ];
  const expectedWorkflowSkills = [
    "imfine-brainstorming",
    "imfine-product-brief",
    "imfine-validate-requirement",
    "imfine-implementation-readiness",
    "imfine-correct-course",
    "imfine-retrospective",
    "imfine-clarify",
    "imfine-project-analysis",
    "imfine-write-delivery-plan",
    "imfine-execute-task-plan",
    "imfine-tdd",
    "imfine-systematic-debugging",
    "imfine-parallel-agent-dispatch",
    "imfine-code-review",
    "imfine-archive-confirmation",
    "imfine-harness-audit"
  ];
  assert.deepEqual(agentIds.filter((id) => id.startsWith("imfine-agent-")).sort(), expectedAgents.sort());
  for (const skillId of expectedWorkflowSkills) assert.ok(skillIds.includes(skillId), `missing workflow skill: ${skillId}`);
  assert.ok(skillIds.includes("imfine-run"));
  assert.match(readLibrary("agents", "imfine-agent-harness-auditor"), /misleading_demo/);
  assert.match(readLibrary("skills", "imfine-harness-audit"), /failure evidence/);
  assert.match(readLibrary("agents", "imfine-agent-task-planner"), /parallel_groups/);
  assert.match(readLibrary("skills", "imfine-parallel-agent-dispatch"), /provider-origin/);
  assert.match(readLibrary("skills", "imfine-tdd"), /Red-Green-Refactor/);
  assert.match(readLibrary("skills", "imfine-write-delivery-plan"), /No Placeholder Rule/);
  assert.match(readLibrary("skills", "imfine-execute-task-plan"), /Two-Stage Review Per Task/);
  assert.match(readLibrary("skills", "imfine-code-review"), /review early/);
  assert.match(readLibrary("skills", "imfine-archive-confirmation"), /No completion claim without fresh verification evidence/);
  assert.match(readLibrary("agents", "imfine-agent-architect"), /BMAD-Inspired Micro-Step Workflow/);
  assert.match(readLibrary("skills", "imfine-brainstorming"), /Facilitator|creative_partner|autonomous/);
  assert.match(readLibrary("skills", "imfine-implementation-readiness"), /Readiness Gates/);
  assert.match(readLibrary("skills", "imfine-correct-course"), /material change/);
  assert.match(readLibrary("skills", "imfine-retrospective"), /harness evolution/);
  assert.match(readLibrary("agents", "imfine-agent-ux-designer"), /UX acceptance/);
  for (const reference of [
    "implementer-prompt.md",
    "spec-reviewer-prompt.md",
    "code-quality-reviewer-prompt.md"
  ]) {
    assert.equal(
      fs.existsSync(path.join(root, "src", "imfine-skills", "workflows", "imfine-parallel-agent-dispatch", "references", reference)),
      true,
      `missing dispatch reference: ${reference}`
    );
  }
  for (const step of [
    "step-01-context.md",
    "step-02-decisions.md",
    "step-03-boundaries.md",
    "step-04-validation.md"
  ]) {
    assert.equal(
      fs.existsSync(path.join(root, "src", "imfine-skills", "agents", "imfine-agent-architect", "steps", step)),
      true,
      `missing architect step: ${step}`
    );
  }
}

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
  const contracts = buildDispatchContracts(runId, runDir, sessionFile);
  assert.equal(contracts[0].handoff_schema, "src/imfine-skills/templates/handoff.schema.json");
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
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-init-gitignore-only-"));
  fs.writeFileSync(path.join(cwd, ".gitignore"), "__pycache__/\nbackend/db/*.sqlite3\n");
  const result = initProject(cwd);
  assert.equal(result.projectMode, "empty");
  assert.equal(result.architecture.mode, "empty");
  assert.equal(result.architecture.architectInput, undefined);
  assert.equal(result.architecture.architectHandoff, undefined);
  assert.equal(fs.existsSync(path.join(cwd, ".imfine", "runs", "init", "agents", "architect", "handoff.json")), false);
  const freshness = JSON.parse(fs.readFileSync(path.join(cwd, ".imfine", "project", "project-knowledge-freshness.json"), "utf8"));
  assert.equal(freshness.status, "empty");
  const run = createDeliveryRun(cwd, ["Build demo"], { allowNew: false });
  assert.equal(run.projectKind, "new_project");
}

{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-forbid-provider-launch-"));
  assert.throws(
    () => execFileSync(process.execPath, [cli, "launch-codex-agent"], { cwd, encoding: "utf8", stdio: "pipe" }),
    /provider agent launch commands/
  );
}

{
  const installed = install("all", "zh", true).written;
  assert.ok(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-agent-orchestrator"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-init"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-run"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-status"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-observe"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-archive"))));
  assert.equal(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-agent-intake"))), false);
  assert.equal(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-agent-ux-designer"))), false);
  assert.equal(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-brainstorming"))), false);
  assert.equal(installed.some((item) => item.endsWith(path.join(".agents", "skills", "imfine-parallel-agent-dispatch"))), false);
  assert.ok(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-agent-orchestrator.md"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-init.md"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-run.md"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-status.md"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-observe.md"))));
  assert.ok(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-archive.md"))));
  assert.equal(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-agent-intake.md"))), false);
  assert.equal(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-agent-ux-designer.md"))), false);
  assert.equal(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-brainstorming.md"))), false);
  assert.equal(installed.some((item) => item.endsWith(path.join(".claude", "commands", "imfine-parallel-agent-dispatch.md"))), false);
  assert.equal(installed.some((item) => item.endsWith(path.join(".codex", "skills", "imfine", "SKILL.md"))), false);
  assert.match(readLibrary("skills", "imfine-observe"), /imfine-agent-harness-auditor/);
  assert.match(readLibrary("skills", "imfine-harness-audit"), /true_harness_passed=true/);
  const schema = JSON.parse(fs.readFileSync(path.join(root, "src", "imfine-skills", "templates", "orchestrator-session.schema.json"), "utf8"));
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
  assert.equal(value.currentRunBlockers.diagnosticDoc, "docs/IMFINE_IMPLEMENTATION.md#14-runtime-和-agent-边界");
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
  assert.ok(runtimeOnly.provider_execution_receipts.receipts[0].invalid_reasons.includes("origin_not_provider_native_subagent"));
  assert.ok(runtimeOnly.provider_execution_receipts.receipts[0].invalid_reasons.includes("output_snapshot_not_recorded_under_provider_outputs"));
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
  assert.equal(positive.true_harness_passed, false);
  assert.equal(positive.provider_execution_receipts.receipts[0].provider_agent_id, `${provider}-agent-real-T1`);
  assert.match(positive.provider_execution_receipts.receipts[0].output_path, /orchestration\/provider-outputs\/agent-dev-T1\.json$/);
  assert.deepEqual(positive.provider_execution_receipts.receipts[0].invalid_reasons, []);
  assert.equal(positive.provider_execution_receipts.all_contracts_have_provider_receipt, true);
  assert.equal(positive.role_purity.provider_receipts_closed, true);
  assert.equal(positive.role_purity.qa_reviewer_archive_gates_closed, false);
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
  assert.equal(value.true_harness_passed, false);
  assert.equal(value.provider_execution_receipts.valid_receipt_count, 1);
  assert.equal(value.provider_execution_receipts.all_contracts_have_provider_receipt, true);
  assert.equal(value.role_purity.provider_receipts_closed, true);
  assert.equal(value.role_purity.qa_reviewer_archive_gates_closed, false);
  assert.equal(value.provider_execution_receipts.receipts[0].valid_native_subagent_proof, true);
  assert.equal(value.provider_execution_receipts.receipts[0].provider_agent_id, `${provider}-agent-real-T1`);
  assert.match(value.provider_execution_receipts.receipts[0].output_path, /orchestration\/provider-outputs\/agent-dev-T1\.json$/);
}

{
  const fixture = makeRun("imfine-provider-invalid-receipt-diagnostics-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture, { receipt: false });
  const sessionFile = path.join(runDir, "orchestration", "orchestrator-session.json");
  const session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  fs.writeFileSync(sessionFile, JSON.stringify({
    ...session,
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    next_actions: [{
      id: "agent-dev-T1",
      kind: "agent",
      status: "done",
      role: "dev",
      taskId: "T1",
      reason: "completed",
      inputs: [],
      outputs: [path.join(runDir, "agents", "T1", "handoff.json")],
      dependsOn: [],
      parallelGroup: "delivery"
    }],
    agent_runs: [{
      id: "T1",
      role: "dev",
      taskId: "T1",
      status: "completed",
      skills: ["implementation"],
      inputs: [],
      outputs: [path.join(runDir, "agents", "T1", "handoff.json")],
      readScope: [],
      writeScope: [path.join(runDir, "agents", "T1", "**")],
      dependsOn: [],
      parallelGroup: "delivery"
    }]
  }, null, 2) + "\n");
  writeProviderExecutionReceipt(cwd, runId, {
    actionId: "agent-dev-T1",
    agentId: "T1",
    role: "dev",
    taskId: "T1",
    parallelGroup: "delivery",
    status: "completed",
    origin: "provider_native_subagent",
    receiptType: "provider_completed",
    providerAgentId: "codex-agent-real-T1",
    providerSessionId: "codex-session-real-run-1",
    providerTaskHandle: "codex-task-handle-T1",
    outputPath: path.join(runDir, "agents", "T1", "handoff.json")
  });
  const receipt = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "provider-receipts", "agent-dev-T1.json"), "utf8"));
  const validation = validateProviderReceipt(cwd, receipt);
  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes("output_snapshot_not_recorded_under_provider_outputs"));
  assert.ok(validation.reasons.includes("integrity_nonce_missing"));
  assert.ok(validation.reasons.includes("integrity_output_sha256_missing"));
  assert.ok(validation.reasons.includes("metadata_origin_missing"));
  const evidence = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(evidence.true_harness_passed, false);
  assert.deepEqual(evidence.provider_execution_receipts.missing_provider_receipt_contracts, ["T1"]);
  assert.ok(evidence.provider_execution_receipts.receipts[0].invalid_reasons.includes("integrity_output_sha256_missing"));
  const value = status(cwd);
  assert.deepEqual(value.currentRunProviderReceipts.missingProviderReceiptActionIds, ["agent-dev-T1"]);
  assert.deepEqual(value.currentRunProviderReceipts.invalidProviderReceiptActionIds, ["agent-dev-T1"]);
}

{
  const fixture = makeRun("imfine-provider-receipt-metadata-mismatch-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture, { receipt: false });
  const snapshot = path.join(runDir, "orchestration", "provider-outputs", "agent-dev-T1.json");
  const otherSnapshot = path.join(runDir, "orchestration", "provider-outputs", "other.json");
  fs.mkdirSync(path.dirname(snapshot), { recursive: true });
  fs.copyFileSync(path.join(runDir, "agents", "T1", "handoff.json"), snapshot);
  fs.writeFileSync(otherSnapshot, "{}\n");
  writeProviderExecutionReceipt(cwd, runId, {
    actionId: "agent-dev-T1",
    agentId: "T1",
    role: "dev",
    taskId: "T1",
    parallelGroup: "delivery",
    status: "completed",
    origin: "provider_native_subagent",
    receiptType: "provider_completed",
    providerAgentId: "codex-agent-real-T1",
    providerSessionId: "codex-session-real-run-1",
    providerTaskHandle: "codex-task-handle-T1",
    outputPath: snapshot,
    integrity: {
      nonce: "nonce",
      output_sha256: "not-a-real-hash"
    },
    metadata: {
      origin: "provider_native_subagent",
      provider_output_snapshot: otherSnapshot
    }
  });
  const receipt = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "provider-receipts", "agent-dev-T1.json"), "utf8"));
  const validation = validateProviderReceipt(cwd, receipt);
  assert.equal(validation.valid, false);
  assert.ok(validation.reasons.includes("metadata_provider_output_snapshot_mismatch"));
  assert.ok(validation.reasons.includes("integrity_hash_mismatch"));
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
  assert.equal(value.true_harness_passed, false);
  assert.equal(value.role_purity.provider_receipts_closed, true);
  assert.equal(value.role_purity.qa_reviewer_archive_gates_closed, false);
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
  assert.equal(value.currentRunTrueHarnessFreshness.status, "stale");
  assert.ok(value.currentRunTrueHarnessFreshness.staleSources.some((item) => item.includes("orchestrator_session")));
}

{
  const fixture = makeRun("imfine-true-harness-provider-output-stale-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture);
  const files = writeTrueHarnessEvidence(cwd, runId);
  const evidence = JSON.parse(fs.readFileSync(files.json, "utf8"));
  assert.ok(evidence.source_artifacts.some((item) => item.id === "provider_output:agent-dev-T1.json"));
  const providerOutput = path.join(runDir, "orchestration", "provider-outputs", "agent-dev-T1.json");
  fs.appendFileSync(providerOutput, "\nchanged after evidence\n");
  const stale = staleTrueHarnessEvidence(files.json);
  assert.ok(stale.some((item) => item.includes("provider_output:agent-dev-T1.json")));
  const value = status(cwd);
  assert.equal(value.currentRunTrueHarnessFreshness.status, "stale");
  assert.ok(value.currentRunTrueHarnessFreshness.staleSources.some((item) => item.includes("provider_output:agent-dev-T1.json")));
}

{
  const fixture = makeRun("imfine-true-harness-standard-evidence-stale-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture);
  fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Tests\n\npass\n");
  const files = writeTrueHarnessEvidence(cwd, runId);
  const evidence = JSON.parse(fs.readFileSync(files.json, "utf8"));
  assert.ok(evidence.source_artifacts.some((item) => item.id === "qa_evidence"));
  fs.appendFileSync(path.join(runDir, "evidence", "test-results.md"), "\nchanged after evidence\n");
  assert.ok(staleTrueHarnessEvidence(files.json).some((item) => item.includes("qa_evidence")));
}

{
  const fixture = makeRun("imfine-true-harness-new-source-stale-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture);
  fs.rmSync(path.join(runDir, "orchestration", "provider-receipts"), { recursive: true, force: true });
  fs.rmSync(path.join(runDir, "orchestration", "provider-outputs"), { recursive: true, force: true });
  const files = writeTrueHarnessEvidence(cwd, runId);
  assert.deepEqual(staleTrueHarnessEvidence(files.json), []);
  fs.writeFileSync(path.join(runDir, "orchestration", "final-gates.json"), JSON.stringify({ gates: { true_harness: "pass" } }, null, 2) + "\n");
  const finalGateStale = staleTrueHarnessEvidence(files.json);
  assert.ok(finalGateStale.some((item) => item.includes("final_gates: created after evidence generation")));
  fs.mkdirSync(path.join(runDir, "orchestration", "provider-receipts"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "orchestration", "provider-receipts", "agent-dev-T1.json"), JSON.stringify({ action_id: "agent-dev-T1" }, null, 2) + "\n");
  const receiptStale = staleTrueHarnessEvidence(files.json);
  assert.ok(receiptStale.some((item) => item.includes("provider_receipt:agent-dev-T1.json: created after evidence generation")));
  const value = status(cwd);
  assert.equal(value.currentRunTrueHarnessFreshness.status, "stale");
  assert.ok(value.currentRunTrueHarnessFreshness.staleSources.some((item) => item.includes("provider_receipt:agent-dev-T1.json")));
}

{
  const fixture = makeRun("imfine-provider-observations-");
  const { cwd, runId, runDir } = fixture;
  writeHarnessFixture(fixture, { receipt: false });
  writeProviderObservation(cwd, runId, "ui-screenshot", {
    timestamp: "2026-05-20T08:00:00.000Z",
    observedAgentNames: ["Tesla", "Rawls"],
    observedClosedCount: 2,
    screenshotPath: "screenshots/demo.png",
    userNote: "provider UI showed two closed native agents"
  });
  fs.writeFileSync(path.join(runDir, "orchestration", "agent-name-map.json"), JSON.stringify({
    mappings: [{ provider_display_name: "Tesla", action_id: "agent-dev-T1", role: "dev", parallel_group: "delivery", started_at: "2026-05-20T08:00:00.000Z", expected_output: "agents/T1/handoff.json" }]
  }, null, 2) + "\n");
  const evidence = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(evidence.true_harness_passed, false);
  assert.deepEqual(evidence.provider_execution_receipts.missing_provider_receipt_contracts, ["T1"]);
  assert.equal(evidence.provider_observations.present, true);
  assert.deepEqual(evidence.provider_observations.observed_native_agents, ["Tesla", "Rawls"]);
  assert.equal(evidence.provider_observations.observations[0].screenshot_path, "screenshots/demo.png");
  assert.equal(evidence.provider_observations.observations[0].user_note, "provider UI showed two closed native agents");
  assert.equal(evidence.provider_observations.proof_boundary, "diagnostic_only_not_true_harness_proof");
  assert.equal(evidence.agent_name_map.present, true);
  const value = status(cwd);
  assert.equal(value.currentRunProviderObservations.present, true);
  assert.equal(value.currentRunProviderObservations.observedClosedCount, 2);
  assert.deepEqual(value.currentRunProviderObservations.screenshots, ["screenshots/demo.png"]);
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

{
  const { cwd, runDir, runId } = makeRun("imfine-status-quality-lineage-next-owner-");
  fs.writeFileSync(path.join(cwd, "README.md"), "# Demo\n\nNode 22.\n");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ engines: { node: ">=22" }, scripts: { test: "node --test" } }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Test Results\n\n- runtime version: node v22.17.0\n- command: npm run test\n\n```text\nPASS 1 test\n```\n");
  const firstEvidence = path.join(runDir, "evidence", "qa-first.md");
  const recheckEvidence = path.join(runDir, "evidence", "qa-recheck.md");
  fs.writeFileSync(firstEvidence, "# QA first\n\nfail\n");
  fs.writeFileSync(recheckEvidence, "# QA recheck\n\npass\n");
  fs.mkdirSync(path.join(runDir, "agents", "qa-T1"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "agents", "qa-T1", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "dev",
    status: "fail",
    summary: "qa blocked",
    commands: [],
    failures: ["qa-blocker"],
    finding_ids: ["qa-blocker"],
    evidence: [firstEvidence],
    next_state: "needs_dev_fix"
  }, null, 2) + "\n");
  fs.mkdirSync(path.join(runDir, "agents", "qa-T1-recheck"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "agents", "qa-T1-recheck", "handoff.json"), JSON.stringify({
    run_id: runId,
    task_id: "T1",
    role: "qa",
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "qa recheck pass",
    commands: [],
    failures: [],
    evidence: [recheckEvidence],
    resolves: ["qa-blocker"],
    supersedes: ["qa-blocker"],
    next_state: "reviewing"
  }, null, 2) + "\n");
  const value = status(cwd);
  assert.equal(value.currentRunQualityLineage.qa, "pass");
  assert.equal(value.currentRunGates.qa, "pass");
  assert.equal(value.currentRunGates.recheck_fix_loop, "pass");
  assert.equal(value.currentRunNextOwner.owner, "agent");
  assert.equal(value.currentRunNextOwner.reason, "Review lineage is blocked");
}

{
  const { cwd, runDir } = makeRun("imfine-status-standard-evidence-");
  fs.writeFileSync(path.join(runDir, "orchestration", "standard-evidence.json"), JSON.stringify({
    schema_version: 1,
    records: [
      { id: "qa", standard_path: path.join(".imfine", "runs", "run-1", "evidence", "test-results.md"), exists: false, sources: [] },
      { id: "review", standard_path: path.join(".imfine", "runs", "run-1", "evidence", "review.md"), exists: true, sources: ["review/code-review.md"] }
    ]
  }, null, 2) + "\n");
  const value = status(cwd);
  assert.ok(value.currentRunStandardEvidence.missing.some((item) => item.endsWith(path.join("evidence", "test-results.md"))));
  assert.equal(value.currentRunStandardEvidence.records.find((item) => item.id === "review").sources[0], "review/code-review.md");
}

{
  const { cwd } = makeRun("imfine-runtime-requirements-status-blocked-");
  const value = status(cwd);
  assert.equal(value.currentRunRuntimeRequirements.status, "blocked");
  assert.ok(value.currentRunRuntimeRequirements.blockedChecks.includes("runtime_version_declaration"));
  assert.ok(value.currentRunRuntimeRequirements.blockedChecks.includes("qa_records_runtime_version"));
  assert.equal(value.currentRunGates.runtime_requirements, "blocked");
  assert.equal(value.currentRunNextOwner.owner, "project_code");
  assert.equal(value.currentRunHarnessComponents.issueCoverageCount, 16);
  assert.ok(value.currentRunHarnessComponents.componentCount >= 16);
  assert.ok(fs.existsSync(value.currentRunHarnessComponents.file));
}

{
  const { cwd, runId, runDir } = makeRun("imfine-runtime-requirements-pass-");
  fs.writeFileSync(path.join(cwd, "README.md"), "# Demo\n\nRun with Node 22.\n");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    engines: { node: ">=22" },
    scripts: { test: "node --test" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Test Results\n\n- runtime version: node v22.17.0\n- command: npm run test\n\n```text\nPASS 4 tests\n```\n");
  const written = writeRuntimeRequirements(cwd, runId);
  assert.equal(written.result.status, "pass");
  assert.deepEqual(written.result.declared_runtime.languages, ["node"]);
  const value = status(cwd);
  assert.equal(value.currentRunRuntimeRequirements.status, "pass");
  assert.equal(value.currentRunGates.runtime_requirements, "pass");
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
  const { cwd, runDir } = makeRun("imfine-status-forged-final-gates-");
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: "run-1",
    status: "completed",
    execution_mode: "true_harness",
    project_kind: "existing_project",
    source: { type: "text", value: "test" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "orchestration", "final-gates.json"), JSON.stringify({
    generated_by: "archive-agent",
    gates: {
      qa: "pass",
      review: "pass",
      archive: "pass"
    }
  }, null, 2) + "\n");
  const value = status(cwd);
  assert.equal(value.currentRunConsistency, "inconsistent");
  assert.match(value.currentRunGates.status_consistency, /^invalid_final_gates:/);
  assert.match(value.currentRunGates.status_consistency, /generated_by imfine-runtime/);
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
