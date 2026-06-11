import fs from "node:fs";
import path from "node:path";
import { validateHandoff, type HandoffRole } from "./handoff-validator.js";
import { isRuntimeRole, normalizeRuntimeRole, RUNTIME_ROLES, roleContract } from "./role-registry.js";

export interface AgentHandoffTarget {
  id: string;
  role: string;
  taskId?: string;
  handoffFile?: string;
}

export interface AgentHandoffValidation {
  agentId: string;
  role: string;
  taskId?: string;
  file: string | null;
  passed: boolean;
  errors: string[];
}

const HANDOFF_ROLES = new Set<string>(RUNTIME_ROLES);

export function isHandoffRole(role: string): role is HandoffRole {
  return HANDOFF_ROLES.has(role) && isRuntimeRole(role);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeStatus(role: HandoffRole, value: Record<string, unknown>): string | undefined {
  const raw = typeof value.status === "string" ? value.status.trim().toLowerCase().replaceAll("-", "_").replace(/\s+/g, "_") : "";
  const approval = typeof value.approval_status === "string" ? value.approval_status.trim().toLowerCase().replaceAll("-", "_") : "";
  if (role === "qa") {
    if (raw === "pass" || raw === "passed") return "pass";
    if (raw === "fail" || raw === "failed") return "fail";
    if (raw.includes("blocked")) return "blocked";
    const summary = isObject(value.verification_summary) ? value.verification_summary : null;
    if (summary?.required_coverage_declared_complete === true) return "pass";
    return undefined;
  }
  if (role === "reviewer") {
    if (raw === "approved" || raw === "approved_with_risks" || raw === "completed" || approval === "approved" || approval === "approved_with_risks") return "approved";
    if (raw === "changes_requested" || approval === "changes_requested") return "changes_requested";
    if (raw.includes("blocked") || approval.includes("blocked")) return "blocked";
    return undefined;
  }
  if (role === "archive") {
    if (raw.includes("blocked")) return "blocked";
    if (raw.startsWith("completed") || raw.startsWith("archive_created")) return "completed";
    return raw || undefined;
  }
  if (raw.includes("blocked")) return "blocked";
  if (raw === "not_needed" && role === "technical-writer") return "not_needed";
  if (raw || typeof value.approval_status === "string") return "ready";
  return undefined;
}

function projectRootFromRunDir(runDirPath: string): string {
  return path.dirname(path.dirname(path.dirname(runDirPath)));
}

function resolveEvidencePath(cwd: string, runDirPath: string, item: string): string {
  if (path.isAbsolute(item)) return item;
  const runRelative = path.join(runDirPath, item);
  if (fs.existsSync(runRelative)) return runRelative;
  return path.resolve(cwd, item);
}

function evidenceFrom(value: Record<string, unknown>): string[] {
  return Array.from(new Set([
    ...stringArray(value.evidence),
    ...stringArray(value.docs_changed),
    ...(typeof value.archive_report === "string" ? [value.archive_report] : [])
  ]));
}

function normalizeHandoff(value: unknown, role: HandoffRole, runId: string, taskId?: string): unknown {
  if (!isObject(value)) return value;
  const status = normalizeStatus(role, value);
  if (!status) return value;
  const hasSemanticPayload = typeof value.role === "string"
    || typeof value.summary === "string"
    || evidenceFrom(value).length > 0
    || stringArray(value.files_changed).length > 0
    || stringArray(value.files_created_or_modified).length > 0
    || stringArray(value.files_created).length > 0
    || isObject(value.verification_summary)
    || typeof value.approval_status === "string";
  if (!hasSemanticPayload) return value;
  const contract = roleContract(role);
  const evidence = evidenceFrom(value);
  const summary = typeof value.summary === "string" && value.summary.trim()
    ? value.summary
    : typeof value.reason === "string" && value.reason.trim()
      ? value.reason
      : `${role} handoff`;
  const normalized: Record<string, unknown> = {
    ...value,
    run_id: typeof value.run_id === "string" ? value.run_id : runId,
    task_id: typeof value.task_id === "string" ? value.task_id : taskId || "run",
    role,
    from: role,
    to: typeof value.to === "string" && value.to.trim()
      ? value.to
      : stringArray(value.next_roles)[0] || "orchestrator",
    status,
    summary,
    commands: stringArray(value.commands),
    evidence,
    next_state: typeof value.next_state === "string" && value.next_state.trim()
      ? value.next_state
      : status === "blocked" ? "blocked" : "completed"
  };
  for (const field of contract.requiredArrayFields) {
    if (Array.isArray(normalized[field])) continue;
    if (field === "failures") normalized[field] = stringArray(value.failures);
    else if (field === "findings") normalized[field] = stringArray(value.findings);
    else if (field === "files_changed") normalized[field] = stringArray(value.files_changed).concat(stringArray(value.files_created_or_modified), stringArray(value.files_created));
    else if (field === "verification") normalized[field] = stringArray(value.verification).concat(stringArray(value.verification_commands));
    else if (field === "merged_files") normalized[field] = stringArray(value.merged_files).concat(stringArray(value.files_created_or_modified));
    else if (field === "project_updates") normalized[field] = stringArray(value.project_updates);
    else if (field === "blocked_items") normalized[field] = stringArray(value.blocked_items);
    else if (field === "risks") normalized[field] = stringArray(value.risks);
    else if (field === "required_changes") normalized[field] = stringArray(value.required_changes);
    else if (field === "docs_changed") normalized[field] = stringArray(value.docs_changed);
    else if (field === "updated_files") normalized[field] = stringArray(value.updated_files);
    else if (field === "design_files") normalized[field] = stringArray(value.design_files).concat(stringArray(value.files_created));
    else if (field === "acceptance") normalized[field] = stringArray(value.acceptance).concat(stringArray(value.acceptance_candidates));
    else if (field === "parallel_groups" || field === "serial_tasks") normalized[field] = stringArray(value[field]);
  }
  if (contract.requiredStringFields.includes("task_graph") && typeof normalized.task_graph !== "string") normalized.task_graph = "planning/task-graph.json";
  if (contract.requiredStringFields.includes("archive_report") && typeof normalized.archive_report !== "string") normalized.archive_report = evidence.find((item) => item.includes("archive")) || "archive/final-report.md";
  if (contract.requiredStringFields.includes("commit_mode") && typeof normalized.commit_mode !== "string") normalized.commit_mode = "task";
  if (contract.requiredStringFields.includes("reason") && typeof normalized.reason !== "string") normalized.reason = summary;
  if (contract.requiredStringFields.includes("ux_design") && typeof normalized.ux_design !== "string") normalized.ux_design = evidence.find((item) => item.includes("ux-design")) || "design/ux-design.md";
  return normalized;
}

export function agentHandoffCandidates(agent: AgentHandoffTarget, runDirPath: string): string[] {
  const taskScopedDirectory = agent.taskId && (agent.role === "dev" || agent.role === "technical-writer")
    ? path.join(runDirPath, "agents", agent.taskId, "handoff.json")
    : undefined;
  const candidates = [
    agent.handoffFile,
    path.join(runDirPath, "agents", agent.id, "handoff.json"),
    taskScopedDirectory,
    agent.taskId ? path.join(runDirPath, "agents", `${agent.role}-${agent.taskId}`, "handoff.json") : undefined,
    path.join(runDirPath, "agents", agent.role, "handoff.json")
  ].filter((item): item is string => typeof item === "string" && item.length > 0);
  return Array.from(new Set(candidates));
}

export function validateAgentHandoff(agent: AgentHandoffTarget, runDirPath: string, runId: string): AgentHandoffValidation {
  const role = normalizeRuntimeRole(agent.role) || agent.role;
  const file = agentHandoffCandidates(agent, runDirPath).find((candidate) => fs.existsSync(candidate)) || null;
  if (!file) {
    return {
      agentId: agent.id,
      role,
      taskId: agent.taskId,
      file,
      passed: false,
      errors: ["handoff is missing"]
    };
  }
  if (!isHandoffRole(role)) {
    return {
      agentId: agent.id,
      role,
      taskId: agent.taskId,
      file,
      passed: false,
      errors: [`unsupported handoff role: ${agent.role}`]
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {
      agentId: agent.id,
      role,
      taskId: agent.taskId,
      file,
      passed: false,
      errors: ["handoff is not valid JSON"]
    };
  }
  const rawValidation = validateHandoff(role, parsed, runId, agent.taskId);
  const normalized = rawValidation.passed ? parsed : normalizeHandoff(parsed, role, runId, agent.taskId);
  const validation = rawValidation.passed ? rawValidation : validateHandoff(role, normalized, runId, agent.taskId);
  const evidence = isObject(normalized) && Array.isArray(normalized.evidence) ? normalized.evidence : [];
  const cwd = projectRootFromRunDir(runDirPath);
  const evidenceErrors = evidence
    .filter((item) => typeof item !== "string" || !fs.existsSync(resolveEvidencePath(cwd, runDirPath, item)))
    .map((item) => `missing evidence: ${String(item)}`);
  return {
    agentId: agent.id,
    role,
    taskId: agent.taskId,
    file,
    passed: validation.passed && evidenceErrors.length === 0,
    errors: [...validation.errors, ...evidenceErrors]
  };
}
