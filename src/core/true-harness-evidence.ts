import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateAgentHandoff } from "./handoff-evidence.js";
import { readQualityLineage, writeQualityLineage } from "./quality-lineage.js";
import { providerObservations } from "./provider-observation.js";
import { providerReceipts, receiptProvesNativeSubagent, resolveProviderCapabilityFromReceipts, validateProviderReceipt } from "./provider-evidence.js";
import { writeRolePurityAudit } from "./role-purity.js";
import { skillEvidenceRequirements } from "./skill-registry.js";
import { appendRuntimeTraceEvent, latestTraceSourceForArtifact } from "./trace-events.js";

interface RunMetadata {
  run_id: string;
  status?: string;
  execution_mode?: string;
  project_kind?: string;
  needs_task_replan_at?: string;
}

interface AgentRunRecord {
  id: string;
  role: string;
  taskId?: string;
  status?: string;
  executionSource?: string;
  executedBy?: string;
  executionStatus?: string;
  workflowState?: string;
  handoffFile?: string;
  skills?: string[];
}

interface DispatchContractRecord {
  id?: string;
  role?: string;
  task_id?: string;
  status?: string;
  kind?: string;
  action_id?: string;
}

interface ParallelPlanWave {
  iteration: number;
  parallel_group: string;
  action_ids: string[];
  task_ids: string[];
  roles: string[];
  status: string;
  reason: string;
  started_at: string;
  completed_at?: string;
}

interface HandoffRecord {
  run_id?: string;
  task_id?: string;
  from?: string;
  to?: string;
  status?: string;
  summary?: string;
  evidence?: string[];
  next_state?: string;
}

interface TaskGraph {
  tasks: Array<{ id: string }>;
}

interface OrchestratorSessionRecord {
  decision_source?: string;
  execution_mode?: string;
  harness_classification?: string;
  status?: string;
}

interface SourceArtifactRecord {
  id: string;
  file: string;
  exists: boolean;
  mtime_ms: number | null;
  sha256: string | null;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function optionalJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return readJson<T>(file);
}

function sourceArtifact(cwd: string, id: string, file: string): SourceArtifactRecord {
  if (!fs.existsSync(file)) {
    return { id, file: rel(cwd, file), exists: false, mtime_ms: null, sha256: null };
  }
  const stat = fs.statSync(file);
  return {
    id,
    file: rel(cwd, file),
    exists: true,
    mtime_ms: stat.mtimeMs,
    sha256: sha256File(file)
  };
}

function sourceArtifacts(cwd: string, runDirPath: string): SourceArtifactRecord[] {
  const orchestration = path.join(runDirPath, "orchestration");
  const files: Array<[string, string]> = [
    ["run", path.join(runDirPath, "run.json")],
    ["orchestrator_session", path.join(orchestration, "orchestrator-session.json")],
    ["agent_runs", path.join(orchestration, "agent-runs.json")],
    ["dispatch_contracts", path.join(orchestration, "dispatch-contracts.json")],
    ["parallel_execution", path.join(orchestration, "parallel-execution.json")],
    ["provider_capability", path.join(orchestration, "provider-capability.json")],
    ["provider_capability_resolution", path.join(orchestration, "provider-capability-resolution.json")],
    ["harness_components", path.join(orchestration, "harness-components.json")],
    ["quality_lineage", path.join(orchestration, "quality-lineage.json")],
    ["method_provenance", path.join(orchestration, "method-provenance.json")],
    ["agent_acceptance_matrix", path.join(orchestration, "agent-acceptance-matrix.json")],
    ["acceptance_matrix", path.join(orchestration, "acceptance-matrix.json")],
    ["runtime_requirements", path.join(orchestration, "runtime-requirements.json")],
    ["sandbox_verification", path.join(orchestration, "sandbox-verification.json")],
    ["role_purity_audit", path.join(orchestration, "role-purity-audit.json")],
    ["final_gates", path.join(orchestration, "final-gates.json")],
    ["qa_evidence", path.join(runDirPath, "evidence", "test-results.md")],
    ["review_evidence", path.join(runDirPath, "evidence", "review.md")],
    ["risk_review_evidence", path.join(runDirPath, "evidence", "risk-review.md")],
    ["commits_evidence", path.join(runDirPath, "evidence", "commits.md")],
    ["push_evidence", path.join(runDirPath, "evidence", "push.md")]
  ];
  const providerReceiptDir = path.join(orchestration, "provider-receipts");
  if (fs.existsSync(providerReceiptDir)) {
    for (const file of fs.readdirSync(providerReceiptDir).filter((item) => item.endsWith(".json")).sort()) {
      files.push([`provider_receipt:${file}`, path.join(providerReceiptDir, file)]);
    }
  }
  const providerOutputDir = path.join(orchestration, "provider-outputs");
  if (fs.existsSync(providerOutputDir)) {
    for (const file of fs.readdirSync(providerOutputDir).filter((item) => item.endsWith(".json")).sort()) {
      files.push([`provider_output:${file}`, path.join(providerOutputDir, file)]);
    }
  }
  const providerObservationDir = path.join(orchestration, "provider-observations");
  if (fs.existsSync(providerObservationDir)) {
    for (const file of fs.readdirSync(providerObservationDir).filter((item) => item.endsWith(".json")).sort()) {
      files.push([`provider_observation:${file}`, path.join(providerObservationDir, file)]);
    }
  }
  const agentsDir = path.join(runDirPath, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const agent of fs.readdirSync(agentsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      files.push([`handoff:${agent}`, path.join(agentsDir, agent, "handoff.json")]);
    }
  }
  return files.map(([id, file]) => sourceArtifact(cwd, id, file));
}

export function staleTrueHarnessEvidence(jsonFile: string): string[] {
  if (!fs.existsSync(jsonFile)) return [`missing ${jsonFile}`];
  const payload = readJson<{ source_artifacts?: SourceArtifactRecord[]; generated_at?: string }>(jsonFile);
  if (!Array.isArray(payload.source_artifacts)) return ["missing source_artifacts"];
  const runDirPath = path.dirname(path.dirname(jsonFile));
  const cwd = path.dirname(path.dirname(path.dirname(runDirPath)));
  const runId = path.basename(runDirPath);
  const withTrace = (source: SourceArtifactRecord, reason: string): string => {
    const traced = latestTraceSourceForArtifact(cwd, runId, source.id, path.resolve(cwd, source.file));
    if (!traced) return `${source.id}: ${reason}`;
    return `${source.id}: ${reason}; trace_source=${traced.source}; component=${traced.componentId}; action=${traced.actionId}; event=${traced.eventId}`;
  };
  const stale: string[] = [];
  const recordedIds = new Set(payload.source_artifacts.map((source) => source.id));
  const currentSources = sourceArtifacts(cwd, runDirPath);
  for (const source of currentSources) {
    if (source.exists && !recordedIds.has(source.id)) {
      stale.push(withTrace(source, "created after evidence generation"));
    }
  }
  for (const source of payload.source_artifacts) {
    const file = path.isAbsolute(source.file) ? source.file : path.resolve(cwd, source.file);
    if (!fs.existsSync(file)) {
      if (source.exists) stale.push(withTrace(source, "missing after evidence generation"));
      continue;
    }
    if (!source.exists) {
      stale.push(withTrace(source, "created after evidence generation"));
      continue;
    }
    const stat = fs.statSync(file);
    const currentHash = sha256File(file);
    if (source.sha256 !== currentHash || (typeof source.mtime_ms === "number" && stat.mtimeMs > source.mtime_ms + 1)) {
      stale.push(withTrace(source, "changed after evidence generation"));
    }
  }
  return stale;
}

function taskStatuses(runDirPath: string): string[] {
  const tasksDir = path.join(runDirPath, "tasks");
  if (!fs.existsSync(tasksDir)) return [];
  return fs.readdirSync(tasksDir)
    .map((taskId) => optionalJson<{ status?: string }>(path.join(tasksDir, taskId, "status.json"))?.status)
    .filter((status): status is string => typeof status === "string");
}

function taskIds(runDirPath: string): string[] {
  const graph = optionalJson<TaskGraph>(path.join(runDirPath, "planning", "task-graph.json"));
  if (!graph) return [];
  return graph.tasks.map((task) => task.id);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replaceAll("**", ":::DOUBLE_STAR:::").replaceAll("*", "[^/]*").replaceAll(":::DOUBLE_STAR:::", ".*");
  return new RegExp(`^${source}$`);
}

function evidenceRequirementSatisfied(cwd: string, runDirPath: string, requirement: string, handoffEvidence: string[]): boolean {
  const normalizedRequirement = requirement.replace(/^\.imfine\/runs\/[^/]+\//, "");
  const direct = path.join(runDirPath, normalizedRequirement);
  if (!requirement.includes("*")) return fs.existsSync(direct);
  const matcher = globToRegExp(normalizedRequirement);
  return handoffEvidence.some((item) => {
    const absolute = path.isAbsolute(item) ? item : path.resolve(cwd, item);
    const cwdRelative = path.relative(cwd, absolute);
    const runRelative = path.relative(runDirPath, absolute);
    return matcher.test(cwdRelative.replace(/^\.imfine\/runs\/[^/]+\//, ""))
      || (!runRelative.startsWith("..") && !path.isAbsolute(runRelative) && matcher.test(runRelative));
  });
}

function collectHandoffs(runDirPath: string, cwd: string): Array<{
  agent_id: string;
  role: string;
  task_id?: string;
  status: string;
  summary: string;
  evidence: string[];
  file: string;
}> {
  const agentsDir = path.join(runDirPath, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  const entries = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const handoffs: Array<{
    agent_id: string;
    role: string;
    task_id?: string;
    status: string;
    summary: string;
    evidence: string[];
    file: string;
  }> = [];

  for (const entry of entries) {
    const file = path.join(agentsDir, entry.name, "handoff.json");
    if (!fs.existsSync(file)) continue;
    const handoff = readJson<HandoffRecord>(file);
    if (typeof handoff.from !== "string") continue;
    handoffs.push({
      agent_id: entry.name,
      role: handoff.from,
      task_id: handoff.task_id,
      status: handoff.status || "unknown",
      summary: handoff.summary || "",
      evidence: Array.isArray(handoff.evidence)
        ? handoff.evidence.filter((item): item is string => typeof item === "string").map((item) => rel(cwd, item))
        : [],
      file: rel(cwd, file)
    });
  }

  return handoffs;
}

export interface TrueHarnessEvidenceFiles {
  json: string;
  markdown: string;
  methodProvenance: string;
}

export interface TrueHarnessConsistencyResult {
  passed: boolean;
  errors: string[];
}

function markdownBoolean(markdown: string, label: string): boolean | null {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(yes|no|true|false)`, "i");
  const match = markdown.match(pattern);
  if (!match) return null;
  return match[1].toLowerCase() === "yes" || match[1].toLowerCase() === "true";
}

export function validateTrueHarnessEvidenceFiles(jsonFile: string, markdownFile: string): TrueHarnessConsistencyResult {
  const errors: string[] = [];
  if (!fs.existsSync(jsonFile)) errors.push(`missing ${jsonFile}`);
  if (!fs.existsSync(markdownFile)) errors.push(`missing ${markdownFile}`);
  if (errors.length > 0) return { passed: false, errors };
  const json = readJson<{
    true_harness_passed?: unknown;
    provider_capability?: { blocked?: unknown };
    provider_execution_receipts?: { receipt_count?: unknown; valid_receipt_count?: unknown };
    parallel_execution?: { wave_count?: unknown; dispatch_contract_count?: unknown };
    handoff_validation?: { passed?: unknown };
  }>(jsonFile);
  const markdown = fs.readFileSync(markdownFile, "utf8");
  const mdPassed = markdownBoolean(markdown, "true harness passed");
  const mdProviderBlocked = markdownBoolean(markdown, "blocked");
  const jsonPassed = Boolean(json.true_harness_passed);
  const jsonProviderBlocked = Boolean(json.provider_capability?.blocked);
  if (mdPassed === null) errors.push("markdown missing true harness passed");
  else if (mdPassed !== jsonPassed) errors.push(`true_harness_passed mismatch: json=${jsonPassed} markdown=${mdPassed}`);
  if (mdProviderBlocked === null) errors.push("markdown missing provider blocked");
  else if (mdProviderBlocked !== jsonProviderBlocked) errors.push(`provider blocked mismatch: json=${jsonProviderBlocked} markdown=${mdProviderBlocked}`);

  const receiptCount = Number(json.provider_execution_receipts?.receipt_count || 0);
  const validReceiptCount = Number(json.provider_execution_receipts?.valid_receipt_count || 0);
  const waveCount = Number(json.parallel_execution?.wave_count || 0);
  const dispatchCount = Number(json.parallel_execution?.dispatch_contract_count || 0);
  if (jsonPassed && (receiptCount === 0 || validReceiptCount === 0)) errors.push("true harness passed without valid provider receipts");
  if (jsonPassed && (waveCount === 0 || dispatchCount === 0)) errors.push("true harness passed without dispatch contracts or wave history");
  if (jsonPassed && json.handoff_validation?.passed !== true) errors.push("true harness passed without handoff validation");
  const stale = staleTrueHarnessEvidence(jsonFile);
  if (stale.length > 0) errors.push(`true harness evidence stale: ${stale.join("; ")}`);
  return { passed: errors.length === 0, errors };
}

export function writeTrueHarnessEvidence(cwd: string, runId: string): TrueHarnessEvidenceFiles {
  const runDirPath = runDir(cwd, runId);
  const orchestrationDir = path.join(runDirPath, "orchestration");
  const evidenceDir = path.join(runDirPath, "evidence");
  ensureDir(orchestrationDir);
  ensureDir(evidenceDir);

  const run = readJson<RunMetadata>(path.join(runDirPath, "run.json"));
  const agentRuns = optionalJson<{ agents?: AgentRunRecord[] }>(path.join(orchestrationDir, "agent-runs.json"));
  const parallelExecution = optionalJson<{
    wave_history?: ParallelPlanWave[];
    executed_parallel_groups?: string[];
    blocked_parallel_groups?: string[];
  }>(path.join(orchestrationDir, "parallel-execution.json"));
  const dispatchContracts = optionalJson<{ contracts?: DispatchContractRecord[] }>(path.join(orchestrationDir, "dispatch-contracts.json"));
  const orchestratorSessionFile = path.join(orchestrationDir, "orchestrator-session.json");
  const orchestratorSession = optionalJson<OrchestratorSessionRecord>(orchestratorSessionFile);
  const observations = providerObservations(cwd, runDirPath);
  const agentNameMapFile = path.join(orchestrationDir, "agent-name-map.json");
  const agentNameMap = optionalJson<{ mappings?: unknown[] }>(agentNameMapFile);
  const handoffs = collectHandoffs(runDirPath, cwd);
  const qualityLineageFile = writeQualityLineage(cwd, runId);
  const qualityLineage = readQualityLineage(cwd, runId);
  const rolePurityFile = writeRolePurityAudit(cwd, runId);
  const rolePurity = readJson<{
    status?: string;
    orchestrator_role_purity?: string;
    spawned_agents?: boolean;
    provider_receipts_closed?: boolean;
    required_handoffs_present?: boolean;
    qa_reviewer_archive_gates_closed?: boolean;
    deviations_closed?: boolean;
    rework_dispatch_closed?: boolean;
    agent_close_safe?: boolean;
    violations?: unknown[];
  }>(rolePurityFile);
  const handoffEvidenceFiles = handoffs.flatMap((handoff) => handoff.evidence);
  const taskStatusValues = taskStatuses(runDirPath);
  const graphTaskIds = taskIds(runDirPath);
  const participatingRoles = Array.from(new Set([
    ...(Array.isArray(agentRuns?.agents) ? agentRuns.agents.filter((agent) => agent.status === "completed" || agent.executionStatus === "completed").map((agent) => agent.role) : []),
    ...handoffs.map((handoff) => handoff.role)
  ])).sort();
  const waves = Array.isArray(parallelExecution?.wave_history) ? parallelExecution.wave_history : [];
  const agentRecords = Array.isArray(agentRuns?.agents) ? agentRuns.agents : [];
  const hasTrueHarnessAgent = agentRecords.some((agent) => agent.executionSource === "true_harness");
  const skillEvidenceChecks = agentRecords.map((agent) => {
    const skills = Array.isArray(agent.skills) ? agent.skills.filter((skill): skill is string => typeof skill === "string") : [];
    const requiredEvidence = skillEvidenceRequirements(skills);
    const missing = requiredEvidence.filter((requirement) => !evidenceRequirementSatisfied(cwd, runDirPath, requirement, handoffEvidenceFiles));
    return {
      agent_id: agent.id,
      role: agent.role,
      task_id: agent.taskId || null,
      skills,
      required_evidence: requiredEvidence,
      missing_evidence: missing,
      passed: missing.length === 0
    };
  });
  const allSkillEvidencePassed = skillEvidenceChecks.every((check) => check.passed);
  const hasDispatchContract = Array.isArray(dispatchContracts?.contracts) && dispatchContracts.contracts.length > 0;
  const hasCompletedWave = waves.some((wave) => wave.status === "completed");
  const hasHandoffChain = handoffs.length > 0;
  const contractTargets = Array.isArray(dispatchContracts?.contracts)
    ? dispatchContracts.contracts.map((contract) => ({
      id: typeof contract.id === "string" ? contract.id : "",
      actionId: typeof contract.action_id === "string" ? contract.action_id : typeof contract.id === "string" ? contract.id : "",
      role: typeof contract.role === "string" ? contract.role : "",
      taskId: typeof contract.task_id === "string" ? contract.task_id : undefined,
      kind: contract.kind === "runtime" ? "runtime" : "agent"
    })).filter((contract) => contract.id && contract.role)
    : [];
  const agentContractTargets = contractTargets.filter((contract) => contract.kind === "agent");
  const runtimeContractTargets = contractTargets.filter((contract) => contract.kind === "runtime");
  const actionLedger = optionalJson<{ actions?: Record<string, { status?: string }> }>(path.join(orchestrationDir, "action-ledger.json"));
  const runtimeContractsWithoutLedger = runtimeContractTargets
    .filter((contract) => actionLedger?.actions?.[contract.actionId]?.status !== "completed")
    .map((contract) => contract.actionId);
  const allRuntimeContractsCompleted = runtimeContractsWithoutLedger.length === 0;
  const handoffValidations = agentContractTargets.map((contract) => validateAgentHandoff(contract, runDirPath, runId));
  const allContractHandoffsPassed = hasDispatchContract
    && handoffValidations.length === agentContractTargets.length
    && handoffValidations.every((item) => item.passed);
  const completedWaveActionIds = new Set(waves
    .filter((wave) => wave.status === "completed")
    .flatMap((wave) => wave.action_ids));
  const archiveStatus = optionalJson<{ status?: string }>(path.join(runDirPath, "agents", "archive", "status.json"))?.status;
  const archiveReadyForCompletion = archiveStatus === "completed";
  const waveRequiredContracts = archiveReadyForCompletion
    ? agentContractTargets
    : agentContractTargets.filter((contract) => contract.role !== "archive");
  const missingCompletedWaveContracts = waveRequiredContracts
    .filter((contract) => {
      const actionIds = [
        contract.actionId,
        contract.id,
        `agent-${contract.id}`,
        `agent-${contract.role}`,
        contract.taskId ? `agent-${contract.role}-${contract.taskId}` : undefined
      ].filter((item): item is string => Boolean(item));
      return !actionIds.some((id) => completedWaveActionIds.has(id));
    })
    .map((contract) => contract.id);
  const allContractsHaveCompletedWave = hasDispatchContract && missingCompletedWaveContracts.length === 0;
  const receipts = providerReceipts(cwd, runId);
  const receiptValidations = receipts.map((receipt) => validateProviderReceipt(cwd, receipt));
  const validationByAction = new Map(receiptValidations.map((validation) => [validation.action_id, validation]));
  const validReceipts = receipts.filter((receipt) => validationByAction.get(receipt.action_id)?.valid === true);
  const receiptActionIds = new Set(validReceipts.map((receipt) => receipt.action_id));
  const missingProviderReceiptContracts = agentContractTargets
    .filter((contract) => {
      const actionIds = [
        contract.actionId,
        contract.id,
        `agent-${contract.id}`,
        `agent-${contract.role}`,
        contract.taskId ? `agent-${contract.role}-${contract.taskId}` : undefined
      ].filter((item): item is string => Boolean(item));
      return !actionIds.some((id) => receiptActionIds.has(id));
    })
    .map((contract) => contract.id);
  const allContractsHaveProviderReceipt = hasDispatchContract && missingProviderReceiptContracts.length === 0;
  const providerCapability = resolveProviderCapabilityFromReceipts(cwd, runId);
  const orchestratorDeclaredTrueHarness = orchestratorSession?.decision_source === "orchestrator_agent"
    && orchestratorSession.execution_mode === "true_harness"
    && orchestratorSession.harness_classification === "true_harness";
  const passed = orchestratorDeclaredTrueHarness
    && hasTrueHarnessAgent
    && hasDispatchContract
    && providerCapability.blocked === false
    && providerCapability.subagent_supported === "supported"
    && hasCompletedWave
    && allContractsHaveCompletedWave
    && allContractsHaveProviderReceipt
    && allRuntimeContractsCompleted
    && hasHandoffChain
    && allContractHandoffsPassed
    && allSkillEvidencePassed
    && rolePurity.status === "pass";

  const payload = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    target_goal: "依赖大模型能力，通过多角色多 agent + skill 并行执行，实现 harness 工程",
    harness_classification: "true_harness",
    true_harness_passed: passed,
    orchestrator_declaration: {
      passed: orchestratorDeclaredTrueHarness,
      decision_source: orchestratorSession?.decision_source || "missing",
      execution_mode: orchestratorSession?.execution_mode || "missing",
      harness_classification: orchestratorSession?.harness_classification || "missing",
      session_file: fs.existsSync(orchestratorSessionFile) ? rel(cwd, orchestratorSessionFile) : null
    },
    run: {
      status: run.status || "unknown",
      execution_mode: run.execution_mode || "unknown",
      project_kind: run.project_kind || "unknown"
    },
    participating_roles: participatingRoles,
    provider_capability: {
      provider: providerCapability.provider,
      subagent_supported: providerCapability.subagent_supported,
      capabilities: providerCapability.capabilities,
      entry_installed: providerCapability.entry_installed,
      blocked: providerCapability.blocked,
      detection_source: providerCapability.detection_source,
      resolved_by_receipts: providerCapability.resolved_by_receipts === true,
      resolved_receipt_count: providerCapability.resolved_receipt_count || 0
    },
    provider_execution_receipts: {
      receipt_count: receipts.length,
      valid_receipt_count: validReceipts.length,
      all_contracts_have_provider_receipt: allContractsHaveProviderReceipt,
      missing_provider_receipt_contracts: missingProviderReceiptContracts,
      receipts: receipts.map((receipt) => ({
        action_id: receipt.action_id,
        agent_id: receipt.agent_id,
        role: receipt.role,
        task_id: receipt.task_id || null,
        status: receipt.status,
        valid_native_subagent_proof: receiptProvesNativeSubagent(cwd, receipt),
        provider_agent_id: receipt.provider_agent_id,
        provider_session_id: receipt.provider_session_id,
        provider_trace_id: receipt.provider_trace_id || null,
        provider_task_handle: receipt.provider_task_handle || null,
        origin: receipt.origin || "missing",
        receipt_type: receipt.receipt_type || "missing",
        output_path: receipt.output_path || null,
        integrity_output_sha256: receipt.integrity?.output_sha256 || null,
        invalid_reasons: validationByAction.get(receipt.action_id)?.reasons || []
      }))
    },
    role_purity: {
      file: rel(cwd, rolePurityFile),
      status: rolePurity.status || "blocked",
      spawned_agents: rolePurity.spawned_agents === true,
      provider_receipts_closed: rolePurity.provider_receipts_closed === true,
      required_handoffs_present: rolePurity.required_handoffs_present === true,
      orchestrator_role_purity: rolePurity.orchestrator_role_purity || "fail",
      qa_reviewer_archive_gates_closed: rolePurity.qa_reviewer_archive_gates_closed === true,
      deviations_closed: rolePurity.deviations_closed === true,
      rework_dispatch_closed: rolePurity.rework_dispatch_closed === true,
      agent_close_safe: rolePurity.agent_close_safe === true,
      violation_count: Array.isArray(rolePurity.violations) ? rolePurity.violations.length : 0,
      violations: Array.isArray(rolePurity.violations) ? rolePurity.violations : []
    },
    provider_observations: {
      present: observations.length > 0,
      observed_native_agents: observations.flatMap((item) => item.observed_agent_names),
      observation_count: observations.length,
      observations,
      proof_boundary: "diagnostic_only_not_true_harness_proof"
    },
    agent_name_map: {
      present: fs.existsSync(agentNameMapFile),
      file: fs.existsSync(agentNameMapFile) ? rel(cwd, agentNameMapFile) : null,
      mappings: Array.isArray(agentNameMap?.mappings) ? agentNameMap.mappings : []
    },
    skill_evidence_contracts: {
      passed: allSkillEvidencePassed,
      checks: skillEvidenceChecks
    },
    task_count: graphTaskIds.length,
    parallel_execution: {
      dispatch_contract_count: Array.isArray(dispatchContracts?.contracts) ? dispatchContracts.contracts.length : 0,
      agent_dispatch_contract_count: agentContractTargets.length,
      runtime_dispatch_contract_count: runtimeContractTargets.length,
      all_runtime_contracts_completed: allRuntimeContractsCompleted,
      missing_runtime_action_ledger_contracts: runtimeContractsWithoutLedger,
      executed_parallel_groups: Array.isArray(parallelExecution?.executed_parallel_groups) ? parallelExecution.executed_parallel_groups : [],
      blocked_parallel_groups: Array.isArray(parallelExecution?.blocked_parallel_groups) ? parallelExecution.blocked_parallel_groups : [],
      wave_count: waves.length,
      all_contracts_have_completed_wave: allContractsHaveCompletedWave,
      missing_completed_wave_contracts: missingCompletedWaveContracts,
      waves: waves.map((wave) => ({
        iteration: wave.iteration,
        parallel_group: wave.parallel_group,
        agent_count: wave.action_ids.length,
        roles: wave.roles,
        task_ids: wave.task_ids,
        status: wave.status,
        started_at: wave.started_at,
        completed_at: wave.completed_at || null
      }))
    },
    handoff_validation: {
      passed: allContractHandoffsPassed,
      required_agent_count: agentContractTargets.length,
      valid_agent_count: handoffValidations.filter((item) => item.passed).length,
      invalid: handoffValidations
        .filter((item) => !item.passed)
        .map((item) => ({
          agent_id: item.agentId,
          role: item.role,
          task_id: item.taskId || null,
          handoff_file: item.file,
          errors: item.errors
        }))
    },
    handoff_evidence_chain: handoffs.map((handoff) => ({
      agent_id: handoff.agent_id,
      role: handoff.role,
      task_id: handoff.task_id || null,
      status: handoff.status,
      summary: handoff.summary,
      handoff_file: handoff.file,
      evidence: handoff.evidence
    })),
    quality_lineage: {
      file: rel(cwd, qualityLineageFile),
      summary: qualityLineage?.summary || { qa: "blocked", review: "blocked", recheck_fix_loop: "blocked" },
      lineages: qualityLineage?.lineages || []
    },
    fix_loop_usage: {
      fix_tasks_present: graphTaskIds.some((taskId) => taskId.startsWith("FIX-")),
      replan_used: fs.existsSync(path.join(orchestrationDir, "task-planner-replan.md")) || typeof run.needs_task_replan_at === "string",
      design_rework_used: fs.existsSync(path.join(evidenceDir, "design-rework.md")) || taskStatusValues.includes("implementation_blocked_by_design")
    },
    source_artifacts: [] as SourceArtifactRecord[]
  };

  const jsonFile = path.join(orchestrationDir, "true-harness-evidence.json");
  const markdownFile = path.join(orchestrationDir, "true-harness-evidence.md");
  const methodProvenanceFile = path.join(orchestrationDir, "method-provenance.json");
  writeText(methodProvenanceFile, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: payload.generated_at,
    sources: {
      openspec_inspired: [
        { artifact: "request", evidence: "request/" },
        { artifact: "analysis", evidence: "analysis/" },
        { artifact: "spec-delta", evidence: "spec-delta/" },
        { artifact: "archive", evidence: "archive/" },
        { artifact: "capabilities", evidence: ".imfine/project/capabilities/" }
      ],
      superpowers_inspired_skills: [
        "clarify",
        "project-analysis",
        "write-delivery-plan",
        "execute-task-plan",
        "tdd",
        "systematic-debugging",
        "parallel-agent-dispatch",
        "code-review",
        "archive-confirmation"
      ],
      bmad_inspired_roles: payload.participating_roles,
      imfine_specific_contracts: [
        { contract: "true-harness", evidence: rel(cwd, jsonFile) },
        { contract: "provider-receipts", evidence: "orchestration/provider-receipts/" },
        { contract: "dispatch-contracts", evidence: "orchestration/dispatch-contracts.json" },
        { contract: "handoff-validation", evidence: "agents/*/handoff.json" }
      ]
    },
    skill_evidence_contracts: payload.skill_evidence_contracts
  }, null, 2)}\n`);
  payload.source_artifacts = sourceArtifacts(cwd, runDirPath);
  writeText(jsonFile, `${JSON.stringify(payload, null, 2)}\n`);
  writeText(markdownFile, `# True Harness Evidence

## Goal

- ${payload.target_goal}

## Assessment

- harness classification: ${payload.harness_classification}
- true harness passed: ${payload.true_harness_passed ? "yes" : "no"}

## Orchestrator Declaration

- passed: ${payload.orchestrator_declaration.passed ? "yes" : "no"}
- decision source: ${payload.orchestrator_declaration.decision_source}
- execution mode: ${payload.orchestrator_declaration.execution_mode}
- harness classification: ${payload.orchestrator_declaration.harness_classification}
- session file: ${payload.orchestrator_declaration.session_file || "none"}

## Run

- status: ${payload.run.status}
- execution mode: ${payload.run.execution_mode}
- project kind: ${payload.run.project_kind}

## Provider Capability

- provider: ${payload.provider_capability.provider}
- subagent supported: ${payload.provider_capability.subagent_supported}
- capabilities: ${JSON.stringify(payload.provider_capability.capabilities)}
- entry installed: ${payload.provider_capability.entry_installed}
- blocked: ${payload.provider_capability.blocked ? "yes" : "no"}
- detection source: ${payload.provider_capability.detection_source}
- resolved by receipts: ${payload.provider_capability.resolved_by_receipts ? "yes" : "no"}
- resolved receipt count: ${payload.provider_capability.resolved_receipt_count}

## Provider Execution Receipts

- receipt count: ${payload.provider_execution_receipts.receipt_count}
- valid receipt count: ${payload.provider_execution_receipts.valid_receipt_count}
- all contracts have provider receipt: ${payload.provider_execution_receipts.all_contracts_have_provider_receipt ? "yes" : "no"}
- missing provider receipt contracts: ${payload.provider_execution_receipts.missing_provider_receipt_contracts.length > 0 ? payload.provider_execution_receipts.missing_provider_receipt_contracts.join(", ") : "none"}
- observed native agents: ${payload.provider_observations.observed_native_agents.length > 0 ? payload.provider_observations.observed_native_agents.join(", ") : "none"}
- verified native agent receipts: ${payload.provider_execution_receipts.valid_receipt_count}
- provider observations boundary: ${payload.provider_observations.proof_boundary}

## Role Purity

- file: ${payload.role_purity.file}
- status: ${payload.role_purity.status}
- spawned agents: ${payload.role_purity.spawned_agents ? "yes" : "no"}
- provider receipts closed: ${payload.role_purity.provider_receipts_closed ? "yes" : "no"}
- required handoffs present: ${payload.role_purity.required_handoffs_present ? "yes" : "no"}
- orchestrator role purity: ${payload.role_purity.orchestrator_role_purity}
- QA/Reviewer/Archive gates closed: ${payload.role_purity.qa_reviewer_archive_gates_closed ? "yes" : "no"}
- deviations closed: ${payload.role_purity.deviations_closed ? "yes" : "no"}
- rework dispatch closed: ${payload.role_purity.rework_dispatch_closed ? "yes" : "no"}
- agent close safe: ${payload.role_purity.agent_close_safe ? "yes" : "no"}
- violation count: ${payload.role_purity.violation_count}

## Skill Evidence Contracts

- passed: ${payload.skill_evidence_contracts.passed ? "yes" : "no"}
${payload.skill_evidence_contracts.checks.length > 0 ? payload.skill_evidence_contracts.checks.map((check) => `- ${check.role}${check.task_id ? `/${check.task_id}` : ""}: ${check.passed ? "pass" : `missing ${check.missing_evidence.join(", ")}`}`).join("\n") : "- none"}

## Participating Roles

${payload.participating_roles.length > 0 ? payload.participating_roles.map((role) => `- ${role}`).join("\n") : "- none"}

## Parallel Execution

- wave count: ${payload.parallel_execution.wave_count}
- dispatch contracts: ${payload.parallel_execution.dispatch_contract_count}
- agent dispatch contracts: ${payload.parallel_execution.agent_dispatch_contract_count}
- runtime dispatch contracts: ${payload.parallel_execution.runtime_dispatch_contract_count}
- all runtime contracts completed: ${payload.parallel_execution.all_runtime_contracts_completed ? "yes" : "no"}
- missing runtime action ledger contracts: ${payload.parallel_execution.missing_runtime_action_ledger_contracts.length > 0 ? payload.parallel_execution.missing_runtime_action_ledger_contracts.join(", ") : "none"}
- executed parallel groups: ${payload.parallel_execution.executed_parallel_groups.length}
- blocked parallel groups: ${payload.parallel_execution.blocked_parallel_groups.length}
- all contracts have completed wave: ${payload.parallel_execution.all_contracts_have_completed_wave ? "yes" : "no"}
- missing completed wave contracts: ${payload.parallel_execution.missing_completed_wave_contracts.length > 0 ? payload.parallel_execution.missing_completed_wave_contracts.join(", ") : "none"}

${payload.parallel_execution.waves.length > 0 ? payload.parallel_execution.waves.map((wave) => `- iteration ${wave.iteration} / ${wave.parallel_group}: ${wave.agent_count} agent(s), status=${wave.status}, roles=${wave.roles.join(", ") || "none"}`).join("\n") : "- no wave history"}

## Handoff Validation

- passed: ${payload.handoff_validation.passed ? "yes" : "no"}
- required agent count: ${payload.handoff_validation.required_agent_count}
- valid agent count: ${payload.handoff_validation.valid_agent_count}

${payload.handoff_validation.invalid.length > 0 ? payload.handoff_validation.invalid.map((item) => `- invalid ${item.agent_id}: ${item.errors.join("; ")}`).join("\n") : "- invalid: none"}

## Handoff Evidence Chain

${payload.handoff_evidence_chain.length > 0 ? payload.handoff_evidence_chain.map((handoff) => `- ${handoff.role}${handoff.task_id ? `/${handoff.task_id}` : ""}: ${handoff.status} -> ${handoff.handoff_file}`).join("\n") : "- none"}

## Quality Lineage

- file: ${payload.quality_lineage.file}
- QA gate: ${payload.quality_lineage.summary.qa}
- Review gate: ${payload.quality_lineage.summary.review}
- Recheck fix loop: ${payload.quality_lineage.summary.recheck_fix_loop}

## Fix Loop Usage

- fix tasks present: ${payload.fix_loop_usage.fix_tasks_present ? "yes" : "no"}
- replan used: ${payload.fix_loop_usage.replan_used ? "yes" : "no"}
- design rework used: ${payload.fix_loop_usage.design_rework_used ? "yes" : "no"}
`);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.true-harness-evidence",
    componentId: "runtime.true-harness-evidence",
    actionId: "runtime.write_true_harness_evidence",
    eventType: "artifact_written",
    status: payload.true_harness_passed ? "pass" : "blocked",
    reason: payload.true_harness_passed ? "true harness evidence passed" : "true harness evidence blocked",
    inputArtifacts: payload.source_artifacts.map((source) => source.file),
    outputArtifacts: [jsonFile, markdownFile, methodProvenanceFile]
  });

  return {
    json: jsonFile,
    markdown: markdownFile,
    methodProvenance: methodProvenanceFile
  };
}

export function writePreArchiveHarnessEvidence(cwd: string, runId: string): TrueHarnessEvidenceFiles {
  const runDirPath = runDir(cwd, runId);
  const evidenceDir = path.join(runDirPath, "orchestration");
  ensureDir(evidenceDir);
  const full = writeTrueHarnessEvidence(cwd, runId);
  const payload = readJson<Record<string, unknown>>(full.json);
  const parallel = payload.parallel_execution as { missing_completed_wave_contracts?: unknown } | undefined;
  const handoff = payload.handoff_validation as { invalid?: unknown[] } | undefined;
  const provider = payload.provider_execution_receipts as { missing_provider_receipt_contracts?: unknown[] } | undefined;
  const runtimeMissing = Array.isArray((parallel as { missing_runtime_action_ledger_contracts?: unknown[] } | undefined)?.missing_runtime_action_ledger_contracts)
    ? (parallel as { missing_runtime_action_ledger_contracts: unknown[] }).missing_runtime_action_ledger_contracts.filter((item) => item !== "runtime-archive-finalize")
    : [];
  const missingWaves = Array.isArray(parallel?.missing_completed_wave_contracts)
    ? parallel.missing_completed_wave_contracts.filter((item) => item !== "archive")
    : [];
  const invalidHandoffs = Array.isArray(handoff?.invalid)
    ? handoff.invalid.filter((item) => !(item && typeof item === "object" && (item as { role?: unknown }).role === "archive"))
    : [];
  const missingReceipts = Array.isArray(provider?.missing_provider_receipt_contracts)
    ? provider.missing_provider_receipt_contracts.filter((item) => item !== "archive")
    : [];
  const qaEvidence = path.join(runDirPath, "evidence", "test-results.md");
  const reviewEvidence = path.join(runDirPath, "evidence", "review.md");
  const commitsEvidence = path.join(runDirPath, "evidence", "commits.md");
  const pushEvidence = path.join(runDirPath, "evidence", "push.md");
  const committerHandoff = path.join(runDirPath, "agents", "committer", "handoff.json");
  const missingStandardEvidence = [
    qaEvidence,
    reviewEvidence,
    commitsEvidence,
    pushEvidence,
    committerHandoff
  ].filter((file) => !fs.existsSync(file)).map((file) => path.relative(cwd, file));
  const file = path.join(evidenceDir, "pre-archive-harness-evidence.json");
  const markdown = path.join(evidenceDir, "pre-archive-harness-evidence.md");
  const status = runtimeMissing.length === 0 && missingWaves.length === 0 && invalidHandoffs.length === 0 && missingReceipts.length === 0 && missingStandardEvidence.length === 0;
  const preArchive = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    pre_archive_harness_passed: status,
    source_true_harness_evidence: path.relative(cwd, full.json),
    missing_completed_wave_contracts: missingWaves,
    missing_runtime_action_ledger_contracts: runtimeMissing,
    invalid_handoffs: invalidHandoffs,
    missing_provider_receipt_contracts: missingReceipts,
    missing_standard_evidence: missingStandardEvidence
  };
  writeText(file, `${JSON.stringify(preArchive, null, 2)}\n`);
  writeText(markdown, `# Pre Archive Harness Evidence

- run: ${runId}
- passed: ${status ? "yes" : "no"}
- source: ${path.relative(cwd, full.json)}
- missing completed wave contracts: ${missingWaves.length > 0 ? missingWaves.join(", ") : "none"}
- missing runtime action ledger contracts: ${runtimeMissing.length > 0 ? runtimeMissing.join(", ") : "none"}
- invalid handoffs: ${invalidHandoffs.length}
- missing provider receipt contracts: ${missingReceipts.length > 0 ? missingReceipts.join(", ") : "none"}
- missing standard evidence: ${missingStandardEvidence.length > 0 ? missingStandardEvidence.join(", ") : "none"}
`);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.true-harness-evidence",
    componentId: "runtime.true-harness-evidence",
    actionId: "runtime.write_pre_archive_harness_evidence",
    eventType: "artifact_written",
    status: status ? "pass" : "blocked",
    reason: status ? "pre-archive harness evidence passed" : "pre-archive harness evidence blocked",
    inputArtifacts: [full.json],
    outputArtifacts: [file, markdown]
  });
  return { json: file, markdown, methodProvenance: full.methodProvenance };
}
