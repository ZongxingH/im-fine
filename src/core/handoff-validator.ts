import { roleContract, type RuntimeRole } from "./role-registry.js";

export type HandoffRole = RuntimeRole;

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
  const expectedTaskId = taskId || "run";
  const handoffTaskId = stringField(input, "task_id", errors);
  if (handoffTaskId && handoffTaskId !== expectedTaskId) errors.push(`task_id mismatch: ${handoffTaskId}`);
}

function requireCommon(input: JsonObject, runId: string, taskId: string | undefined, errors: string[]): void {
  checkRunAndTask(input, runId, taskId, errors);
  stringField(input, "role", errors);
  stringField(input, "from", errors);
  stringField(input, "to", errors);
  stringField(input, "summary", errors);
  arrayField(input, "commands", errors);
  arrayField(input, "evidence", errors);
  stringField(input, "next_state", errors);
}

export function validateHandoff(role: HandoffRole, value: unknown, runId: string, taskId?: string): HandoffValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { passed: false, errors: ["handoff must be a JSON object"] };

  requireCommon(value, runId, taskId, errors);
  const contract = roleContract(role);
  for (const field of contract.requiredStringFields) stringField(value, field, errors);
  for (const field of contract.requiredArrayFields) arrayField(value, field, errors);

  const from = typeof value.from === "string" ? value.from : "";
  if (from && from !== role) errors.push(`from mismatch: ${from}`);
  const handoffRole = typeof value.role === "string" ? value.role : "";
  if (handoffRole && handoffRole !== role) errors.push(`role mismatch: ${handoffRole}`);
  statusField(value, contract.statuses, errors);

  return { passed: errors.length === 0, errors };
}
