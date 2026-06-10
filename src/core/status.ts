import fs from "node:fs";
import path from "node:path";
import { blockerSummary } from "./blocker-summary.js";
import { validateRuntimeFinalGates } from "./final-gates.js";
import { writeHarnessComponents } from "./harness-components.js";
import { writeHarnessDebuggerReport } from "./harness-debugger.js";
import { ingestOrchestratorSession } from "./orchestrator.js";
import { providerObservations } from "./provider-observation.js";
import { providerReceipts, validateProviderReceipt } from "./provider-evidence.js";
import { readQualityLineage, writeQualityLineage } from "./quality-lineage.js";
import { writeRuntimeRequirements } from "./runtime-requirements.js";
import { readSandboxVerification } from "./sandbox-runner.js";
import { staleTrueHarnessEvidence } from "./true-harness-evidence.js";
import { appendRuntimeTraceEvent, latestBlockerTrace } from "./trace-events.js";

export interface StatusResult {
  cwd: string;
  initialized: boolean;
  workspace: string;
  currentRunId: string | null;
  currentRunStatus: string | null;
  currentRunExecutionMode: string | null;
  currentRunBranch: string | null;
  currentRunGates: Record<string, string> | null;
  currentRunConsistency: "consistent" | "inconsistent" | null;
  currentRunDispatch: {
    contractCount: number;
    waveCount: number;
    missingCompletedWaveActionIds: string[];
  } | null;
  currentRunHandoffFiles: string[];
  currentRunProviderReceipts: {
    receiptCount: number;
    validReceiptCount: number;
    missingProviderReceiptActionIds: string[];
    invalidProviderReceiptActionIds: string[];
  } | null;
  currentRunProviderObservations: {
    present: boolean;
    observationCount: number;
    observedAgentNames: string[];
    observedClosedCount: number;
    screenshots: string[];
    notes: string[];
    proofBoundary: string;
  } | null;
  currentRunAgentNameMap: {
    present: boolean;
    mappings: Array<{
      providerDisplayName: string;
      actionId: string;
      dispatchContractId: string;
      role: string;
      parallelGroup: string;
      handoffPath: string | null;
      providerReceiptPath: string | null;
      gateIds: string[];
    }>;
  } | null;
  currentRunTrueHarnessFreshness: {
    status: "fresh" | "stale" | "missing";
    staleSources: string[];
  } | null;
  currentRunQualityLineage: {
    qa: string;
    review: string;
    recheckFixLoop: string;
    coverage: {
      expectedTasks: string[];
      qaPassed: number;
      qaExpected: number;
      qaMissing: string[];
      reviewPassed: number;
      reviewExpected: number;
      reviewMissing: string[];
    };
    latest: Array<{
      role: string;
      taskId: string;
      status: string;
      latestStatus: string;
      latestHandoff: string | null;
      unresolvedFindings: string[];
      invalidRecheckCount: number;
    }>;
  } | null;
  currentRunStandardEvidence: {
    missing: string[];
    records: Array<{
      id: string;
      standardPath: string;
      exists: boolean;
      sources: string[];
    }>;
  } | null;
  currentRunRuntimeRequirements: {
    status: string;
    declaredLanguages: string[];
    declarationFiles: string[];
    observedVersions: string[];
    blockedChecks: string[];
    qaEvidence: {
      recordsRuntimeVersion: boolean;
      recordsTestCommand: boolean;
      recordsTestOutput: boolean;
    };
  } | null;
  currentRunSandboxVerification: {
    present: boolean;
    status: string;
    sandboxDir: string | null;
    commandCount: number;
    failedCommands: string[];
    environmentMismatch: boolean;
  } | null;
  currentRunHarnessComponents: {
    file: string;
    componentCount: number;
    issueCoverageCount: number;
  } | null;
  currentRunRecentBlockerTrace: Array<{
    eventId: string;
    componentId: string;
    actionId: string;
    reason: string;
    outputArtifacts: string[];
  }>;
  currentRunHarnessDebugger: {
    overview: string;
    detail: string;
    primaryBlocker: string | null;
  } | null;
  currentRunNextOwner: {
    owner: "runtime" | "orchestrator" | "agent" | "provider" | "user" | "project_code";
    reason: string;
    evidence: string[];
  } | null;
  currentRunActions: {
    ready: number;
    waiting: number;
    blocked: number;
    currentParallelGroups: string[];
  } | null;
  currentRunBlockers: {
    file: string;
    status: string;
    items: number;
    firstReason: string | null;
    nextAction: string | null;
    diagnosticDoc: string | null;
  } | null;
  currentRunLatestCheckpoint: {
    file: string;
    actionId: string;
    status: string;
    detail: string;
    recordedAt: string;
  } | null;
  currentRunDemoWarnings: string[];
  currentRunAgentProgress: {
    architect: string;
    taskPlanner: string;
    devCompleted: number;
    devTotal: number;
    qaPassed: number;
    qaTotal: number;
    reviewApproved: number;
    reviewTotal: number;
  } | null;
  runs: Array<{
    runId: string;
    status: string;
    source: string;
    relation: "current" | "active" | "completed" | "blocked";
    updatedAt: string | null;
  }>;
  reports: string[];
}

export interface ReportResult {
  runId: string;
  file: string;
  exists: boolean;
  content?: string;
}

function gatesAreComplete(gates: Record<string, string> | null): boolean {
  if (!gates) return false;
  const required = [
    "planning",
    "dispatch",
    "qa",
    "review",
    "recheck_fix_loop",
    "committer",
    "push",
    "archive",
    "true_harness",
    "project_knowledge"
  ];
  return required.every((key) => gates[key] === "pass");
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function actionIdsForContract(contract: { id?: unknown; action_id?: unknown; role?: unknown; task_id?: unknown }): string[] {
  const id = typeof contract.id === "string" ? contract.id : "";
  const actionId = typeof contract.action_id === "string" ? contract.action_id : "";
  const role = typeof contract.role === "string" ? contract.role : "";
  const taskId = typeof contract.task_id === "string" ? contract.task_id : "";
  return [
    actionId,
    id,
    id ? `agent-${id}` : "",
    role ? `agent-${role}` : "",
    role && taskId ? `agent-${role}-${taskId}` : ""
  ].filter((item) => item.length > 0);
}

function displayActionId(contract: { id?: unknown; action_id?: unknown; role?: unknown; task_id?: unknown }): string {
  if (typeof contract.action_id === "string" && contract.action_id.trim()) return contract.action_id;
  if (typeof contract.role === "string" && contract.role.trim() && typeof contract.task_id === "string" && contract.task_id.trim()) {
    return `agent-${contract.role}-${contract.task_id}`;
  }
  if (typeof contract.id === "string" && contract.id.trim()) return contract.id;
  return "unknown";
}

function dispatchStatus(runRoot: string): StatusResult["currentRunDispatch"] {
  const orchestration = path.join(runRoot, "orchestration");
  const dispatchFile = path.join(orchestration, "dispatch-contracts.json");
  const parallelFile = path.join(orchestration, "parallel-execution.json");
  if (!fs.existsSync(dispatchFile)) return null;
  const dispatch = readJson<{ contracts?: Array<{ id?: unknown; action_id?: unknown; role?: unknown; task_id?: unknown; kind?: unknown; status?: unknown }> }>(dispatchFile);
  const contracts = Array.isArray(dispatch.contracts) ? dispatch.contracts : [];
  const parallel = fs.existsSync(parallelFile)
    ? readJson<{ wave_history?: Array<{ status?: unknown; action_ids?: unknown }> }>(parallelFile)
    : {};
  const waves = Array.isArray(parallel.wave_history) ? parallel.wave_history : [];
  const completedActionIds = new Set(waves
    .filter((wave) => wave.status === "completed" && Array.isArray(wave.action_ids))
    .flatMap((wave) => (wave.action_ids as unknown[]).filter((item): item is string => typeof item === "string")));
  const missingCompletedWaveActionIds = contracts
    .filter((contract) => contract.kind !== "runtime" && contract.status !== "blocked")
    .filter((contract) => !actionIdsForContract(contract).some((id) => completedActionIds.has(id)))
    .map((contract) => displayActionId(contract));
  return {
    contractCount: contracts.length,
    waveCount: waves.length,
    missingCompletedWaveActionIds
  };
}

function handoffFiles(cwd: string, runRoot: string): string[] {
  const agentsDir = path.join(runRoot, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(agentsDir, entry.name, "handoff.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => path.relative(cwd, file))
    .sort();
}

function providerReceiptStatus(cwd: string, runRoot: string, runId: string): StatusResult["currentRunProviderReceipts"] {
  const orchestration = path.join(runRoot, "orchestration");
  const dispatchFile = path.join(orchestration, "dispatch-contracts.json");
  if (!fs.existsSync(dispatchFile)) return null;
  const dispatch = readJson<{ contracts?: Array<{ id?: unknown; action_id?: unknown; role?: unknown; task_id?: unknown; kind?: unknown }> }>(dispatchFile);
  const agentContracts = Array.isArray(dispatch.contracts)
    ? dispatch.contracts.filter((contract) => contract.kind !== "runtime")
    : [];
  const receipts = providerReceipts(cwd, runId);
  const validations = receipts.map((receipt) => validateProviderReceipt(cwd, receipt));
  const validReceiptActionIds = validations.filter((validation) => validation.valid).map((validation) => validation.action_id);
  const allReceiptActionIds = validations.map((validation) => validation.action_id);
  const matchesReceipt = (contract: { id?: unknown; action_id?: unknown; role?: unknown; task_id?: unknown }, actionIds: string[]): boolean => {
    const aliases = new Set(actionIdsForContract(contract));
    return actionIds.some((id) => aliases.has(id));
  };
  const missingProviderReceiptActionIds = agentContracts
    .filter((contract) => !matchesReceipt(contract, validReceiptActionIds))
    .map((contract) => displayActionId(contract));
  const invalidProviderReceiptActionIds = agentContracts
    .filter((contract) => matchesReceipt(contract, allReceiptActionIds))
    .filter((contract) => !matchesReceipt(contract, validReceiptActionIds))
    .map((contract) => displayActionId(contract));
  return {
    receiptCount: receipts.length,
    validReceiptCount: validations.filter((validation) => validation.valid).length,
    missingProviderReceiptActionIds,
    invalidProviderReceiptActionIds
  };
}

function runEvidenceScore(cwd: string, runId: string): number {
  const root = path.join(cwd, ".imfine", "runs", runId);
  const agentsDir = path.join(root, "agents");
  const handoffCount = fs.existsSync(agentsDir)
    ? fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => fs.existsSync(path.join(agentsDir, entry.name, "handoff.json"))).length
    : 0;
  const receiptCount = providerReceipts(cwd, runId).filter((receipt) => validateProviderReceipt(cwd, receipt).valid).length;
  return handoffCount + receiptCount;
}

function agentProgress(runRoot: string, quality: StatusResult["currentRunQualityLineage"]): StatusResult["currentRunAgentProgress"] {
  const dispatchFile = path.join(runRoot, "orchestration", "dispatch-contracts.json");
  if (!fs.existsSync(dispatchFile)) return null;
  const dispatch = readJson<{ contracts?: Array<{ role?: unknown; status?: unknown; kind?: unknown }> }>(dispatchFile);
  const contracts = Array.isArray(dispatch.contracts) ? dispatch.contracts.filter((contract) => contract.kind !== "runtime") : [];
  const countRole = (role: string, status: string): number => contracts.filter((contract) => contract.role === role && contract.status === status).length;
  const totalRole = (role: string): number => contracts.filter((contract) => contract.role === role).length;
  const architectDone = countRole("architect", "done") > 0 ? "completed" : totalRole("architect") > 0 ? "pending" : "none";
  const taskPlannerDone = countRole("task-planner", "done") > 0 ? "completed" : totalRole("task-planner") > 0 ? "pending" : "none";
  const qaExpected = quality?.coverage.qaExpected || totalRole("qa");
  const reviewExpected = quality?.coverage.reviewExpected || totalRole("reviewer");
  return {
    architect: architectDone,
    taskPlanner: taskPlannerDone,
    devCompleted: countRole("dev", "done") + countRole("technical-writer", "done"),
    devTotal: totalRole("dev") + totalRole("technical-writer"),
    qaPassed: quality?.coverage.qaPassed || countRole("qa", "done"),
    qaTotal: qaExpected,
    reviewApproved: quality?.coverage.reviewPassed || countRole("reviewer", "done"),
    reviewTotal: reviewExpected
  };
}

function providerObservationStatus(cwd: string, runRoot: string): StatusResult["currentRunProviderObservations"] {
  const observations = providerObservations(cwd, runRoot);
  return {
    present: observations.length > 0,
    observationCount: observations.length,
    observedAgentNames: Array.from(new Set(observations.flatMap((item) => item.observed_agent_names))),
    observedClosedCount: observations.reduce((total, item) => total + (item.observed_closed_count || 0), 0),
    screenshots: observations.map((item) => item.screenshot_path).filter((item): item is string => typeof item === "string" && item.length > 0),
    notes: observations.map((item) => item.user_note).filter((item): item is string => typeof item === "string" && item.length > 0),
    proofBoundary: "diagnostic_only_not_true_harness_proof"
  };
}

function agentNameMapStatus(runRoot: string): StatusResult["currentRunAgentNameMap"] {
  const file = path.join(runRoot, "orchestration", "agent-name-map.json");
  if (!fs.existsSync(file)) return { present: false, mappings: [] };
  const parsed = readJson<{ mappings?: Array<Record<string, unknown>> }>(file);
  const mappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];
  return {
    present: true,
    mappings: mappings.map((item) => ({
      providerDisplayName: typeof item.provider_display_name === "string" ? item.provider_display_name : "unknown",
      actionId: typeof item.action_id === "string" ? item.action_id : "unknown",
      dispatchContractId: typeof item.dispatch_contract_id === "string" ? item.dispatch_contract_id : "unknown",
      role: typeof item.role === "string" ? item.role : "unknown",
      parallelGroup: typeof item.parallel_group === "string" ? item.parallel_group : "unknown",
      handoffPath: typeof item.handoff_path === "string" ? item.handoff_path : typeof item.expected_output === "string" ? item.expected_output : null,
      providerReceiptPath: typeof item.provider_receipt_path === "string" ? item.provider_receipt_path : null,
      gateIds: Array.isArray(item.gate_ids) ? item.gate_ids.filter((entry): entry is string => typeof entry === "string") : []
    }))
  };
}

function qualityLineageStatus(cwd: string, runId: string): StatusResult["currentRunQualityLineage"] {
  writeQualityLineage(cwd, runId);
  const lineage = readQualityLineage(cwd, runId);
  if (!lineage) return null;
  const coverage = lineage.summary.coverage || {
    expected_tasks: [],
    qa: { passed: 0, expected: 0, missing: [] },
    review: { passed: 0, expected: 0, missing: [] }
  };
  return {
    qa: lineage.summary.qa,
    review: lineage.summary.review,
    recheckFixLoop: lineage.summary.recheck_fix_loop,
    coverage: {
      expectedTasks: coverage.expected_tasks,
      qaPassed: coverage.qa.passed,
      qaExpected: coverage.qa.expected,
      qaMissing: coverage.qa.missing,
      reviewPassed: coverage.review.passed,
      reviewExpected: coverage.review.expected,
      reviewMissing: coverage.review.missing
    },
    latest: lineage.lineages.map((item) => ({
      role: item.role,
      taskId: item.task_id,
      status: item.status,
      latestStatus: item.latest_status,
      latestHandoff: item.latest_handoff,
      unresolvedFindings: item.unresolved_findings,
      invalidRecheckCount: item.invalid_rechecks.length
    }))
  };
}

function standardEvidenceStatus(runRoot: string): StatusResult["currentRunStandardEvidence"] {
  const file = path.join(runRoot, "orchestration", "standard-evidence.json");
  if (!fs.existsSync(file)) return null;
  const parsed = readJson<{ records?: Array<{ id?: unknown; standard_path?: unknown; exists?: unknown; sources?: unknown[] }> }>(file);
  const records = Array.isArray(parsed.records)
    ? parsed.records.map((record) => ({
      id: typeof record.id === "string" ? record.id : "unknown",
      standardPath: typeof record.standard_path === "string" ? record.standard_path : "unknown",
      exists: record.exists === true,
      sources: Array.isArray(record.sources) ? record.sources.filter((item): item is string => typeof item === "string") : []
    }))
    : [];
  return {
    missing: records.filter((record) => !record.exists).map((record) => record.standardPath),
    records
  };
}

function runtimeRequirementsStatus(cwd: string, runId: string): StatusResult["currentRunRuntimeRequirements"] {
  const written = writeRuntimeRequirements(cwd, runId);
  const result = written.result;
  return {
    status: result.status,
    declaredLanguages: result.declared_runtime.languages,
    declarationFiles: result.declared_runtime.files,
    observedVersions: result.observed_runtime_versions.map((item) => `${item.runtime}:${item.status}:${item.version}`),
    blockedChecks: result.checks.filter((item) => item.status === "blocked").map((item) => item.id),
    qaEvidence: {
      recordsRuntimeVersion: result.qa_evidence.records_runtime_version,
      recordsTestCommand: result.qa_evidence.records_test_command,
      recordsTestOutput: result.qa_evidence.records_test_output
    }
  };
}

function sandboxVerificationStatus(cwd: string, runId: string, runRoot: string): StatusResult["currentRunSandboxVerification"] {
  const result = readSandboxVerification(cwd, runId);
  if (!result) return {
    present: false,
    status: "missing",
    sandboxDir: null,
    commandCount: 0,
    failedCommands: [],
    environmentMismatch: false
  };
  const commands = [...result.runtime_versions, ...result.install_commands, ...result.test_commands];
  const failedCommands = commands.filter((item) => item.exit_code !== 0).map((item) => item.command);
  const qaText = fs.existsSync(path.join(runRoot, "evidence", "test-results.md"))
    ? fs.readFileSync(path.join(runRoot, "evidence", "test-results.md"), "utf8")
    : "";
  const qaClaimsPass = /\b(pass|passed|ok|success|通过)\b/i.test(qaText);
  return {
    present: true,
    status: result.status,
    sandboxDir: result.sandbox_dir,
    commandCount: commands.length,
    failedCommands,
    environmentMismatch: result.status === "blocked" && qaClaimsPass
  };
}

function harnessComponentsStatus(cwd: string, runId: string): StatusResult["currentRunHarnessComponents"] {
  const file = writeHarnessComponents(cwd, runId);
  const parsed = readJson<{ components?: unknown[]; issue_coverage?: unknown[] }>(file);
  return {
    file,
    componentCount: Array.isArray(parsed.components) ? parsed.components.length : 0,
    issueCoverageCount: Array.isArray(parsed.issue_coverage) ? parsed.issue_coverage.length : 0
  };
}

function nextOwnerStatus(runRoot: string, runStatus: string | null, gates: Record<string, string> | null, dispatch: StatusResult["currentRunDispatch"], receipts: StatusResult["currentRunProviderReceipts"], freshness: StatusResult["currentRunTrueHarnessFreshness"], quality: StatusResult["currentRunQualityLineage"], standardEvidence: StatusResult["currentRunStandardEvidence"], runtimeRequirements: StatusResult["currentRunRuntimeRequirements"]): StatusResult["currentRunNextOwner"] {
  const orchestration = path.join(runRoot, "orchestration");
  const finalGates = path.join(orchestration, "final-gates.json");
  if (runStatus === "completed" && (!gates || !gatesAreComplete(gates))) {
    return { owner: "runtime", reason: "completed run has missing or blocked final gates", evidence: [finalGates] };
  }
  if (freshness?.status === "stale") {
    return { owner: "runtime", reason: "true harness evidence is stale", evidence: freshness.staleSources };
  }
  if (dispatch && dispatch.missingCompletedWaveActionIds.length > 0) {
    return { owner: "orchestrator", reason: "dispatch contracts are missing completed waves", evidence: dispatch.missingCompletedWaveActionIds };
  }
  if (receipts && receipts.missingProviderReceiptActionIds.length > 0) {
    return { owner: "provider", reason: "provider-origin receipts are missing", evidence: receipts.missingProviderReceiptActionIds };
  }
  if (receipts && receipts.invalidProviderReceiptActionIds.length > 0) {
    return { owner: "provider", reason: "provider-origin receipts are invalid", evidence: receipts.invalidProviderReceiptActionIds };
  }
  if (runtimeRequirements && runtimeRequirements.status !== "pass") {
    return { owner: "project_code", reason: "runtime requirements or QA environment evidence are blocked", evidence: runtimeRequirements.blockedChecks };
  }
  if (quality && quality.qa !== "pass") {
    return { owner: "agent", reason: "QA lineage is blocked", evidence: quality.latest.filter((item) => item.role === "qa").flatMap((item) => item.unresolvedFindings.length > 0 ? item.unresolvedFindings : [item.latestHandoff || item.taskId]) };
  }
  if (quality && quality.review !== "pass") {
    return { owner: "agent", reason: "Review lineage is blocked", evidence: quality.latest.filter((item) => item.role === "reviewer").flatMap((item) => item.unresolvedFindings.length > 0 ? item.unresolvedFindings : [item.latestHandoff || item.taskId]) };
  }
  if (standardEvidence && standardEvidence.missing.length > 0) {
    return { owner: "agent", reason: "standard evidence is missing", evidence: standardEvidence.missing };
  }
  if (gates) {
    if (gates.commit === "blocked" || gates.committer === "blocked") return { owner: "user", reason: "commit evidence is blocked or missing", evidence: [path.join(runRoot, "evidence", "commits.md")] };
    if (gates.push === "blocked") return { owner: "user", reason: "push outcome is blocked or missing", evidence: [path.join(runRoot, "evidence", "push.md")] };
    if (gates.runtime_requirements === "blocked") return { owner: "project_code", reason: "runtime requirements gate is blocked", evidence: [path.join(orchestration, "runtime-requirements.json")] };
    if (gates.acceptance_matrix === "blocked") return { owner: "agent", reason: "acceptance matrix has blocked required items", evidence: [path.join(orchestration, "acceptance-matrix.json")] };
    if (gates.project_knowledge === "blocked") return { owner: "project_code", reason: "project knowledge is stale or incomplete", evidence: [path.join(runRoot, "..", "..", "project")] };
    const blockedGate = Object.entries(gates).find(([key, value]) => key !== "status_consistency" && value === "blocked");
    if (blockedGate) return { owner: "runtime", reason: `final gate ${blockedGate[0]} is blocked`, evidence: [blockedGate[0]] };
  }
  if (!fs.existsSync(finalGates)) {
    return { owner: "runtime", reason: "run is not finalized", evidence: [finalGates] };
  }
  return { owner: "runtime", reason: "no blocking next action detected", evidence: [] };
}

function runConsistency(runRoot: string, runStatus: string | null, gates: Record<string, string> | null): StatusResult["currentRunConsistency"] {
  const orchestration = path.join(runRoot, "orchestration");
  const sessionFile = path.join(orchestration, "orchestrator-session.json");
  const trueHarness = path.join(orchestration, "true-harness-evidence.json");
  const agentRunsFile = path.join(orchestration, "agent-runs.json");
  const dispatchFile = path.join(orchestration, "dispatch-contracts.json");
  const parallelFile = path.join(orchestration, "parallel-execution.json");
  if (runStatus === "completed" && !gatesAreComplete(gates)) return "inconsistent";
  if (fs.existsSync(sessionFile)) {
    const session = readJson<{ status?: unknown }>(sessionFile);
    const sessionCompleted = session.status === "completed";
    if (sessionCompleted && runStatus !== "completed") return "inconsistent";
    if (sessionCompleted && !fs.existsSync(path.join(orchestration, "final-gates.json"))) return "inconsistent";
  }
  if (fs.existsSync(trueHarness) && staleTrueHarnessEvidence(trueHarness).length > 0) return "inconsistent";
  if (fs.existsSync(agentRunsFile) && fs.existsSync(dispatchFile)) {
    const agentRuns = readJson<{ agents?: unknown[] }>(agentRunsFile);
    const dispatch = readJson<{ contracts?: unknown[] }>(dispatchFile);
    if (Array.isArray(agentRuns.agents) && Array.isArray(dispatch.contracts) && dispatch.contracts.length > 0 && agentRuns.agents.length === 0) {
      return "inconsistent";
    }
  }
  if (fs.existsSync(dispatchFile) && fs.existsSync(parallelFile)) {
    const dispatch = readJson<{ contracts?: unknown[] }>(dispatchFile);
    const parallel = readJson<{ wave_history?: unknown[] }>(parallelFile);
    if (Array.isArray(dispatch.contracts) && dispatch.contracts.length > 0 && (!Array.isArray(parallel.wave_history) || parallel.wave_history.length === 0)) {
      return "inconsistent";
    }
  }
  const dispatch = dispatchStatus(runRoot);
  if (dispatch && dispatch.missingCompletedWaveActionIds.length > 0) return "inconsistent";
  return "consistent";
}

export function status(cwd: string, selectedRunId?: string): StatusResult {
  const workspace = path.join(cwd, ".imfine");
  const currentFile = path.join(workspace, "state", "current.json");
  let currentRunId: string | null = selectedRunId || null;
  let currentRunStatus: string | null = null;
  let currentRunExecutionMode: string | null = null;
  let currentRunBranch: string | null = null;
  let currentRunGates: StatusResult["currentRunGates"] = null;
  let currentRunConsistency: StatusResult["currentRunConsistency"] = null;
  let currentRunDispatch: StatusResult["currentRunDispatch"] = null;
  let currentRunHandoffFiles: StatusResult["currentRunHandoffFiles"] = [];
  let currentRunProviderReceipts: StatusResult["currentRunProviderReceipts"] = null;
  let currentRunProviderObservations: StatusResult["currentRunProviderObservations"] = null;
  let currentRunAgentNameMap: StatusResult["currentRunAgentNameMap"] = null;
  let currentRunTrueHarnessFreshness: StatusResult["currentRunTrueHarnessFreshness"] = null;
  let currentRunQualityLineage: StatusResult["currentRunQualityLineage"] = null;
  let currentRunStandardEvidence: StatusResult["currentRunStandardEvidence"] = null;
  let currentRunRuntimeRequirements: StatusResult["currentRunRuntimeRequirements"] = null;
  let currentRunSandboxVerification: StatusResult["currentRunSandboxVerification"] = null;
  let currentRunHarnessComponents: StatusResult["currentRunHarnessComponents"] = null;
  let currentRunRecentBlockerTrace: StatusResult["currentRunRecentBlockerTrace"] = [];
  let currentRunHarnessDebugger: StatusResult["currentRunHarnessDebugger"] = null;
  let currentRunNextOwner: StatusResult["currentRunNextOwner"] = null;
  let currentRunActions: StatusResult["currentRunActions"] = null;
  let currentRunBlockers: StatusResult["currentRunBlockers"] = null;
  let currentRunLatestCheckpoint: StatusResult["currentRunLatestCheckpoint"] = null;
  let currentRunDemoWarnings: StatusResult["currentRunDemoWarnings"] = [];
  let currentRunAgentProgress: StatusResult["currentRunAgentProgress"] = null;

  if (!selectedRunId && fs.existsSync(currentFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(currentFile, "utf8")) as { current_run_id?: unknown };
      currentRunId = typeof parsed.current_run_id === "string" ? parsed.current_run_id : null;
    } catch {
      currentRunId = null;
    }
  }

  const reportsDir = path.join(workspace, "reports");
  const reports = fs.existsSync(reportsDir)
    ? fs.readdirSync(reportsDir).filter((item) => item.endsWith(".md")).sort()
    : [];
  const runsDir = path.join(workspace, "runs");
  const runs = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const runFile = path.join(runsDir, entry.name, "run.json");
        if (!fs.existsSync(runFile)) return null;
        try {
          const parsed = JSON.parse(fs.readFileSync(runFile, "utf8")) as {
            status?: unknown;
            source?: { value?: unknown };
            updated_at?: unknown;
            created_at?: unknown;
          };
          const runStatus = typeof parsed.status === "string" ? parsed.status : "unknown";
          const relation: "current" | "active" | "completed" | "blocked" = entry.name === currentRunId
            ? "current"
            : runStatus === "completed"
              ? "completed"
              : runStatus === "blocked"
                ? "blocked"
                : "active";
          return {
            runId: entry.name,
            status: runStatus,
            source: typeof parsed.source?.value === "string" ? parsed.source.value : "unknown",
            relation,
            updatedAt: typeof parsed.updated_at === "string" ? parsed.updated_at : typeof parsed.created_at === "string" ? parsed.created_at : null
          };
        } catch {
          return null;
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""))
    : [];

  if (currentRunId) {
    const runFile = path.join(workspace, "runs", currentRunId, "run.json");
    if (fs.existsSync(runFile)) {
      try {
        const sessionFile = path.join(workspace, "runs", currentRunId, "orchestration", "orchestrator-session.json");
        if (fs.existsSync(sessionFile)) ingestOrchestratorSession(cwd, currentRunId, { writeHarnessEvidence: false });
        const parsed = JSON.parse(fs.readFileSync(runFile, "utf8")) as { status?: unknown; execution_mode?: unknown; run_branch?: unknown };
        currentRunStatus = typeof parsed.status === "string" ? parsed.status : null;
        currentRunExecutionMode = typeof parsed.execution_mode === "string" ? parsed.execution_mode : null;
        currentRunBranch = typeof parsed.run_branch === "string" ? parsed.run_branch : null;
        const runRoot = path.join(workspace, "runs", currentRunId);
        currentRunDispatch = dispatchStatus(runRoot);
        currentRunHandoffFiles = handoffFiles(cwd, runRoot);
        currentRunProviderReceipts = providerReceiptStatus(cwd, runRoot, currentRunId);
        currentRunProviderObservations = providerObservationStatus(cwd, runRoot);
        currentRunAgentNameMap = agentNameMapStatus(runRoot);
        currentRunQualityLineage = qualityLineageStatus(cwd, currentRunId);
        currentRunAgentProgress = agentProgress(runRoot, currentRunQualityLineage);
        currentRunStandardEvidence = standardEvidenceStatus(runRoot);
        currentRunRuntimeRequirements = runtimeRequirementsStatus(cwd, currentRunId);
        currentRunSandboxVerification = sandboxVerificationStatus(cwd, currentRunId, runRoot);
        currentRunHarnessComponents = harnessComponentsStatus(cwd, currentRunId);
        const trueHarness = path.join(runRoot, "orchestration", "true-harness-evidence.json");
        if (fs.existsSync(trueHarness)) {
          const staleSources = staleTrueHarnessEvidence(trueHarness);
          currentRunTrueHarnessFreshness = {
            status: staleSources.length > 0 ? "stale" : "fresh",
            staleSources
          };
        } else {
          currentRunTrueHarnessFreshness = {
            status: "missing",
            staleSources: []
          };
        }
        const finalGates = path.join(runRoot, "orchestration", "final-gates.json");
        if (fs.existsSync(finalGates)) {
          const gates = readJson<{ gates?: Record<string, unknown> }>(finalGates);
          currentRunGates = gates.gates
            ? Object.fromEntries(Object.entries(gates.gates).map(([key, value]) => [key, String(value)]))
            : null;
          const finalGateValidation = validateRuntimeFinalGates(finalGates);
          currentRunGates = {
            ...(currentRunGates || {}),
            status_consistency: finalGateValidation.passed
              ? currentRunStatus === "completed" ? "consistent" : "final_gates_pass_run_not_completed"
              : `invalid_final_gates: ${finalGateValidation.errors.join("; ")}`
          };
          currentRunConsistency = runConsistency(runRoot, currentRunStatus, currentRunGates);
        } else {
          const trueHarness = path.join(runRoot, "orchestration", "true-harness-evidence.json");
          const sessionFile = path.join(runRoot, "orchestration", "orchestrator-session.json");
          const session = fs.existsSync(sessionFile) ? readJson<{ status?: unknown }>(sessionFile) : {};
          const providerObservations = path.join(runRoot, "orchestration", "provider-observations");
          const trueHarnessStatus = fs.existsSync(trueHarness)
            ? staleTrueHarnessEvidence(trueHarness).length > 0
              ? "stale"
              : readJson<{ true_harness_passed?: unknown }>(trueHarness).true_harness_passed === true ? "pass" : "blocked"
            : "missing";
          currentRunGates = {
            status_consistency: currentRunStatus === "completed"
              ? "inconsistent_missing_final_gates"
              : session.status === "completed"
                ? "orchestrator_session_unadopted"
                : "not_finalized",
            qa: currentRunQualityLineage?.qa || (fs.existsSync(path.join(runRoot, "evidence", "test-results.md")) ? "present" : "missing"),
            review: currentRunQualityLineage?.review || (fs.existsSync(path.join(runRoot, "evidence", "review.md")) ? "present" : "missing"),
            recheck_fix_loop: currentRunQualityLineage?.recheckFixLoop || "missing",
            runtime_requirements: currentRunRuntimeRequirements?.status === "pass" ? "pass" : "blocked",
            committer: fs.existsSync(path.join(runRoot, "agents", "committer", "handoff.json")) ? "present" : "missing",
            push: fs.existsSync(path.join(runRoot, "evidence", "push.md")) ? "present" : "missing",
            archive: fs.existsSync(path.join(runRoot, "agents", "archive", "handoff.json")) ? "present" : "missing",
            true_harness: trueHarnessStatus,
            provider_observations: fs.existsSync(providerObservations) && fs.readdirSync(providerObservations).some((file) => file.endsWith(".json")) ? "present" : "missing"
          };
          currentRunConsistency = runConsistency(runRoot, currentRunStatus, currentRunGates);
        }
        currentRunNextOwner = nextOwnerStatus(runRoot, currentRunStatus, currentRunGates, currentRunDispatch, currentRunProviderReceipts, currentRunTrueHarnessFreshness, currentRunQualityLineage, currentRunStandardEvidence, currentRunRuntimeRequirements);
        const sandboxStatus = currentRunSandboxVerification;
        if (sandboxStatus?.environmentMismatch) {
          currentRunNextOwner = {
            owner: "project_code",
            reason: "environment / verification mismatch between QA evidence and sandbox output",
            evidence: sandboxStatus.failedCommands
          };
        }
        currentRunRecentBlockerTrace = latestBlockerTrace(cwd, currentRunId, 3).map((event) => ({
          eventId: event.event_id,
          componentId: event.component_id,
          actionId: event.action_id,
          reason: event.reason,
          outputArtifacts: event.output_artifacts
        }));
        const debuggerReport = writeHarnessDebuggerReport(cwd, currentRunId);
        currentRunHarnessDebugger = {
          overview: debuggerReport.overview,
          detail: debuggerReport.detail,
          primaryBlocker: debuggerReport.primaryBlocker
        };
        appendRuntimeTraceEvent(cwd, currentRunId, {
          source: "runtime.status",
          componentId: "runtime.status-dashboard",
          actionId: "runtime.status",
          eventType: "status_checked",
          status: currentRunConsistency === "inconsistent" || currentRunNextOwner?.reason !== "no blocking next action detected" ? "blocked" : "recorded",
          reason: currentRunNextOwner?.reason || "status checked",
          inputArtifacts: [
            path.join(runRoot, "orchestration", "final-gates.json"),
            path.join(runRoot, "orchestration", "true-harness-evidence.json"),
            path.join(runRoot, "orchestration", "runtime-requirements.json")
          ]
        });
        const queue = path.join(runRoot, "orchestration", "queue.json");
        if (fs.existsSync(queue)) {
          const parsedQueue = readJson<{ actions?: Array<{ status?: string; parallelGroup?: string }> }>(queue);
          const actions = Array.isArray(parsedQueue.actions) ? parsedQueue.actions : [];
          currentRunActions = {
            ready: actions.filter((action) => action.status === "ready").length,
            waiting: actions.filter((action) => action.status === "waiting").length,
            blocked: actions.filter((action) => action.status === "blocked").length,
            currentParallelGroups: Array.from(new Set(actions.map((action) => action.parallelGroup).filter((item): item is string => typeof item === "string")))
          };
        }
        const blockerFile = path.join(runRoot, "orchestration", "blocker-summary.json");
        const blockers = blockerSummary(cwd, currentRunId) as { status?: string; sources?: Array<{ blockers?: unknown[] }> };
        if (blockers.sources && blockers.sources.length > 0) {
          const firstBlocker = blockers.sources.flatMap((source) => Array.isArray(source.blockers) ? source.blockers : [])[0];
          currentRunBlockers = {
            file: blockerFile,
            status: blockers.status || "unknown",
            items: Array.isArray(blockers.sources) ? blockers.sources.reduce((total, source) => total + (Array.isArray(source.blockers) ? source.blockers.length : 0), 0) : 0,
            firstReason: firstBlocker && typeof firstBlocker === "object" && typeof (firstBlocker as { reason?: unknown }).reason === "string"
              ? (firstBlocker as { reason: string }).reason
              : typeof firstBlocker === "string"
                ? firstBlocker
                : null,
            nextAction: firstBlocker && typeof firstBlocker === "object"
              ? `owner=${String((firstBlocker as { owner?: unknown }).owner || "orchestrator")}; evidence=${Array.isArray((firstBlocker as { required_evidence?: unknown }).required_evidence) ? ((firstBlocker as { required_evidence: unknown[] }).required_evidence).join(", ") : "unknown"}`
              : typeof firstBlocker === "string"
                ? firstBlocker
                : null,
            diagnosticDoc: firstBlocker && typeof firstBlocker === "object" && typeof (firstBlocker as { diagnostic_doc?: unknown }).diagnostic_doc === "string"
              ? (firstBlocker as { diagnostic_doc: string }).diagnostic_doc
              : null
          };
        }
        const checkpointFile = path.join(runRoot, "orchestration", "checkpoints", "latest.json");
        if (fs.existsSync(checkpointFile)) {
          const checkpoint = readJson<{
            file?: unknown;
            action_id?: unknown;
            status?: unknown;
            detail?: unknown;
            recorded_at?: unknown;
          }>(checkpointFile);
          currentRunLatestCheckpoint = {
            file: typeof checkpoint.file === "string" ? checkpoint.file : checkpointFile,
            actionId: typeof checkpoint.action_id === "string" ? checkpoint.action_id : "unknown",
            status: typeof checkpoint.status === "string" ? checkpoint.status : "unknown",
            detail: typeof checkpoint.detail === "string" ? checkpoint.detail : "unknown",
            recordedAt: typeof checkpoint.recorded_at === "string" ? checkpoint.recorded_at : "unknown"
          };
        }
      } catch {
        currentRunStatus = null;
        currentRunExecutionMode = null;
      }
    }
  }

  if (currentRunId && runs.length > 1) {
    const currentScore = runEvidenceScore(cwd, currentRunId);
    const richer = runs
      .filter((run) => run.runId !== currentRunId)
      .map((run) => ({ ...run, evidenceScore: runEvidenceScore(cwd, run.runId) }))
      .filter((run) => run.evidenceScore > currentScore)
      .sort((left, right) => right.evidenceScore - left.evidenceScore)[0];
    if (richer) {
      currentRunDemoWarnings.push(`current run has less validation evidence than ${richer.runId} (${currentScore} vs ${richer.evidenceScore})`);
    }
  }
  if (currentRunId && currentRunDispatch?.contractCount === 0 && currentRunHandoffFiles.length > 0) {
    currentRunDemoWarnings.push(`session invalid: dispatch not materialized; handoffs found: ${currentRunHandoffFiles.length}; dispatch contracts: 0`);
  }
  if (currentRunId) {
    const runRoot = path.join(workspace, "runs", currentRunId);
    if (fs.existsSync(path.join(runRoot, "acceptance-matrix.json")) && !fs.existsSync(path.join(runRoot, "orchestration", "acceptance-matrix.json"))) {
      currentRunDemoWarnings.push("root-level acceptance-matrix.json is non-standard and is not counted for role purity");
    }
    if (fs.existsSync(path.join(runRoot, "final-gates.json")) && !fs.existsSync(path.join(runRoot, "orchestration", "final-gates.json"))) {
      currentRunDemoWarnings.push("root-level final-gates.json is agent-authored evidence and does not replace runtime final gates");
    }
  }

  return {
    cwd,
    initialized: fs.existsSync(workspace),
    workspace,
    currentRunId,
    currentRunStatus,
    currentRunExecutionMode,
    currentRunBranch,
    currentRunGates,
    currentRunConsistency,
    currentRunDispatch,
    currentRunHandoffFiles,
    currentRunProviderReceipts,
    currentRunProviderObservations,
    currentRunAgentNameMap,
    currentRunTrueHarnessFreshness,
    currentRunQualityLineage,
    currentRunStandardEvidence,
    currentRunRuntimeRequirements,
    currentRunSandboxVerification,
    currentRunHarnessComponents,
    currentRunRecentBlockerTrace,
    currentRunHarnessDebugger,
    currentRunNextOwner,
    currentRunActions,
    currentRunBlockers,
    currentRunLatestCheckpoint,
    currentRunDemoWarnings,
    currentRunAgentProgress,
    runs,
    reports
  };
}

export function readReport(cwd: string, runId: string): ReportResult {
  const file = path.join(cwd, ".imfine", "reports", `${runId}.md`);
  if (!fs.existsSync(file)) {
    return { runId, file, exists: false };
  }
  return {
    runId,
    file,
    exists: true,
    content: fs.readFileSync(file, "utf8")
  };
}
