import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateAgentHandoff } from "./handoff-evidence.js";
import { normalizeRuntimeRole } from "./role-registry.js";
import { appendRuntimeTraceEvent } from "./trace-events.js";

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
    coverage: {
      expected_tasks: string[];
      qa: { passed: number; expected: number; missing: string[] };
      review: { passed: number; expected: number; missing: string[] };
    };
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

function objectStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => isObject(item) && typeof item[field] === "string" ? item[field] : typeof item === "string" ? item : "")
    .filter((item): item is string => item.trim().length > 0);
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

function combinedEvidence(cwd: string, dir: string, handoff: Record<string, unknown>): string[] {
  return Array.from(new Set([
    ...normalizeEvidence(cwd, dir, handoff.evidence),
    ...normalizeEvidence(cwd, dir, handoff.files_created),
    ...normalizeEvidence(cwd, dir, handoff.files_created_or_modified),
    ...(typeof handoff.archive_report === "string" ? [resolvePath(cwd, dir, handoff.archive_report)] : [])
  ]));
}

function normalizeQualityRole(handoff: Record<string, unknown>, fallback: string): QualityRole | null {
  const raw = typeof handoff.role === "string"
    ? handoff.role
    : typeof handoff.from === "string"
      ? handoff.from
      : fallback;
  const role = normalizeRuntimeRole(raw);
  return role === "qa" || role === "reviewer" ? role : null;
}

function normalizeQualityStatus(role: QualityRole, handoff: Record<string, unknown>): string {
  const raw = typeof handoff.status === "string" ? handoff.status.trim().toLowerCase().replaceAll("-", "_").replace(/\s+/g, "_") : "";
  const approval = typeof handoff.approval_status === "string" ? handoff.approval_status.trim().toLowerCase().replaceAll("-", "_") : "";
  if (role === "qa") {
    if (raw === "pass" || raw === "passed") return "pass";
    if (raw === "fail" || raw === "failed") return "fail";
    if (raw.includes("blocked")) return "blocked";
    const summary = isObject(handoff.verification_summary) ? handoff.verification_summary : null;
    return summary?.required_coverage_declared_complete === true ? "pass" : raw;
  }
  if (raw === "approved" || raw === "approved_with_risks" || raw === "completed" || approval === "approved" || approval === "approved_with_risks") return "approved";
  if (raw === "changes_requested" || approval === "changes_requested") return "changes_requested";
  if (raw.includes("blocked") || approval.includes("blocked")) return "blocked";
  return raw;
}

function coveredTaskIds(handoff: Record<string, unknown>, expectedTasks: string[]): string[] {
  const explicit = [
    ...stringArray(handoff.covered_task_ids),
    ...stringArray(handoff.covered_tasks),
    ...stringArray(handoff.task_ids),
    ...objectStringArray(handoff.tasks, "id")
  ];
  if (explicit.length > 0) return Array.from(new Set(explicit));
  const taskId = typeof handoff.task_id === "string" && handoff.task_id.trim() ? handoff.task_id : "";
  if (taskId && taskId !== "run") return [taskId];
  const summary = isObject(handoff.verification_summary) ? handoff.verification_summary : null;
  if (expectedTasks.length > 0 && (summary?.required_coverage_declared_complete === true || handoff.approval_status === "approved_with_risks" || handoff.approval_status === "approved")) {
    return expectedTasks;
  }
  return [];
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

function actionsFromHandoff(cwd: string, dir: string, file: string, expectedTasks: string[]): QualityAction[] {
  const parsed = readJson<unknown>(file);
  if (!isObject(parsed)) return [];
  const role = normalizeQualityRole(parsed, path.basename(path.dirname(file)));
  if (!role) return [];
  const status = normalizeQualityStatus(role, parsed);
  if (!status) return [];
  return coveredTaskIds(parsed, expectedTasks).map((taskId) => ({
    id: typeof parsed.id === "string" && parsed.id.trim() ? `${parsed.id}:${taskId}` : `${path.basename(path.dirname(file))}:${taskId}`,
    role,
    task_id: taskId,
    status,
    handoff: file,
    evidence: combinedEvidence(cwd, dir, parsed),
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    finding_ids: findingIds(role, taskId, status, parsed),
    resolves: stringArray(parsed.resolves),
    supersedes: stringArray(parsed.supersedes),
    fix_task_id: typeof parsed.fix_task_id === "string" && parsed.fix_task_id.trim() ? parsed.fix_task_id : null
  }));
}

function collectQualityActions(cwd: string, runId: string, expectedTasks: string[]): QualityAction[] {
  const dir = runDir(cwd, runId);
  const agentsDir = path.join(dir, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  const actions: QualityAction[] = [];
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(agentsDir, entry.name, "handoff.json");
    if (!fs.existsSync(file)) continue;
    actions.push(...actionsFromHandoff(cwd, dir, file, expectedTasks));
  }
  return actions.sort((a, b) => a.handoff.localeCompare(b.handoff));
}

function expectedTaskIds(cwd: string, runId: string): string[] {
  const file = path.join(runDir(cwd, runId), "planning", "task-graph.json");
  if (!fs.existsSync(file)) return [];
  const parsed = readJson<{ tasks?: Array<{ id?: unknown; type?: unknown }> }>(file);
  return Array.isArray(parsed.tasks)
    ? parsed.tasks
      .filter((task) => typeof task.id === "string" && task.id.trim().length > 0)
      .filter((task) => task.type !== "runtime")
      .map((task) => task.id as string)
    : [];
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
  const expectedTasks = expectedTaskIds(cwd, runId);
  const actions = collectQualityActions(cwd, runId, expectedTasks);
  const keys = new Set(actions.map((action) => groupKey(action.role, action.task_id)));
  for (const taskId of expectedTasks) {
    keys.add(groupKey("qa", taskId));
    keys.add(groupKey("reviewer", taskId));
  }
  const lineages = Array.from(keys).map((key) => {
    const [role, taskId] = key.split(":") as [QualityRole, string];
    return buildLineage(cwd, runId, role, taskId, actions.filter((action) => action.role === role && action.task_id === taskId));
  });
  const qaLineages = lineages.filter((item) => item.role === "qa");
  const reviewLineages = lineages.filter((item) => item.role === "reviewer");
  const expectedQa = expectedTasks.length > 0 ? expectedTasks : qaLineages.map((item) => item.task_id);
  const expectedReview = expectedTasks.length > 0 ? expectedTasks : reviewLineages.map((item) => item.task_id);
  const qaPassed = qaLineages.filter((item) => expectedQa.includes(item.task_id) && item.status === "pass");
  const reviewPassed = reviewLineages.filter((item) => expectedReview.includes(item.task_id) && item.status === "pass");
  const qaMissing = expectedQa.filter((taskId) => !qaLineages.some((item) => item.task_id === taskId && item.status === "pass"));
  const reviewMissing = expectedReview.filter((taskId) => !reviewLineages.some((item) => item.task_id === taskId && item.status === "pass"));
  const payload: QualityLineageResult = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    summary: {
      qa: expectedQa.length > 0 && qaMissing.length === 0 && qaLineages.every((item) => item.status === "pass") ? "pass" : "blocked",
      review: expectedReview.length > 0 && reviewMissing.length === 0 && reviewLineages.every((item) => item.status === "pass") ? "pass" : "blocked",
      recheck_fix_loop: lineages.length > 0 && lineages.every((item) => item.status === "pass" && item.invalid_rechecks.length === 0) ? "pass" : "blocked",
      coverage: {
        expected_tasks: expectedTasks,
        qa: { passed: qaPassed.length, expected: expectedQa.length, missing: qaMissing },
        review: { passed: reviewPassed.length, expected: expectedReview.length, missing: reviewMissing }
      }
    },
    lineages
  };
  const file = path.join(dir, "orchestration", "quality-lineage.json");
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify(payload, null, 2)}\n`);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.quality-lineage",
    componentId: "runtime.quality-lineage",
    actionId: "runtime.write_quality_lineage",
    eventType: "artifact_written",
    status: payload.summary.qa === "pass" && payload.summary.review === "pass" && payload.summary.recheck_fix_loop === "pass" ? "pass" : "blocked",
    reason: `qa=${payload.summary.qa}; review=${payload.summary.review}; recheck=${payload.summary.recheck_fix_loop}`,
    inputArtifacts: actions.map((action) => action.handoff),
    outputArtifacts: [file]
  });
  return file;
}

export function readQualityLineage(cwd: string, runId: string): QualityLineageResult | null {
  const file = path.join(runDir(cwd, runId), "orchestration", "quality-lineage.json");
  if (!fs.existsSync(file)) return null;
  return readJson<QualityLineageResult>(file);
}
