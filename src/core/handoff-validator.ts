export type HandoffRole = "dev" | "qa" | "reviewer" | "archive" | "conflict-resolver" | "committer" | "risk-reviewer" | "technical-writer" | "project-knowledge-updater";

export interface HandoffValidationResult {
  passed: boolean;
  errors: string[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(input: JsonObject, field: string, errors: string[]): string | undefined {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`missing string field: ${field}`);
    return undefined;
  }
  return value;
}

function optionalStringField(input: JsonObject, field: string, errors: string[]): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`invalid string field: ${field}`);
    return undefined;
  }
  return value;
}

function arrayField(input: JsonObject, field: string, errors: string[]): unknown[] | undefined {
  const value = input[field];
  if (!Array.isArray(value)) {
    errors.push(`missing array field: ${field}`);
    return undefined;
  }
  return value;
}

function statusField(input: JsonObject, allowed: string[], errors: string[]): string | undefined {
  const status = stringField(input, "status", errors);
  if (status && !allowed.includes(status)) errors.push(`invalid status: ${status}`);
  return status;
}

function checkRunAndTask(input: JsonObject, runId: string, taskId: string | undefined, errors: string[]): void {
  const handoffRunId = stringField(input, "run_id", errors);
  if (handoffRunId && handoffRunId !== runId) errors.push(`run_id mismatch: ${handoffRunId}`);
  if (taskId) {
    const handoffTaskId = optionalStringField(input, "task_id", errors);
    if (handoffTaskId && handoffTaskId !== taskId) errors.push(`task_id mismatch: ${handoffTaskId}`);
  }
}

function requireCommon(input: JsonObject, runId: string, taskId: string | undefined, errors: string[]): void {
  checkRunAndTask(input, runId, taskId, errors);
  stringField(input, "from", errors);
  stringField(input, "to", errors);
  stringField(input, "summary", errors);
  arrayField(input, "evidence", errors);
}

export function validateHandoff(role: HandoffRole, value: unknown, runId: string, taskId?: string): HandoffValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { passed: false, errors: ["handoff must be a JSON object"] };

  requireCommon(value, runId, taskId, errors);

  if (role === "dev") {
    statusField(value, ["ready", "blocked"], errors);
    arrayField(value, "files_changed", errors);
    arrayField(value, "commands", errors);
    arrayField(value, "verification", errors);
    stringField(value, "next_state", errors);
  } else if (role === "qa") {
    statusField(value, ["pass", "fail", "blocked"], errors);
    arrayField(value, "commands", errors);
    arrayField(value, "failures", errors);
    stringField(value, "next_state", errors);
  } else if (role === "reviewer") {
    statusField(value, ["approved", "changes_requested", "blocked"], errors);
    arrayField(value, "findings", errors);
    stringField(value, "next_state", errors);
  } else if (role === "archive") {
    statusField(value, ["archived", "blocked"], errors);
    stringField(value, "archive_report", errors);
    arrayField(value, "project_updates", errors);
    arrayField(value, "blocked_items", errors);
    stringField(value, "next_state", errors);
  } else if (role === "conflict-resolver") {
    statusField(value, ["resolved", "blocked"], errors);
    arrayField(value, "resolved_files", errors);
    arrayField(value, "commands", errors);
    arrayField(value, "evidence", errors);
    stringField(value, "next_state", errors);
  } else if (role === "committer") {
    statusField(value, ["ready", "blocked"], errors);
    stringField(value, "commit_mode", errors);
    stringField(value, "next_state", errors);
  } else if (role === "risk-reviewer") {
    statusField(value, ["ready", "blocked", "needs_replan"], errors);
    arrayField(value, "risks", errors);
    arrayField(value, "required_changes", errors);
    stringField(value, "next_state", errors);
  } else if (role === "technical-writer") {
    statusField(value, ["ready", "not_needed", "blocked"], errors);
    arrayField(value, "docs_changed", errors);
    stringField(value, "reason", errors);
    stringField(value, "next_state", errors);
  } else if (role === "project-knowledge-updater") {
    statusField(value, ["ready", "blocked"], errors);
    arrayField(value, "updated_files", errors);
    stringField(value, "next_state", errors);
  }

  return { passed: errors.length === 0, errors };
}
