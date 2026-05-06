import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

export type LockScope = "run" | "action";
export type CheckpointPhase = "before" | "after";
export type CheckpointStatus = "started" | "completed" | "waiting_for_model" | "blocked" | "failed";

export interface LockHandle {
  acquired: boolean;
  recoveredStale: boolean;
  key: string;
  token: string;
  file: string;
  reason?: string;
}

export interface CheckpointRecord {
  schema_version: 1;
  run_id: string;
  action_id: string;
  phase: CheckpointPhase;
  status: CheckpointStatus;
  detail: string;
  artifacts: string[];
  recorded_at: string;
}

interface ActionLedger {
  schema_version: 1;
  run_id: string;
  updated_at: string;
  actions: Record<string, {
    action_id: string;
    status: CheckpointStatus;
    detail: string;
    artifacts: string[];
    updated_at: string;
  }>;
  history: Array<Record<string, unknown>>;
}

interface LockRecord {
  key: string;
  run_id: string;
  scope: LockScope;
  action_id?: string;
  token: string;
  owner: string;
  acquired_at: string;
  expires_at: string;
}

interface LockFile {
  schema_version: 1;
  updated_at: string;
  locks: Record<string, LockRecord>;
  history: Array<Record<string, unknown>>;
}

function stateDir(cwd: string): string {
  return path.join(cwd, ".imfine", "state");
}

function lockFile(cwd: string): string {
  return path.join(stateDir(cwd), "locks.json");
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function readLocks(cwd: string): LockFile {
  const file = lockFile(cwd);
  if (!fs.existsSync(file)) {
    return { schema_version: 1, updated_at: new Date().toISOString(), locks: {}, history: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<LockFile>;
  return {
    schema_version: 1,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
    locks: parsed.locks && typeof parsed.locks === "object" && !Array.isArray(parsed.locks) ? parsed.locks : {},
    history: Array.isArray(parsed.history) ? parsed.history : []
  };
}

function writeLocks(cwd: string, value: LockFile): void {
  ensureDir(stateDir(cwd));
  writeText(lockFile(cwd), `${JSON.stringify({ ...value, updated_at: new Date().toISOString() }, null, 2)}\n`);
}

function lockKey(runId: string, scope: LockScope, actionId?: string): string {
  return scope === "run" ? `run:${runId}` : `action:${runId}:${actionId || "unknown"}`;
}

function lockOwner(): string {
  return `${process.pid}@${process.env.USER || "unknown"}`;
}

function token(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function expired(record: LockRecord, now: Date): boolean {
  return Number.isNaN(Date.parse(record.expires_at)) || Date.parse(record.expires_at) <= now.getTime();
}

export function acquireLock(cwd: string, runId: string, scope: LockScope, actionId?: string, ttlMs = 15 * 60 * 1000): LockHandle {
  const file = lockFile(cwd);
  const locks = readLocks(cwd);
  const now = new Date();
  const key = lockKey(runId, scope, actionId);
  const existing = locks.locks[key];
  const lockToken = token();

  if (existing && !expired(existing, now)) {
    return {
      acquired: false,
      recoveredStale: false,
      key,
      token: lockToken,
      file,
      reason: `lock is held until ${existing.expires_at}`
    };
  }

  const recoveredStale = Boolean(existing);
  if (existing) {
    locks.history.push({
      event: "stale_lock_recovered",
      key,
      previous_owner: existing.owner,
      previous_expires_at: existing.expires_at,
      recovered_at: now.toISOString()
    });
  }

  locks.locks[key] = {
    key,
    run_id: runId,
    scope,
    action_id: actionId,
    token: lockToken,
    owner: lockOwner(),
    acquired_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString()
  };
  locks.history.push({
    event: "lock_acquired",
    key,
    scope,
    action_id: actionId,
    owner: lockOwner(),
    acquired_at: now.toISOString()
  });
  writeLocks(cwd, locks);

  return { acquired: true, recoveredStale, key, token: lockToken, file };
}

export function releaseLock(cwd: string, handle: LockHandle): void {
  if (!handle.acquired) return;
  const locks = readLocks(cwd);
  const existing = locks.locks[handle.key];
  if (existing?.token !== handle.token) return;
  delete locks.locks[handle.key];
  locks.history.push({
    event: "lock_released",
    key: handle.key,
    owner: lockOwner(),
    released_at: new Date().toISOString()
  });
  writeLocks(cwd, locks);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "action";
}

function actionLedgerFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "orchestration", "action-ledger.json");
}

function readActionLedger(cwd: string, runId: string): ActionLedger {
  const file = actionLedgerFile(cwd, runId);
  if (!fs.existsSync(file)) {
    return {
      schema_version: 1,
      run_id: runId,
      updated_at: new Date().toISOString(),
      actions: {},
      history: []
    };
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ActionLedger>;
  return {
    schema_version: 1,
    run_id: runId,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
    actions: parsed.actions && typeof parsed.actions === "object" && !Array.isArray(parsed.actions) ? parsed.actions as ActionLedger["actions"] : {},
    history: Array.isArray(parsed.history) ? parsed.history : []
  };
}

export function readActionStatus(cwd: string, runId: string, actionId: string): CheckpointStatus | undefined {
  return readActionLedger(cwd, runId).actions[actionId]?.status;
}

export function isActionCompleted(cwd: string, runId: string, actionId: string): boolean {
  return readActionStatus(cwd, runId, actionId) === "completed";
}

export function recordActionStatus(cwd: string, runId: string, actionId: string, status: CheckpointStatus, detail: string, artifacts: string[] = []): string {
  const file = actionLedgerFile(cwd, runId);
  const ledger = readActionLedger(cwd, runId);
  const now = new Date().toISOString();
  ledger.actions[actionId] = {
    action_id: actionId,
    status,
    detail,
    artifacts,
    updated_at: now
  };
  ledger.history.push({
    action_id: actionId,
    status,
    detail,
    recorded_at: now
  });
  writeText(file, `${JSON.stringify({ ...ledger, updated_at: now }, null, 2)}\n`);
  return file;
}

export function writeCheckpoint(cwd: string, runId: string, actionId: string, phase: CheckpointPhase, status: CheckpointStatus, detail: string, artifacts: string[] = []): string {
  const dir = path.join(runDir(cwd, runId), "orchestration", "checkpoints");
  ensureDir(dir);
  const now = new Date().toISOString();
  const record: CheckpointRecord = {
    schema_version: 1,
    run_id: runId,
    action_id: actionId,
    phase,
    status,
    detail,
    artifacts,
    recorded_at: now
  };
  const file = path.join(dir, `${now.replace(/[:.]/g, "-")}-${safeFilePart(actionId)}-${phase}.json`);
  writeText(file, `${JSON.stringify(record, null, 2)}\n`);
  writeText(path.join(dir, "latest.json"), `${JSON.stringify({ ...record, file }, null, 2)}\n`);
  if (phase === "after") recordActionStatus(cwd, runId, actionId, status, detail, artifacts);
  return file;
}

export function readLatestCheckpoint(cwd: string, runId: string): (CheckpointRecord & { file: string }) | null {
  const file = path.join(runDir(cwd, runId), "orchestration", "checkpoints", "latest.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as CheckpointRecord & { file: string };
}
