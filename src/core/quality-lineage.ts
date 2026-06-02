import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateAgentHandoff } from "./handoff-evidence.js";

type QualityRole = "qa" | "reviewer";

export type QualityGateStatus = "pass" | "blocked";

export interface QualityLineageResult {
  schema_version: 1;
  run_id: string;
  generated_at: string;
  summary: {
    qa: QualityGateStatus;
    review: QualityGateStatus;
    recheck_fix_loop: QualityGateStatus;
  };
  lineages: QualityLineage[];
}

export interface QualityLineage {
  role: QualityRole;
  task_id: string;
  status: QualityGateStatus;
  latest_status: string;
  latest_handoff: string | null;
  original_check: QualityAction | null;
  findings: QualityAction[];
  rework: QualityAction[];
  rechecks: QualityAction[];
  resolved_findings: string[];
  unresolved_findings: string[];
  invalid_rechecks: Array<{ handoff: string; errors: string[] }>;
}

interface QualityAction {
  id: string;
  role: QualityRole;
  task_id: string;
  status: string;
  handoff: string;
  evidence: string[];
  summary: string;
  finding_ids: string[];
  resolves: string[];
  supersedes: string[];
  fix_task_id: string | null;
}

function runDir(cwd: string, runId: string): string {
  return path.join(cwd, ".imfine", "runs", runId);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "finding";
}

function resolvePath(cwd: string, dir: string, file: string): string {
  if (path.isAbsolute(file)) return file;
  const runRelative = path.join(dir, file);
  if (fs.existsSync(runRelative)) return runRelative;
  return path.resolve(cwd, file);
}

function normalizeEvidence(cwd: string, dir: string, value: unknown): string[] {
  return stringArray(value).map((file) => resolvePath(cwd, dir, file));
}

function findingIds(role: QualityRole, taskId: string, status: string, handoff: Record<string, unknown>): string[] {
  const findings = role === "qa" ? handoff.failures : handoff.findings;
  const explicit = stringArray(handoff.finding_ids);
  if (explicit.length > 0) return explicit;
  if (Array.isArray(findings) && findings.length > 0) {
    return findings.map((item, index) => {
      if (isObject(item) && typeof item.id === "string" && item.id.trim()) return item.id;
      if (typeof item === "string" && item.trim()) return safeId(`${role}-${taskId}-${item.slice(0, 48)}`);
      return `${role}-${taskId}-finding-${index + 1}`;
    });
  }
  if ((role === "qa" && (status === "fail" || status === "blocked")) || (role === "reviewer" && (status === "changes_requested" || status === "blocked"))) {
    return [`${role}-${taskId}-${status}`];
  }
  return [];
}

function actionFromHandoff(cwd: string, dir: string, file: string): QualityAction | null {
  const parsed = readJson<unknown>(file);
  if (!isObject(parsed)) return null;
  const role = parsed.role === "qa" || parsed.role === "reviewer" ? parsed.role : null;
  const taskId = typeof parsed.task_id === "string" ? parsed.task_id : "";
  const status = typeof parsed.status === "string" ? parsed.status : "";
  if (!role || !taskId || !status) return null;
  return {
    id: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id : path.basename(path.dirname(file)),
    role,
    task_id: taskId,
    status,
    handoff: file,
    evidence: normalizeEvidence(cwd, dir, parsed.evidence),
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    finding_ids: findingIds(role, taskId, status, parsed),
    resolves: stringArray(parsed.resolves),
    supersedes: stringArray(parsed.supersedes),
    fix_task_id: typeof parsed.fix_task_id === "string" && parsed.fix_task_id.trim() ? parsed.fix_task_id : null
  };
}

function collectQualityActions(cwd: string, runId: string): QualityAction[] {
  const dir = runDir(cwd, runId);
  const agentsDir = path.join(dir, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  const actions: QualityAction[] = [];
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(agentsDir, entry.name, "handoff.json");
    if (!fs.existsSync(file)) continue;
    const action = actionFromHandoff(cwd, dir, file);
    if (action && (action.role === "qa" || action.role === "reviewer")) actions.push(action);
  }
  return actions.sort((a, b) => a.handoff.localeCompare(b.handoff));
}

function groupKey(role: QualityRole, taskId: string): string {
  return `${role}:${taskId}`;
}

function isPassing(action: QualityAction): boolean {
  return (action.role === "qa" && action.status === "pass") || (action.role === "reviewer" && action.status === "approved");
}

function isBlocking(action: QualityAction): boolean {
  return (action.role === "qa" && (action.status === "fail" || action.status === "blocked"))
    || (action.role === "reviewer" && (action.status === "changes_requested" || action.status === "blocked"));
}

function validateRecheck(cwd: string, runId: string, action: QualityAction, blockers: Set<string>): string[] {
  const dir = runDir(cwd, runId);
  const validation = validateAgentHandoff({
    id: path.basename(path.dirname(action.handoff)),
    role: action.role,
    taskId: action.task_id,
    handoffFile: action.handoff
  }, dir, runId);
  const errors = [...validation.errors];
  if (action.evidence.length === 0) errors.push("recheck missing evidence");
  const missingEvidence = action.evidence.filter((file) => !fs.existsSync(file));
  if (missingEvidence.length > 0) errors.push(`recheck missing evidence files: ${missingEvidence.join(", ")}`);
  if (action.resolves.length === 0 && action.supersedes.length === 0) errors.push("recheck missing resolves or supersedes lineage");
  const referenced = [...action.resolves, ...action.supersedes];
  const unknown = referenced.filter((id) => !blockers.has(id));
  if (unknown.length > 0) errors.push(`recheck references unknown blocker or finding: ${unknown.join(", ")}`);
  return errors;
}

function buildLineage(cwd: string, runId: string, role: QualityRole, taskId: string, actions: QualityAction[]): QualityLineage {
  const blockingActions = actions.filter(isBlocking);
  const blockers = new Set(blockingActions.flatMap((action) => action.finding_ids));
  const invalidRechecks: Array<{ handoff: string; errors: string[] }> = [];
  const rechecks = actions.filter((action) => isPassing(action) && (blockers.size > 0 || action.resolves.length > 0 || action.supersedes.length > 0));
  const validRechecks = rechecks.filter((action) => {
    const errors = validateRecheck(cwd, runId, action, blockers);
    if (errors.length > 0) invalidRechecks.push({ handoff: action.handoff, errors });
    return errors.length === 0;
  });
  const resolved = new Set(validRechecks.flatMap((action) => [...action.resolves, ...action.supersedes]).filter((id) => blockers.has(id)));
  const unresolved = Array.from(blockers).filter((id) => !resolved.has(id));
  const plainPasses = blockers.size === 0
    ? actions.filter((action) => isPassing(action) && action.resolves.length === 0 && action.supersedes.length === 0)
    : [];
  const status: QualityGateStatus = blockers.size === 0
    ? plainPasses.length > 0 ? "pass" : "blocked"
    : unresolved.length === 0 && validRechecks.length > 0 ? "pass" : "blocked";
  let latest: QualityAction | null = null;
  if (status === "pass") {
    latest = validRechecks.at(-1) || plainPasses.at(-1) || actions.at(-1) || null;
  } else if (invalidRechecks.length > 0) {
    latest = actions.find((action) => action.handoff === invalidRechecks.at(-1)?.handoff) || blockingActions.at(-1) || actions.at(-1) || null;
  } else {
    latest = blockingActions.at(-1) || actions.at(-1) || null;
  }
  return {
    role,
    task_id: taskId,
    status,
    latest_status: latest?.status || "missing",
    latest_handoff: latest?.handoff || null,
    original_check: actions[0] || null,
    findings: blockingActions,
    rework: actions.filter((action) => action.fix_task_id),
    rechecks,
    resolved_findings: Array.from(resolved),
    unresolved_findings: unresolved,
    invalid_rechecks: invalidRechecks
  };
}

export function writeQualityLineage(cwd: string, runId: string): string {
  const dir = runDir(cwd, runId);
  const actions = collectQualityActions(cwd, runId);
  const keys = new Set(actions.map((action) => groupKey(action.role, action.task_id)));
  const lineages = Array.from(keys).map((key) => {
    const [role, taskId] = key.split(":") as [QualityRole, string];
    return buildLineage(cwd, runId, role, taskId, actions.filter((action) => action.role === role && action.task_id === taskId));
  });
  const qaLineages = lineages.filter((item) => item.role === "qa");
  const reviewLineages = lineages.filter((item) => item.role === "reviewer");
  const payload: QualityLineageResult = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    summary: {
      qa: qaLineages.length > 0 && qaLineages.every((item) => item.status === "pass") ? "pass" : "blocked",
      review: reviewLineages.length > 0 && reviewLineages.every((item) => item.status === "pass") ? "pass" : "blocked",
      recheck_fix_loop: lineages.length > 0 && lineages.every((item) => item.status === "pass" && item.invalid_rechecks.length === 0) ? "pass" : "blocked"
    },
    lineages
  };
  const file = path.join(dir, "orchestration", "quality-lineage.json");
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

export function readQualityLineage(cwd: string, runId: string): QualityLineageResult | null {
  const file = path.join(runDir(cwd, runId), "orchestration", "quality-lineage.json");
  if (!fs.existsSync(file)) return null;
  return readJson<QualityLineageResult>(file);
}
