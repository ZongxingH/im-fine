import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

export type ProviderName = "codex" | "claude" | "unknown";
export type SubagentSupport = "supported" | "unsupported" | "unknown";
export type ProviderReceiptStatus = "waiting_for_agent_output" | "completed" | "blocked" | "failed";
export type ProviderReceiptOrigin = "runtime_dispatch_record" | "provider_native_subagent" | "runtime_processed";
export type ProviderReceiptType = "dispatch_requested" | "provider_started" | "provider_completed" | "runtime_processed";

export interface ProviderReceiptIntegrity {
  nonce: string;
  output_sha256: string;
}

export interface ProviderCapabilitySnapshot {
  schema_version: 1;
  run_id: string;
  provider: ProviderName;
  entry_installed: boolean | "unknown";
  subagent_supported: SubagentSupport;
  capabilities: {
    supports_subagent: SubagentSupport;
    supports_parallel_subagent: SubagentSupport;
    supports_agent_file_output: SubagentSupport;
    supports_agent_wait: SubagentSupport;
    supports_agent_interrupt: SubagentSupport;
  };
  detection_source: string;
  detected_at: string;
  blocked: boolean;
  blocked_reason?: string;
  resolved_by_receipts?: boolean;
  resolved_receipt_count?: number;
  resolved_at?: string;
}

function capabilityValue(envName: string, fallback: SubagentSupport): SubagentSupport {
  return normalizeSubagentSupport(process.env[envName]) === "unknown" ? fallback : normalizeSubagentSupport(process.env[envName]);
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
  provider_trace_id?: string;
  provider_task_handle?: string;
  origin: ProviderReceiptOrigin;
  receipt_type: ProviderReceiptType;
  status: ProviderReceiptStatus;
  output_path: string;
  integrity?: ProviderReceiptIntegrity;
  started_at: string;
  completed_at?: string;
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
  const blocked = subagentSupport !== "supported";
  const capabilities = {
    supports_subagent: subagentSupport,
    supports_parallel_subagent: capabilityValue("IMFINE_SUPPORTS_PARALLEL_SUBAGENT", subagentSupport),
    supports_agent_file_output: capabilityValue("IMFINE_SUPPORTS_AGENT_FILE_OUTPUT", subagentSupport),
    supports_agent_wait: capabilityValue("IMFINE_SUPPORTS_AGENT_WAIT", subagentSupport),
    supports_agent_interrupt: capabilityValue("IMFINE_SUPPORTS_AGENT_INTERRUPT", "unknown")
  };
  const snapshot: ProviderCapabilitySnapshot = {
    schema_version: 1,
    run_id: runId,
    provider,
    entry_installed: providerEntryInstalled(provider),
    subagent_supported: subagentSupport,
    capabilities,
    detection_source: "environment_and_installed_entry_probe",
    detected_at: new Date().toISOString(),
    blocked,
    blocked_reason: blocked
      ? subagentSupport === "unsupported"
        ? "current provider explicitly reports unsupported native subagent dispatch"
        : "current provider has not confirmed native subagent dispatch support"
      : undefined
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

export function providerCapabilityResolutionFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "orchestration", "provider-capability-resolution.json");
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

function readExistingReceipt(cwd: string, runId: string, actionId: string): ProviderExecutionReceipt | null {
  const file = providerReceiptFile(cwd, runId, actionId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as ProviderExecutionReceipt;
}

function defaultOutputPath(cwd: string, runId: string, agentId: string): string {
  return path.join(runDir(cwd, runId), "agents", agentId, "handoff.json");
}

function isTerminalStatus(status: ProviderReceiptStatus): boolean {
  return status === "completed" || status === "blocked" || status === "failed";
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function randomNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function receiptTypeFor(origin: ProviderReceiptOrigin, status: ProviderReceiptStatus): ProviderReceiptType {
  if (origin === "provider_native_subagent") return status === "completed" ? "provider_completed" : "provider_started";
  if (origin === "runtime_dispatch_record") return "dispatch_requested";
  return "runtime_processed";
}

function defaultOrigin(status: ProviderReceiptStatus): ProviderReceiptOrigin {
  return status === "waiting_for_agent_output" ? "runtime_dispatch_record" : "runtime_processed";
}

function isSyntheticProviderValue(provider: ProviderName, value: string): boolean {
  if (!value.trim()) return true;
  return value === `${provider}:current-session` || value.startsWith(`${provider}:`);
}

function integrityPassed(cwd: string, receipt: ProviderExecutionReceipt): boolean {
  if (!receipt.integrity?.nonce || !receipt.integrity.output_sha256) return false;
  const output = path.isAbsolute(receipt.output_path) ? receipt.output_path : path.resolve(cwd, receipt.output_path);
  if (!fs.existsSync(output)) return false;
  return sha256File(output) === receipt.integrity.output_sha256;
}

export function writeProviderDispatchReceipt(cwd: string, runId: string, input: {
  actionId: string;
  agentId: string;
  role: string;
  taskId?: string;
  parallelGroup: string;
  metadata?: Record<string, unknown>;
}): ProviderExecutionReceipt {
  const existing = readExistingReceipt(cwd, runId, input.actionId);
  if (existing && isTerminalStatus(existing.status)) return existing;
  return writeProviderExecutionReceipt(cwd, runId, {
    ...input,
    status: "waiting_for_agent_output",
    outputPath: existing?.output_path,
    metadata: {
      ...(existing?.metadata || {}),
      ...(input.metadata || {}),
      dispatch_recorded: true
    }
  });
}

export function writeProviderExecutionReceipt(cwd: string, runId: string, input: {
  actionId: string;
  agentId: string;
  role: string;
  taskId?: string;
  parallelGroup: string;
  status: ProviderReceiptStatus;
  outputPath?: string;
  origin?: ProviderReceiptOrigin;
  receiptType?: ProviderReceiptType;
  providerAgentId?: string;
  providerSessionId?: string;
  providerTraceId?: string;
  providerTaskHandle?: string;
  integrity?: ProviderReceiptIntegrity;
  metadata?: Record<string, unknown>;
}): ProviderExecutionReceipt {
  const capability = readProviderCapabilitySnapshot(cwd, runId) || writeProviderCapabilitySnapshot(cwd, runId);
  const existing = readExistingReceipt(cwd, runId, input.actionId);
  if (existing && isTerminalStatus(existing.status) && existing.origin === "provider_native_subagent" && input.origin !== "provider_native_subagent") {
    return existing;
  }
  const now = new Date().toISOString();
  const origin = input.origin || existing?.origin || defaultOrigin(input.status);
  const outputPath = input.outputPath || existing?.output_path || defaultOutputPath(cwd, runId, input.agentId);
  const providerAgentId = input.providerAgentId || existing?.provider_agent_id || "";
  const providerSessionId = input.providerSessionId || existing?.provider_session_id || "";
  const receipt: ProviderExecutionReceipt = {
    schema_version: 1,
    run_id: runId,
    action_id: input.actionId,
    agent_id: input.agentId,
    role: input.role,
    task_id: input.taskId,
    parallel_group: input.parallelGroup,
    provider: capability.provider,
    provider_agent_id: providerAgentId,
    provider_session_id: providerSessionId,
    provider_trace_id: input.providerTraceId || existing?.provider_trace_id,
    provider_task_handle: input.providerTaskHandle || existing?.provider_task_handle,
    origin,
    receipt_type: input.receiptType || existing?.receipt_type || receiptTypeFor(origin, input.status),
    status: input.status,
    output_path: outputPath,
    integrity: input.integrity || existing?.integrity,
    started_at: existing?.started_at || now,
    completed_at: isTerminalStatus(input.status) ? now : existing?.completed_at,
    metadata: {
      ...(existing?.metadata || {}),
      ...(input.metadata || {})
    },
    recorded_at: now
  };
  const file = providerReceiptFile(cwd, runId, input.actionId);
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function writeProviderOriginReceipt(cwd: string, runId: string, input: {
  actionId: string;
  agentId: string;
  role: string;
  taskId?: string;
  parallelGroup: string;
  provider: ProviderName;
  providerAgentId: string;
  providerSessionId: string;
  providerTraceId?: string;
  providerTaskHandle: string;
  outputPath: string;
  metadata?: Record<string, unknown>;
}): ProviderExecutionReceipt {
  if (input.provider !== "codex" && input.provider !== "claude") {
    throw new Error("Provider-origin receipt requires provider codex or claude.");
  }
  if (!input.providerAgentId.trim()) throw new Error("Provider-origin receipt requires providerAgentId.");
  if (!input.providerSessionId.trim()) throw new Error("Provider-origin receipt requires providerSessionId.");
  if (!input.providerTaskHandle.trim()) throw new Error("Provider-origin receipt requires providerTaskHandle.");
  const output = path.isAbsolute(input.outputPath) ? input.outputPath : path.resolve(cwd, input.outputPath);
  if (!fs.existsSync(output)) throw new Error(`Provider-origin receipt output does not exist: ${input.outputPath}`);
  const capabilityFile = providerCapabilityFile(cwd, runId);
  const currentCapability = readProviderCapabilitySnapshot(cwd, runId);
  if (!currentCapability || currentCapability.provider !== input.provider) {
    const existingCapabilities = currentCapability?.capabilities || {
      supports_subagent: currentCapability?.subagent_supported || "unknown",
      supports_parallel_subagent: currentCapability?.subagent_supported || "unknown",
      supports_agent_file_output: currentCapability?.subagent_supported || "unknown",
      supports_agent_wait: currentCapability?.subagent_supported || "unknown",
      supports_agent_interrupt: "unknown" as const
    };
    const next: ProviderCapabilitySnapshot = {
      schema_version: 1,
      run_id: runId,
      provider: input.provider,
      entry_installed: providerEntryInstalled(input.provider),
      subagent_supported: currentCapability?.subagent_supported || "unknown",
      capabilities: existingCapabilities,
      detection_source: currentCapability?.detection_source || "provider_origin_receipt",
      detected_at: currentCapability?.detected_at || new Date().toISOString(),
      blocked: currentCapability?.blocked ?? true,
      blocked_reason: currentCapability?.blocked_reason
    };
    ensureDir(path.dirname(capabilityFile));
    writeText(capabilityFile, `${JSON.stringify(next, null, 2)}\n`);
  }
  return writeProviderExecutionReceipt(cwd, runId, {
    actionId: input.actionId,
    agentId: input.agentId,
    role: input.role,
    taskId: input.taskId,
    parallelGroup: input.parallelGroup,
    status: "completed",
    outputPath: input.outputPath,
    origin: "provider_native_subagent",
    receiptType: "provider_completed",
    providerAgentId: input.providerAgentId,
    providerSessionId: input.providerSessionId,
    providerTraceId: input.providerTraceId,
    providerTaskHandle: input.providerTaskHandle,
    integrity: {
      nonce: randomNonce(),
      output_sha256: sha256File(output)
    },
    metadata: {
      ...(input.metadata || {}),
      origin: "provider_native_subagent"
    }
  });
}

export function providerReceipts(cwd: string, runId: string): ProviderExecutionReceipt[] {
  const dir = receiptDir(cwd, runId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as ProviderExecutionReceipt);
}

function receiptOutputExists(cwd: string, receipt: ProviderExecutionReceipt): boolean {
  const output = path.isAbsolute(receipt.output_path) ? receipt.output_path : path.resolve(cwd, receipt.output_path);
  return fs.existsSync(output);
}

export function receiptProvesNativeSubagent(cwd: string, receipt: ProviderExecutionReceipt): boolean {
  return receipt.status === "completed"
    && receipt.provider !== "unknown"
    && receipt.origin === "provider_native_subagent"
    && receipt.receipt_type === "provider_completed"
    && !isSyntheticProviderValue(receipt.provider, receipt.provider_agent_id)
    && !isSyntheticProviderValue(receipt.provider, receipt.provider_session_id)
    && typeof receipt.provider_task_handle === "string"
    && receipt.provider_task_handle.trim().length > 0
    && receipt.output_path.trim().length > 0
    && receiptOutputExists(cwd, receipt)
    && integrityPassed(cwd, receipt);
}

export function resolveProviderCapabilityFromReceipts(cwd: string, runId: string): ProviderCapabilitySnapshot {
  const snapshot = readProviderCapabilitySnapshot(cwd, runId) || writeProviderCapabilitySnapshot(cwd, runId);
  const receipts = providerReceipts(cwd, runId);
  const proofReceipts = receipts.filter((receipt) => receiptProvesNativeSubagent(cwd, receipt));
  const resolvedByReceipts = proofReceipts.length > 0;
  const resolved = resolvedByReceipts
    ? {
      ...snapshot,
      provider: proofReceipts[0].provider,
      subagent_supported: "supported" as const,
      capabilities: {
        ...snapshot.capabilities,
        supports_subagent: "supported" as const,
        supports_agent_file_output: "supported" as const,
        supports_agent_wait: snapshot.capabilities?.supports_agent_wait || "unknown",
        supports_parallel_subagent: snapshot.capabilities?.supports_parallel_subagent || snapshot.subagent_supported,
        supports_agent_interrupt: snapshot.capabilities?.supports_agent_interrupt || "unknown"
      },
      detection_source: snapshot.subagent_supported === "supported" && snapshot.blocked === false
        ? snapshot.detection_source
        : "resolved_by_receipts",
      blocked: false,
      blocked_reason: undefined,
      resolved_by_receipts: true,
      resolved_receipt_count: proofReceipts.length,
      resolved_at: new Date().toISOString()
    }
    : {
      ...snapshot,
      capabilities: snapshot.capabilities || {
        supports_subagent: snapshot.subagent_supported,
        supports_parallel_subagent: snapshot.subagent_supported,
        supports_agent_file_output: snapshot.subagent_supported,
        supports_agent_wait: snapshot.subagent_supported,
        supports_agent_interrupt: "unknown" as const
      },
      resolved_by_receipts: false,
      resolved_receipt_count: 0
    };
  const capabilityFile = providerCapabilityFile(cwd, runId);
  const resolutionFile = providerCapabilityResolutionFile(cwd, runId);
  ensureDir(path.dirname(capabilityFile));
  writeText(capabilityFile, `${JSON.stringify(resolved, null, 2)}\n`);
  writeText(resolutionFile, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    provider: resolved.provider,
    subagent_supported: resolved.subagent_supported,
    capabilities: resolved.capabilities,
    blocked: resolved.blocked,
    blocked_reason: resolved.blocked_reason,
    resolved_by_receipts: resolvedByReceipts,
    resolved_receipt_count: proofReceipts.length,
    proof_receipts: proofReceipts.map((receipt) => ({
      action_id: receipt.action_id,
      agent_id: receipt.agent_id,
      role: receipt.role,
      provider: receipt.provider,
      provider_agent_id: receipt.provider_agent_id,
      provider_session_id: receipt.provider_session_id,
      provider_trace_id: receipt.provider_trace_id,
      provider_task_handle: receipt.provider_task_handle,
      origin: receipt.origin,
      receipt_type: receipt.receipt_type,
      output_path: receipt.output_path
    }))
  }, null, 2)}\n`);
  return resolved;
}
