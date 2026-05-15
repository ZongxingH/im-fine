import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateAgentHandoff } from "./handoff-evidence.js";
import { providerReceipts, readProviderCapabilitySnapshot, writeProviderCapabilitySnapshot } from "./provider-evidence.js";
import { skillEvidenceRequirements } from "./skill-registry.js";

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
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
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
  const handoffs = collectHandoffs(runDirPath, cwd);
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
      role: typeof contract.role === "string" ? contract.role : "",
      taskId: typeof contract.task_id === "string" ? contract.task_id : undefined
    })).filter((contract) => contract.id && contract.role)
    : [];
  const handoffValidations = contractTargets.map((contract) => validateAgentHandoff(contract, runDirPath, runId));
  const allContractHandoffsPassed = hasDispatchContract
    && handoffValidations.length === contractTargets.length
    && handoffValidations.every((item) => item.passed);
  const completedWaveActionIds = new Set(waves
    .filter((wave) => wave.status === "completed")
    .flatMap((wave) => wave.action_ids));
  const archiveStatus = optionalJson<{ status?: string }>(path.join(runDirPath, "agents", "archive", "status.json"))?.status;
  const archiveReadyForCompletion = archiveStatus === "completed";
  const waveRequiredContracts = archiveReadyForCompletion
    ? contractTargets
    : contractTargets.filter((contract) => contract.role !== "archive");
  const missingCompletedWaveContracts = waveRequiredContracts
    .filter((contract) => {
      const actionIds = [
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
  const receiptActionIds = new Set(receipts.filter((receipt) => receipt.status === "completed").map((receipt) => receipt.action_id));
  const missingProviderReceiptContracts = contractTargets
    .filter((contract) => {
      const actionIds = [
        contract.id,
        `agent-${contract.id}`,
        `agent-${contract.role}`,
        contract.taskId ? `agent-${contract.role}-${contract.taskId}` : undefined
      ].filter((item): item is string => Boolean(item));
      return !actionIds.some((id) => receiptActionIds.has(id));
    })
    .map((contract) => contract.id);
  const allContractsHaveProviderReceipt = hasDispatchContract && missingProviderReceiptContracts.length === 0;
  const providerCapability = readProviderCapabilitySnapshot(cwd, runId) || writeProviderCapabilitySnapshot(cwd, runId);
  const orchestratorDeclaredTrueHarness = orchestratorSession?.decision_source === "orchestrator_agent"
    && orchestratorSession.execution_mode === "true_harness"
    && orchestratorSession.harness_classification === "true_harness";
  const passed = orchestratorDeclaredTrueHarness
    && hasTrueHarnessAgent
    && hasDispatchContract
    && hasCompletedWave
    && allContractsHaveCompletedWave
    && allContractsHaveProviderReceipt
    && hasHandoffChain
    && allContractHandoffsPassed
    && allSkillEvidencePassed;

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
      entry_installed: providerCapability.entry_installed,
      blocked: providerCapability.blocked
    },
    provider_execution_receipts: {
      receipt_count: receipts.length,
      all_contracts_have_provider_receipt: allContractsHaveProviderReceipt,
      missing_provider_receipt_contracts: missingProviderReceiptContracts,
      receipts: receipts.map((receipt) => ({
        action_id: receipt.action_id,
        agent_id: receipt.agent_id,
        role: receipt.role,
        task_id: receipt.task_id || null,
        status: receipt.status,
        provider_agent_id: receipt.provider_agent_id,
        provider_session_id: receipt.provider_session_id
      }))
    },
    skill_evidence_contracts: {
      passed: allSkillEvidencePassed,
      checks: skillEvidenceChecks
    },
    task_count: graphTaskIds.length,
    parallel_execution: {
      dispatch_contract_count: Array.isArray(dispatchContracts?.contracts) ? dispatchContracts.contracts.length : 0,
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
      required_agent_count: contractTargets.length,
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
    fix_loop_usage: {
      fix_tasks_present: graphTaskIds.some((taskId) => taskId.startsWith("FIX-")),
      replan_used: fs.existsSync(path.join(orchestrationDir, "task-planner-replan.md")) || typeof run.needs_task_replan_at === "string",
      design_rework_used: fs.existsSync(path.join(evidenceDir, "design-rework.md")) || taskStatusValues.includes("implementation_blocked_by_design")
    }
  };

  const jsonFile = path.join(orchestrationDir, "true-harness-evidence.json");
  const markdownFile = path.join(orchestrationDir, "true-harness-evidence.md");
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
- entry installed: ${payload.provider_capability.entry_installed}
- blocked: ${payload.provider_capability.blocked ? "yes" : "no"}

## Provider Execution Receipts

- receipt count: ${payload.provider_execution_receipts.receipt_count}
- all contracts have provider receipt: ${payload.provider_execution_receipts.all_contracts_have_provider_receipt ? "yes" : "no"}
- missing provider receipt contracts: ${payload.provider_execution_receipts.missing_provider_receipt_contracts.length > 0 ? payload.provider_execution_receipts.missing_provider_receipt_contracts.join(", ") : "none"}

## Skill Evidence Contracts

- passed: ${payload.skill_evidence_contracts.passed ? "yes" : "no"}
${payload.skill_evidence_contracts.checks.length > 0 ? payload.skill_evidence_contracts.checks.map((check) => `- ${check.role}${check.task_id ? `/${check.task_id}` : ""}: ${check.passed ? "pass" : `missing ${check.missing_evidence.join(", ")}`}`).join("\n") : "- none"}

## Participating Roles

${payload.participating_roles.length > 0 ? payload.participating_roles.map((role) => `- ${role}`).join("\n") : "- none"}

## Parallel Execution

- wave count: ${payload.parallel_execution.wave_count}
- dispatch contracts: ${payload.parallel_execution.dispatch_contract_count}
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

## Fix Loop Usage

- fix tasks present: ${payload.fix_loop_usage.fix_tasks_present ? "yes" : "no"}
- replan used: ${payload.fix_loop_usage.replan_used ? "yes" : "no"}
- design rework used: ${payload.fix_loop_usage.design_rework_used ? "yes" : "no"}
`);

  return {
    json: jsonFile,
    markdown: markdownFile
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
  const status = missingWaves.length === 0 && invalidHandoffs.length === 0 && missingReceipts.length === 0 && missingStandardEvidence.length === 0;
  const preArchive = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    pre_archive_harness_passed: status,
    source_true_harness_evidence: path.relative(cwd, full.json),
    missing_completed_wave_contracts: missingWaves,
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
- invalid handoffs: ${invalidHandoffs.length}
- missing provider receipt contracts: ${missingReceipts.length > 0 ? missingReceipts.join(", ") : "none"}
- missing standard evidence: ${missingStandardEvidence.length > 0 ? missingStandardEvidence.join(", ") : "none"}
`);
  return { json: file, markdown };
}
