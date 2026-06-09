import fs from "node:fs";
import path from "node:path";
import { buildDispatchContracts, type DispatchContract } from "./dispatch.js";
import { ensureDir, writeText } from "./fs.js";
import { providerReceipts, receiptProvesNativeSubagent } from "./provider-evidence.js";
import { normalizeRuntimeRole } from "./role-registry.js";

export interface RolePurityViolation {
  id: string;
  severity: "P0" | "P1";
  file?: string;
  action_id?: string;
  role?: string;
  reason: string;
  expected: string;
  observed: string;
  solution: string;
}

export interface RolePurityAudit {
  schema_version: 1;
  run_id: string;
  generated_at: string;
  status: "pass" | "blocked";
  orchestrator_role_purity: "pass" | "fail";
  spawned_agents: boolean;
  provider_receipts_closed: boolean;
  required_handoffs_present: boolean;
  qa_reviewer_archive_gates_closed: boolean;
  deviations_closed: boolean;
  rework_dispatch_closed: boolean;
  agent_close_safe: boolean;
  violations: RolePurityViolation[];
}

interface AuthorshipRecord {
  file?: string;
  path?: string;
  author_role?: string;
  role?: string;
  action_id?: string;
  provider_receipt_action_id?: string;
  source?: string;
}

interface HandoffRecord {
  role?: string;
  from?: string;
  status?: string;
  findings?: unknown[];
  failures?: unknown[];
}

interface QualityLineageRecord {
  summary?: {
    qa?: string;
    review?: string;
    recheck_fix_loop?: string;
  };
}

interface AcceptanceMatrixRecord {
  summary?: {
    blocked?: number;
  };
  items?: Array<{
    id?: string;
    status?: string;
    classification?: string;
    requirement_level?: string;
    accepted_by_review?: boolean;
    deviation?: unknown;
  }>;
}

function acceptanceMatrix(runDirPath: string): AcceptanceMatrixRecord | null {
  const sources = [
    path.join(runDirPath, "orchestration", "acceptance-matrix.json"),
    path.join(runDirPath, "orchestration", "agent-acceptance-matrix.json"),
    path.join(runDirPath, "agents", "product-planner", "acceptance-matrix.json"),
    path.join(runDirPath, "agents", "architect", "acceptance-matrix.json"),
    path.join(runDirPath, "agents", "qa", "acceptance-matrix.json"),
    path.join(runDirPath, "agents", "reviewer", "acceptance-matrix.json")
  ];
  const items: NonNullable<AcceptanceMatrixRecord["items"]> = [];
  let blocked = 0;
  let found = false;
  for (const file of sources) {
    const parsed = optionalJson<AcceptanceMatrixRecord>(file);
    if (!parsed) continue;
    found = true;
    if (Array.isArray(parsed.items)) items.push(...parsed.items);
    if (typeof parsed.summary?.blocked === "number") blocked += parsed.summary.blocked;
  }
  if (!found) return null;
  blocked += items.filter((item) => item.status === "blocked").length;
  return {
    summary: { blocked },
    items
  };
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function optionalJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return readJson<T>(file);
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function normalizeRel(cwd: string, runDirPath: string, file: string): string {
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const cwdRelative = rel(cwd, absolute);
  const runRelative = path.relative(runDirPath, absolute);
  if (!runRelative.startsWith("..") && !path.isAbsolute(runRelative)) return runRelative;
  return cwdRelative;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = escaped.replaceAll("**", ":::DOUBLE_STAR:::").replaceAll("*", "[^/]*").replaceAll(":::DOUBLE_STAR:::", ".*");
  return new RegExp(`^${source}$`);
}

function pathMatches(pattern: string, candidate: string): boolean {
  return globToRegExp(pattern.replace(/\\/g, "/")).test(candidate.replace(/\\/g, "/"));
}

function readSessionContracts(runId: string, runDirPath: string): DispatchContract[] {
  const dispatchFile = path.join(runDirPath, "orchestration", "dispatch-contracts.json");
  const dispatch = optionalJson<{ contracts?: DispatchContract[] }>(dispatchFile);
  if (Array.isArray(dispatch?.contracts)) return dispatch.contracts;
  const sessionFile = path.join(runDirPath, "orchestration", "orchestrator-session.json");
  if (!fs.existsSync(sessionFile)) return [];
  return buildDispatchContracts(runId, runDirPath, sessionFile);
}

function contractActionId(contract: DispatchContract): string {
  return contract.action_id || (contract.task_id ? `agent-${contract.role}-${contract.task_id}` : `agent-${contract.id}`);
}

function contractActionIds(contract: DispatchContract): string[] {
  return Array.from(new Set([
    contract.action_id,
    contract.id ? `agent-${contract.id}` : undefined,
    contract.task_id ? `agent-${contract.role}-${contract.task_id}` : undefined,
    contract.task_id ? `agent-${contract.task_id}` : undefined,
    contract.role ? `agent-${contract.role}` : undefined
  ].filter((item): item is string => typeof item === "string" && item.length > 0)));
}

function contractHandoffPath(runDirPath: string, contract: DispatchContract): string {
  return contract.expected_handoff_path || path.join(runDirPath, "agents", contract.id, "handoff.json");
}

function contractHandoffPaths(runDirPath: string, contract: DispatchContract): string[] {
  return Array.from(new Set([
    contract.expected_handoff_path,
    path.join(runDirPath, "agents", contract.id, "handoff.json"),
    contract.task_id ? path.join(runDirPath, "agents", contract.task_id, "handoff.json") : undefined,
    contract.task_id ? path.join(runDirPath, "agents", `${contract.role}-${contract.task_id}`, "handoff.json") : undefined,
    path.join(runDirPath, "agents", contract.role, "handoff.json")
  ].filter((item): item is string => typeof item === "string" && item.length > 0)));
}

function contractHasHandoff(runDirPath: string, contract: DispatchContract, handoffs?: Set<string>): boolean {
  if (contractHandoffPaths(runDirPath, contract).some((file) => fs.existsSync(file))) return true;
  return Boolean(handoffs?.has(contract.id)
    || (contract.task_id && handoffs?.has(contract.task_id))
    || (contract.task_id && handoffs?.has(`${contract.role}-${contract.task_id}`))
    || handoffs?.has(contract.role));
}

function isAgentContract(contract: DispatchContract): boolean {
  return contract.kind !== "runtime";
}

function allFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) result.push(full);
    }
  };
  walk(dir);
  return result.sort();
}

function traceAuthorship(cwd: string, runDirPath: string): AuthorshipRecord[] {
  const traceDir = path.join(runDirPath, "orchestration", "trace-events");
  const records: AuthorshipRecord[] = [];
  for (const file of allFiles(traceDir).filter((item) => item.endsWith(".json"))) {
    const parsed = optionalJson<unknown>(file);
    const events = Array.isArray(parsed) ? parsed : [parsed];
    for (const event of events) {
      if (!event || typeof event !== "object") continue;
      const record = event as Record<string, unknown>;
      const outputs = Array.isArray(record.outputArtifacts)
        ? record.outputArtifacts.filter((item): item is string => typeof item === "string")
        : [];
      const source = typeof record.source === "string" ? record.source : "";
      const actionId = typeof record.actionId === "string" ? record.actionId : undefined;
      const authorRole = source.startsWith("runtime.") ? "runtime" : source.includes("orchestrator") ? "orchestrator" : undefined;
      for (const output of outputs) {
        records.push({
          file: normalizeRel(cwd, runDirPath, output),
          author_role: authorRole,
          action_id: actionId,
          source
        });
      }
    }
  }
  return records;
}

function explicitAuthorship(cwd: string, runDirPath: string): AuthorshipRecord[] {
  const files = [
    path.join(runDirPath, "orchestration", "artifact-authorship.json"),
    path.join(runDirPath, "orchestration", "role-purity-authorship.json")
  ];
  const records: AuthorshipRecord[] = [];
  for (const file of files) {
    const parsed = optionalJson<{ artifacts?: AuthorshipRecord[]; records?: AuthorshipRecord[] }>(file);
    const items = Array.isArray(parsed?.artifacts) ? parsed.artifacts : Array.isArray(parsed?.records) ? parsed.records : [];
    for (const item of items) {
      const artifactFile = item.file || item.path;
      if (!artifactFile) continue;
      records.push({
        ...item,
        file: normalizeRel(cwd, runDirPath, artifactFile)
      });
    }
  }
  return records;
}

function authorshipRecords(cwd: string, runDirPath: string): AuthorshipRecord[] {
  return [...traceAuthorship(cwd, runDirPath), ...explicitAuthorship(cwd, runDirPath)];
}

function writerFor(file: string, records: AuthorshipRecord[]): AuthorshipRecord | null {
  const normalized = file.replace(/\\/g, "/");
  return records.find((record) => (record.file || "").replace(/\\/g, "/") === normalized) || null;
}

function roleOwnedPaths(runId: string): Array<{ pattern: string; role: string; solution: string }> {
  return [
    { pattern: `planning/task-graph.json`, role: "task-planner", solution: "Dispatch Task Planner Agent to author the task graph before runtime gates." },
    { pattern: `planning/ownership.json`, role: "task-planner", solution: "Dispatch Task Planner Agent to author ownership mapping." },
    { pattern: `planning/execution-plan.md`, role: "task-planner", solution: "Dispatch Task Planner Agent to author the execution plan." },
    { pattern: `planning/commit-plan.md`, role: "task-planner", solution: "Dispatch Task Planner Agent to author the commit plan." },
    { pattern: `design/**`, role: "architect", solution: "Dispatch Architect Agent for design artifacts." },
    { pattern: `evidence/test-results.md`, role: "qa", solution: "Dispatch QA Agent to produce test evidence." },
    { pattern: `evidence/review.md`, role: "reviewer", solution: "Dispatch Reviewer Agent to produce review evidence." },
    { pattern: `evidence/risk-review.md`, role: "risk-reviewer", solution: "Dispatch Risk Reviewer Agent to produce risk evidence." },
    { pattern: `acceptance-deviation.json`, role: "qa|reviewer", solution: "Record deviations through QA or Reviewer acceptance evidence." },
    { pattern: `orchestration/acceptance-matrix.json`, role: "runtime", solution: "Let runtime derive acceptance-matrix.json from agent-authored matrices." },
    { pattern: `orchestration/final-gates.json`, role: "runtime", solution: "Let runtime derive final gates from fresh standard evidence." },
    { pattern: `agents/*/handoff.json`, role: "agent", solution: "Each handoff must be authored by its matching native subagent." },
    { pattern: `archive/**`, role: "archive|runtime", solution: "Archive artifacts must come from Archive Agent or runtime archive finalization." },
    { pattern: `README.md`, role: "technical-writer", solution: "Dispatch Technical Writer Agent for README changes." },
    { pattern: `../README.md`, role: "technical-writer", solution: "Dispatch Technical Writer Agent for README changes." },
    { pattern: `../../README.md`, role: "technical-writer", solution: "Dispatch Technical Writer Agent for README changes." },
    { pattern: `backend/**`, role: "dev|merge-agent", solution: "Dispatch Dev/Fix Agent and Merge Agent for backend changes." },
    { pattern: `frontend/**`, role: "dev|merge-agent", solution: "Dispatch Dev/Fix Agent and Merge Agent for frontend changes." },
    { pattern: `tests/**`, role: "dev|qa|merge-agent", solution: "Dispatch Dev or QA Agent for test changes, then recheck." },
    { pattern: `test/**`, role: "dev|qa|merge-agent", solution: "Dispatch Dev or QA Agent for test changes, then recheck." },
    { pattern: `src/**`, role: "dev|merge-agent", solution: "Dispatch Dev/Fix Agent and Merge Agent for source changes." },
    { pattern: `.imfine/runs/${runId}/planning/**`, role: "task-planner", solution: "Dispatch Task Planner Agent for planning artifacts." },
    { pattern: `.imfine/runs/${runId}/evidence/test-results.md`, role: "qa", solution: "Dispatch QA Agent to produce test evidence." },
    { pattern: `.imfine/runs/${runId}/evidence/review.md`, role: "reviewer", solution: "Dispatch Reviewer Agent to produce review evidence." }
  ];
}

function expectedRoleForFile(cwd: string, runId: string, runDirPath: string, file: string): { role: string; solution: string } | null {
  const runRelative = normalizeRel(cwd, runDirPath, file);
  const cwdRelative = path.isAbsolute(file) ? rel(cwd, file) : file;
  for (const owner of roleOwnedPaths(runId)) {
    if (pathMatches(owner.pattern, runRelative) || pathMatches(owner.pattern, cwdRelative)) return owner;
  }
  return null;
}

function roleMatches(expected: string, observed: string, file: string): boolean {
  if (!observed) return false;
  if (expected === "agent") {
    const parts = file.replace(/\\/g, "/").split("/");
    const agentIndex = parts.lastIndexOf("agents");
    const agentId = agentIndex >= 0 ? parts[agentIndex + 1] || "" : "";
    return observed !== "orchestrator"
      && observed !== "runtime"
      && (agentId === observed || agentId.startsWith(`${observed}-`) || (observed === "dev" && !agentId.includes("-")));
  }
  return expected.split("|").includes(observed);
}

function authoredFileViolations(cwd: string, runId: string, runDirPath: string, contracts: DispatchContract[]): RolePurityViolation[] {
  const records = authorshipRecords(cwd, runDirPath);
  const violations: RolePurityViolation[] = [];
  const providerActionIds = new Set(providerReceipts(cwd, runId).filter((receipt) => receiptProvesNativeSubagent(cwd, receipt)).map((receipt) => receipt.action_id));
  const contractByAction = new Map(contracts.flatMap((contract) => contractActionIds(contract).map((actionId) => [actionId, contract] as const)));
  for (const record of records) {
    const file = record.file || record.path;
    if (!file) continue;
    const owner = expectedRoleForFile(cwd, runId, runDirPath, file);
    if (!owner) continue;
    const observed = record.author_role || record.role || (record.source?.includes("runtime.") ? "runtime" : "");
    if (record.action_id && providerActionIds.has(record.action_id)) {
      const contract = contractByAction.get(record.action_id);
      if (contract && roleMatches(owner.role, contract.role, file)) continue;
    }
    if (!roleMatches(owner.role, observed, file)) {
      violations.push({
        id: `role-purity.${safeFilePart(file)}`,
        severity: "P0",
        file,
        action_id: record.action_id,
        role: observed || "missing",
        reason: "artifact authored by a role that is not allowed to own this path",
        expected: owner.role,
        observed: observed || "missing_authorship",
        solution: owner.solution
      });
    }
  }
  return violations;
}

function requiredAuthorshipViolations(cwd: string, runId: string, runDirPath: string): RolePurityViolation[] {
  const records = authorshipRecords(cwd, runDirPath);
  const violations: RolePurityViolation[] = [];
  for (const owner of roleOwnedPaths(runId).filter((item) => !item.pattern.includes("**") && !item.pattern.includes("*"))) {
    const file = path.join(runDirPath, owner.pattern);
    if (!fs.existsSync(file)) continue;
    const relative = normalizeRel(cwd, runDirPath, file);
    const record = writerFor(relative, records);
    if (!record) continue;
    const observed = record.author_role || record.role || "";
    if (!roleMatches(owner.role, observed, relative)) {
      violations.push({
        id: `role-purity.${safeFilePart(relative)}`,
        severity: "P0",
        file: relative,
        action_id: record.action_id,
        role: observed || "missing",
        reason: "required role-owned artifact has invalid authorship",
        expected: owner.role,
        observed: observed || "missing_authorship",
        solution: owner.solution
      });
    }
  }
  return violations;
}

function completedAgentHandoffs(runDirPath: string): Set<string> {
  const agentsDir = path.join(runDirPath, "agents");
  const result = new Set<string>();
  if (!fs.existsSync(agentsDir)) return result;
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(agentsDir, entry.name, "handoff.json"))) result.add(entry.name);
  }
  return result;
}

function receiptViolations(cwd: string, runId: string, contracts: DispatchContract[]): RolePurityViolation[] {
  const validActionIds = new Set(providerReceipts(cwd, runId).filter((receipt) => receiptProvesNativeSubagent(cwd, receipt)).map((receipt) => receipt.action_id));
  return contracts
    .filter(isAgentContract)
    .filter((contract) => !contractActionIds(contract).some((actionId) => validActionIds.has(actionId)))
    .map((contract) => ({
      id: `provider-receipt.${contractActionId(contract)}`,
      severity: "P0" as const,
      action_id: contractActionId(contract),
      role: contract.role,
      reason: "required agent dispatch lacks valid provider-origin receipt",
      expected: "provider_native_subagent completed receipt",
      observed: "missing_or_invalid_receipt",
      solution: "Record completion with imfine-runtime agent complete using real provider agent id, session id, and task handle."
    }));
}

function handoffViolations(runDirPath: string, contracts: DispatchContract[]): RolePurityViolation[] {
  return contracts
    .filter(isAgentContract)
    .filter((contract) => !contractHasHandoff(runDirPath, contract))
    .map((contract) => ({
      id: `handoff.${contractActionId(contract)}`,
      severity: "P0" as const,
      file: contractHandoffPath(runDirPath, contract),
      action_id: contractActionId(contract),
      role: contract.role,
      reason: "required agent dispatch lacks handoff",
      expected: "agents/<agent-id>/handoff.json",
      observed: "missing_handoff",
      solution: "Wait for the native subagent to write handoff.json before closing or archiving the run."
    }));
}

function qualityBlockingHandoffs(runDirPath: string): Array<{ agentId: string; role: string; findingCount: number }> {
  const agentsDir = path.join(runDirPath, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  const result: Array<{ agentId: string; role: string; findingCount: number }> = [];
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(agentsDir, entry.name, "handoff.json");
    if (!fs.existsSync(file)) continue;
    const handoff = optionalJson<HandoffRecord>(file);
    const rawRole = handoff?.role || handoff?.from || "";
    const role = normalizeRuntimeRole(rawRole) || rawRole;
    const findings = role === "reviewer" ? handoff?.findings : role === "qa" ? handoff?.failures : [];
    const status = typeof handoff?.status === "string" ? handoff.status.replaceAll("-", "_") : "";
    const findingCount = Array.isArray(findings) ? findings.length : 0;
    if ((role === "reviewer" && (status === "changes_requested" || status === "blocked" || findingCount > 0))
      || (role === "qa" && (status === "fail" || status === "blocked" || findingCount > 0))) {
      result.push({ agentId: entry.name, role, findingCount: Math.max(1, findingCount) });
    }
  }
  return result;
}

function reworkViolations(runDirPath: string, contracts: DispatchContract[], qualityLineage: QualityLineageRecord | null): RolePurityViolation[] {
  const blockers = qualityBlockingHandoffs(runDirPath);
  if (blockers.length === 0) return [];
  const hasFixDispatch = contracts.some((contract) => isAgentContract(contract)
    && (contract.task_id?.startsWith("FIX-") || /fix|rework|remediation|recheck/i.test(`${contract.id} ${contract.action_id} ${contract.task_id || ""}`))
    && ["dev", "qa", "reviewer"].includes(contract.role));
  const recheckClosed = qualityLineage?.summary?.recheck_fix_loop === "pass";
  if (hasFixDispatch && recheckClosed) return [];
  return blockers.map((blocker) => ({
    id: `rework-dispatch.${blocker.agentId}`,
    severity: "P0" as const,
    role: blocker.role,
    reason: "QA or Reviewer blocker was not closed through fix/recheck dispatch",
    expected: "remediation dispatch plus QA and Reviewer recheck",
    observed: hasFixDispatch ? "fix_dispatch_without_closed_recheck" : "missing_fix_dispatch",
    solution: "Create Backend/Frontend Fix Agent dispatches, then QA Recheck and Reviewer Recheck dispatches before final gates."
  }));
}

function deviationViolations(matrix: AcceptanceMatrixRecord | null): RolePurityViolation[] {
  if (!matrix) {
    return [{
      id: "acceptance-matrix.missing",
      severity: "P0",
      reason: "acceptance matrix is missing",
      expected: "runtime-derived acceptance matrix from agent-authored source",
      observed: "missing",
      solution: "Have Product/QA/Reviewer Agent author acceptance coverage, then run runtime reconciliation."
    }];
  }
  const items = Array.isArray(matrix.items) ? matrix.items : [];
  return items
    .filter((item) => (item.classification === "demo-substitute" || item.classification === "deviation")
      && item.requirement_level === "required"
      && (item.status !== "pass" || item.accepted_by_review !== true || !item.deviation))
    .map((item) => ({
      id: `deviation.${safeFilePart(item.id || "unknown")}`,
      severity: "P0" as const,
      reason: "required-scope deviation is not formally accepted",
      expected: "accepted deviation with QA/Reviewer evidence and follow-up",
      observed: item.status || "missing_status",
      solution: "Record acceptance-deviation evidence and keep the run blocked unless QA/Reviewer accepts the deviation."
    }));
}

function closedAgentViolations(cwd: string, runDirPath: string, contracts: DispatchContract[]): RolePurityViolation[] {
  const closeFile = path.join(runDirPath, "orchestration", "agent-close-ledger.json");
  const closeLedger = optionalJson<{ closed_agents?: Array<{ agent_id?: string; action_id?: string; closed_at?: string }> }>(closeFile);
  if (!Array.isArray(closeLedger?.closed_agents) || closeLedger.closed_agents.length === 0) return [];
  const handoffs = completedAgentHandoffs(runDirPath);
  const validReceipts = new Set(providerReceipts(cwd, path.basename(runDirPath)).filter((receipt) => receiptProvesNativeSubagent(cwd, receipt)).map((receipt) => receipt.action_id));
  const contractByAgent = new Map(contracts.map((contract) => [contract.id, contract]));
  return closeLedger.closed_agents
    .filter((item) => {
      const agentId = item.agent_id || "";
      const contract = contractByAgent.get(agentId);
      const actionId = item.action_id || (contract ? contractActionId(contract) : "");
      const actionIds = contract ? contractActionIds(contract) : [actionId].filter(Boolean);
      return !handoffs.has(agentId) || !actionIds.some((id) => validReceipts.has(id));
    })
    .map((item) => ({
      id: `agent-close.${safeFilePart(item.agent_id || item.action_id || "unknown")}`,
      severity: "P0" as const,
      action_id: item.action_id,
      reason: "agent was closed before handoff and provider receipt were complete",
      expected: "handoff present and provider receipt valid before close",
      observed: "close_without_closed_evidence",
      solution: "Record provider-origin completion and validate handoff before closing native agent sessions."
    }));
}

export function writeRolePurityAudit(cwd: string, runId: string): string {
  const runDirPath = runDir(cwd, runId);
  const orchestrationDir = path.join(runDirPath, "orchestration");
  ensureDir(orchestrationDir);
  const contracts = readSessionContracts(runId, runDirPath);
  const agentContracts = contracts.filter(isAgentContract);
  const qualityLineage = optionalJson<QualityLineageRecord>(path.join(orchestrationDir, "quality-lineage.json"));
  const matrix = acceptanceMatrix(runDirPath);
  const validReceipts = providerReceipts(cwd, runId).filter((receipt) => receiptProvesNativeSubagent(cwd, receipt));
  const handoffs = completedAgentHandoffs(runDirPath);
  const violations = [
    ...receiptViolations(cwd, runId, contracts),
    ...handoffViolations(runDirPath, contracts),
    ...authoredFileViolations(cwd, runId, runDirPath, contracts),
    ...requiredAuthorshipViolations(cwd, runId, runDirPath),
    ...reworkViolations(runDirPath, contracts, qualityLineage),
    ...deviationViolations(matrix),
    ...closedAgentViolations(cwd, runDirPath, contracts)
  ];
  const receiptActionIds = new Set(validReceipts.map((receipt) => receipt.action_id));
  const providerReceiptsClosed = agentContracts.length > 0 && agentContracts.every((contract) => contractActionIds(contract).some((actionId) => receiptActionIds.has(actionId)));
  const requiredHandoffsPresent = agentContracts.length > 0 && agentContracts.every((contract) => contractHasHandoff(runDirPath, contract, handoffs));
  const qaReviewerArchiveGatesClosed = qualityLineage?.summary?.qa === "pass"
    && qualityLineage.summary.review === "pass"
    && qualityLineage.summary.recheck_fix_loop === "pass"
    && fs.existsSync(path.join(runDirPath, "agents", "archive", "handoff.json"));
  const deviationsClosed = (matrix?.summary?.blocked || 0) === 0 && deviationViolations(matrix).length === 0;
  const reworkDispatchClosed = reworkViolations(runDirPath, contracts, qualityLineage).length === 0;
  const agentCloseSafe = closedAgentViolations(cwd, runDirPath, contracts).length === 0;
  const payload: RolePurityAudit = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    status: violations.length === 0 ? "pass" : "blocked",
    orchestrator_role_purity: violations.some((violation) => violation.id.startsWith("role-purity.") || violation.id.startsWith("rework-dispatch.")) ? "fail" : "pass",
    spawned_agents: agentContracts.length > 0,
    provider_receipts_closed: providerReceiptsClosed,
    required_handoffs_present: requiredHandoffsPresent,
    qa_reviewer_archive_gates_closed: qaReviewerArchiveGatesClosed,
    deviations_closed: deviationsClosed,
    rework_dispatch_closed: reworkDispatchClosed,
    agent_close_safe: agentCloseSafe,
    violations: Array.from(new Map(violations.map((violation) => [violation.id, violation])).values())
  };
  const file = path.join(orchestrationDir, "role-purity-audit.json");
  writeText(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

export function readRolePurityAudit(cwd: string, runId: string): RolePurityAudit | null {
  const file = path.join(runDir(cwd, runId), "orchestration", "role-purity-audit.json");
  if (!fs.existsSync(file)) return null;
  return readJson<RolePurityAudit>(file);
}
