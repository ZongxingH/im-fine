import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

export type ProviderName = "codex" | "claude" | "unknown";
export type SubagentSupport = "supported" | "unsupported" | "unknown";
export type ProviderReceiptStatus = "waiting_for_agent_output" | "completed" | "blocked" | "failed";

export interface ProviderCapabilitySnapshot {
  schema_version: 1;
  run_id: string;
  provider: ProviderName;
  entry_installed: boolean | "unknown";
  subagent_supported: SubagentSupport;
  detection_source: string;
  detected_at: string;
  blocked: boolean;
  blocked_reason?: string;
}

export interface ProviderExecutionReceipt {
  schema_version: 1;
  run_id: string;
  action_id: string;
  agent_id: string;
  role: string;
  task_id?: string;
  parallel_group: string;
  provider: ProviderName;
  provider_agent_id: string;
  provider_session_id: string;
  status: ProviderReceiptStatus;
  metadata: Record<string, unknown>;
  recorded_at: string;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function normalizeProvider(value: string | undefined): ProviderName {
  if (value === "codex" || value === "claude") return value;
  return "unknown";
}

function normalizeSubagentSupport(value: string | undefined): SubagentSupport {
  if (!value) return "unknown";
  const normalized = value.toLowerCase();
  if (["true", "1", "supported", "yes"].includes(normalized)) return "supported";
  if (["false", "0", "unsupported", "no"].includes(normalized)) return "unsupported";
  return "unknown";
}

function providerEntryInstalled(provider: ProviderName): boolean | "unknown" {
  if (provider === "codex") return fs.existsSync(path.join(process.env.HOME || "", ".codex", "skills", "imfine", "SKILL.md"));
  if (provider === "claude") return fs.existsSync(path.join(process.env.HOME || "", ".claude", "commands", "imfine.md"));
  return "unknown";
}

export function providerCapabilityFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "orchestration", "provider-capability.json");
}

export function writeProviderCapabilitySnapshot(cwd: string, runId: string): ProviderCapabilitySnapshot {
  const provider = normalizeProvider(process.env.IMFINE_PROVIDER);
  const subagentSupport = normalizeSubagentSupport(process.env.IMFINE_SUBAGENT_SUPPORTED);
  const blocked = subagentSupport === "unsupported";
  const snapshot: ProviderCapabilitySnapshot = {
    schema_version: 1,
    run_id: runId,
    provider,
    entry_installed: providerEntryInstalled(provider),
    subagent_supported: subagentSupport,
    detection_source: "environment_and_installed_entry_probe",
    detected_at: new Date().toISOString(),
    blocked,
    blocked_reason: blocked ? "current provider explicitly reports unsupported native subagent dispatch" : undefined
  };
  const file = providerCapabilityFile(cwd, runId);
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

export function readProviderCapabilitySnapshot(cwd: string, runId: string): ProviderCapabilitySnapshot | null {
  const file = providerCapabilityFile(cwd, runId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as ProviderCapabilitySnapshot;
}

function receiptDir(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "orchestration", "provider-receipts");
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
}

export function providerReceiptFile(cwd: string, runId: string, actionId: string): string {
  return path.join(receiptDir(cwd, runId), `${safeFilePart(actionId)}.json`);
}

export function writeProviderExecutionReceipt(cwd: string, runId: string, input: {
  actionId: string;
  agentId: string;
  role: string;
  taskId?: string;
  parallelGroup: string;
  status: ProviderReceiptStatus;
  metadata?: Record<string, unknown>;
}): ProviderExecutionReceipt {
  const capability = readProviderCapabilitySnapshot(cwd, runId) || writeProviderCapabilitySnapshot(cwd, runId);
  const receipt: ProviderExecutionReceipt = {
    schema_version: 1,
    run_id: runId,
    action_id: input.actionId,
    agent_id: input.agentId,
    role: input.role,
    task_id: input.taskId,
    parallel_group: input.parallelGroup,
    provider: capability.provider,
    provider_agent_id: process.env.IMFINE_PROVIDER_AGENT_ID || `${capability.provider}:${input.agentId}`,
    provider_session_id: process.env.IMFINE_PROVIDER_SESSION_ID || process.env.TERM_SESSION_ID || `${capability.provider}:current-session`,
    status: input.status,
    metadata: input.metadata || {},
    recorded_at: new Date().toISOString()
  };
  const file = providerReceiptFile(cwd, runId, input.actionId);
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function providerReceipts(cwd: string, runId: string): ProviderExecutionReceipt[] {
  const dir = receiptDir(cwd, runId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as ProviderExecutionReceipt);
}
