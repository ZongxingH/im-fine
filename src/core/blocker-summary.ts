import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateAgentHandoff } from "./handoff-evidence.js";
import { providerReceipts, validateProviderReceipt } from "./provider-evidence.js";

interface SummarySource {
  id: string;
  file: string;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function collectErrors(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const errors = object.errors;
  if (Array.isArray(errors)) return errors.map(String);
  if (object.blocked === true && typeof object.blocked_reason === "string") return [object.blocked_reason];
  const blockers = object.blockers;
  if (Array.isArray(blockers)) {
    return blockers.map((item) => {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return String(record.reason || record.type || JSON.stringify(record));
      }
      return String(item);
    });
  }
  const checks = object.checks;
  if (Array.isArray(checks)) {
    return checks
      .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).status !== "pass")
      .map((item) => {
        const record = item as Record<string, unknown>;
        return `${String(record.id || "check")}: ${String(record.detail || record.status || "blocked")}`;
      });
  }
  const gates = object.gates;
  if (gates && typeof gates === "object" && !Array.isArray(gates)) {
    return Object.entries(gates as Record<string, unknown>)
      .filter(([, value]) => value !== "pass")
      .map(([key, value]) => `${key}: ${String(value)}`);
  }
  return [];
}

function currentHandoffErrors(cwd: string, runId: string): string[] {
  const root = runDir(cwd, runId);
  const dispatchFile = path.join(root, "orchestration", "dispatch-contracts.json");
  if (!fs.existsSync(dispatchFile)) return [];
  const dispatch = readJson(dispatchFile) as { contracts?: Array<Record<string, unknown>> };
  const contracts = Array.isArray(dispatch.contracts) ? dispatch.contracts : [];
  return contracts
    .filter((contract) => contract.kind !== "runtime")
    .filter((contract) => {
      const handoffFile = typeof contract.expected_handoff_path === "string" ? contract.expected_handoff_path : "";
      return contract.status === "done" || (handoffFile.length > 0 && fs.existsSync(handoffFile));
    })
    .flatMap((contract) => {
      const id = typeof contract.id === "string" ? contract.id : typeof contract.action_id === "string" ? contract.action_id : "agent";
      const role = typeof contract.role === "string" ? contract.role : "";
      const taskId = typeof contract.task_id === "string" ? contract.task_id : undefined;
      const handoffFile = typeof contract.expected_handoff_path === "string" ? contract.expected_handoff_path : undefined;
      const validation = validateAgentHandoff({ id, role, taskId, handoffFile }, root, runId);
      return validation.passed ? [] : validation.errors.map((error) => `${id}: ${error}`);
    });
}

function sourceErrors(cwd: string, runId: string, source: SummarySource): string[] {
  if (source.id === "provider-capability") {
    const validReceipts = providerReceipts(cwd, runId).filter((receipt) => validateProviderReceipt(cwd, receipt).valid);
    if (validReceipts.length > 0) return [];
  }
  if (source.id === "handoff-validation") return currentHandoffErrors(cwd, runId);
  return collectErrors(readJson(source.file));
}

export function writeBlockerSummary(cwd: string, runId: string): string {
  const file = path.join(runDir(cwd, runId), "orchestration", "blocker-summary.json");
  writeText(file, `${JSON.stringify(blockerSummary(cwd, runId), null, 2)}\n`);
  return file;
}

export function blockerSummary(cwd: string, runId: string): {
  schema_version: 1;
  run_id: string;
  generated_at: string;
  status: "blocked" | "clear";
  diagnostic_docs: string[];
  sources: Array<{ id: string; file: string; blockers: Array<{ reason: string; owner: string; required_evidence: string[]; suggested_agent: string; diagnostic_doc: string }> }>;
} {
  const root = runDir(cwd, runId);
  const orchestration = path.join(root, "orchestration");
  const sources: SummarySource[] = [
    { id: "state-blockers", file: path.join(orchestration, "state-blockers.json") },
    { id: "session-validation", file: path.join(orchestration, "session-validation.json") },
    { id: "provider-capability", file: path.join(orchestration, "provider-capability.json") },
    { id: "handoff-validation", file: path.join(orchestration, "handoff-validation.json") },
    { id: "final-gates", file: path.join(orchestration, "final-gates.json") }
  ];
  const summaries = sources
    .filter((source) => fs.existsSync(source.file))
    .map((source) => ({
      id: source.id,
      file: rel(cwd, source.file),
      blockers: sourceErrors(cwd, runId, source).map((blocker) => ({
        reason: blocker,
        owner: source.id.includes("provider") ? "orchestrator" : source.id.includes("handoff") ? "agent" : "runtime",
        required_evidence: source.id.includes("provider") ? ["orchestration/provider-receipts/"] : [rel(cwd, source.file)],
        suggested_agent: source.id.includes("handoff") ? "current action agent" : "orchestrator",
        diagnostic_doc: source.id.includes("provider")
          ? "docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md#14-runtime-和-agent-边界"
          : source.id.includes("handoff")
            ? "docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md#91-orchestrator-agent"
            : "docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md#15-gate-体系"
      }))
    }));
  ensureDir(orchestration);
  return {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    status: summaries.some((summary) => summary.blockers.length > 0) ? "blocked" : "clear",
    diagnostic_docs: [
      "docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md"
    ],
    sources: summaries
  };
}
