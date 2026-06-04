import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { staleTrueHarnessEvidence } from "./true-harness-evidence.js";
import { latestBlockerTrace, runtimeTraceFiles, type RuntimeTraceEvent } from "./trace-events.js";

export interface HarnessDebugClaim {
  id: string;
  claim: string;
  status: "pass" | "blocked" | "missing" | "recorded";
  artifact_refs: string[];
  trace_refs: string[];
}

export interface HarnessDebuggerResult {
  runId: string;
  overview: string;
  detail: string;
  runStatus: string;
  primaryBlocker: string | null;
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

function traceRef(event: RuntimeTraceEvent): string {
  return `${event.event_id}:${event.source}:${event.component_id}:${event.action_id}`;
}

function existingRel(cwd: string, files: string[]): string[] {
  return files.filter((file) => fs.existsSync(file)).map((file) => rel(cwd, file));
}

function claim(id: string, text: string, status: HarnessDebugClaim["status"], artifacts: string[], traces: string[]): HarnessDebugClaim {
  return {
    id,
    claim: text,
    status,
    artifact_refs: artifacts,
    trace_refs: traces
  };
}

function gateClaims(cwd: string, root: string, blockers: RuntimeTraceEvent[]): HarnessDebugClaim[] {
  const finalGates = path.join(root, "orchestration", "final-gates.json");
  if (!fs.existsSync(finalGates)) {
    return [claim("final_gates", "runtime final gates have not been generated", "missing", [rel(cwd, finalGates)], blockers.map(traceRef))];
  }
  const parsed = readJson<{ gates?: Record<string, unknown>; checks?: Array<{ id?: unknown; status?: unknown; detail?: unknown; component_id?: unknown }> }>(finalGates);
  const gates = parsed.gates || {};
  const result: HarnessDebugClaim[] = Object.entries(gates).map(([id, status]) => {
    const related = blockers.filter((event) => event.action_id === `gate.${id}`);
    return claim(
      `gate.${id}`,
      `final gate ${id} is ${String(status)}`,
      String(status) === "pass" ? "pass" : "blocked",
      [rel(cwd, finalGates)],
      related.map(traceRef)
    );
  });
  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
  for (const check of checks.filter((item) => item.status === "blocked")) {
    const id = typeof check.id === "string" ? check.id : "unknown";
    if (result.some((item) => item.id === `gate.${id}`)) continue;
    const related = blockers.filter((event) => event.action_id === `gate.${id}`);
    result.push(claim(
      `gate.${id}`,
      `runtime check ${id} is blocked: ${String(check.detail || "unknown")}`,
      "blocked",
      [rel(cwd, finalGates)],
      related.map(traceRef)
    ));
  }
  return result;
}

function evidenceClaims(cwd: string, root: string, blockers: RuntimeTraceEvent[]): HarnessDebugClaim[] {
  const orchestration = path.join(root, "orchestration");
  const trueHarness = path.join(orchestration, "true-harness-evidence.json");
  const qualityLineage = path.join(orchestration, "quality-lineage.json");
  const runtimeRequirements = path.join(orchestration, "runtime-requirements.json");
  const receiptDir = path.join(orchestration, "provider-receipts");
  const agentsDir = path.join(root, "agents");
  const handoffFiles = fs.existsSync(path.join(root, "agents"))
    ? fs.readdirSync(path.join(root, "agents"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, "agents", entry.name, "handoff.json"))
    : [];
  const stale = fs.existsSync(trueHarness) ? staleTrueHarnessEvidence(trueHarness) : [];
  const runtime = optionalJson<{ status?: unknown; checks?: Array<{ id?: unknown; status?: unknown; detail?: unknown }> }>(runtimeRequirements);
  const quality = optionalJson<{ summary?: Record<string, unknown> }>(qualityLineage);
  return [
    claim(
      "true_harness_evidence",
      stale.length > 0 ? `true harness evidence is stale: ${stale.join("; ")}` : fs.existsSync(trueHarness) ? "true harness evidence is fresh" : "true harness evidence is missing",
      stale.length > 0 ? "blocked" : fs.existsSync(trueHarness) ? "pass" : "missing",
      existingRel(cwd, [trueHarness]),
      blockers.filter((event) => event.component_id === "runtime.true-harness-evidence").map(traceRef)
    ),
    claim(
      "quality_lineage",
      quality?.summary ? `quality lineage qa=${String(quality.summary.qa)} review=${String(quality.summary.review)} recheck=${String(quality.summary.recheck_fix_loop)}` : "quality lineage is missing",
      quality?.summary && quality.summary.qa === "pass" && quality.summary.review === "pass" && quality.summary.recheck_fix_loop === "pass" ? "pass" : quality?.summary ? "blocked" : "missing",
      existingRel(cwd, [qualityLineage]),
      blockers.filter((event) => event.component_id === "runtime.quality-lineage").map(traceRef)
    ),
    claim(
      "runtime_requirements",
      runtime ? `runtime requirements status=${String(runtime.status)}` : "runtime requirements are missing",
      runtime?.status === "pass" ? "pass" : runtime ? "blocked" : "missing",
      existingRel(cwd, [runtimeRequirements]),
      blockers.filter((event) => event.component_id === "runtime.runtime-requirements").map(traceRef)
    ),
    claim(
      "provider_receipts",
      fs.existsSync(receiptDir) ? `provider receipt files=${fs.readdirSync(receiptDir).filter((item) => item.endsWith(".json")).length}` : "provider receipts are missing",
      fs.existsSync(receiptDir) && fs.readdirSync(receiptDir).some((item) => item.endsWith(".json")) ? "recorded" : "missing",
      fs.existsSync(receiptDir) ? [rel(cwd, receiptDir)] : [rel(cwd, receiptDir)],
      blockers.filter((event) => event.component_id === "provider.origin-receipts").map(traceRef)
    ),
    claim(
      "handoffs",
      `agent handoff files=${handoffFiles.filter((file) => fs.existsSync(file)).length}`,
      handoffFiles.some((file) => fs.existsSync(file)) ? "recorded" : "missing",
      handoffFiles.length > 0 ? handoffFiles.map((file) => rel(cwd, file)) : [rel(cwd, agentsDir)],
      blockers.filter((event) => event.component_id === "runtime.handoff-validation").map(traceRef)
    )
  ];
}

function nextActions(primary: HarnessDebugClaim | null): string[] {
  if (!primary) return ["重新运行 reconcile，生成最新 runtime artifacts 与 trace。"];
  if (primary.id.includes("runtime_requirements")) return ["补齐运行时版本声明、QA 实际命令、运行时版本输出和测试输出，然后重新运行 reconcile。"];
  if (primary.id.includes("provider") || primary.id.includes("dispatch") || primary.id.includes("true_harness")) return ["补齐 provider-origin receipt、agent handoff 与 dispatch wave 证据，然后重新运行 reconcile。"];
  if (primary.id.includes("quality") || primary.id.includes("qa") || primary.id.includes("review")) return ["让 QA/Review 按 finding lineage 补写 recheck handoff 与证据，然后重新运行 reconcile。"];
  if (primary.id.includes("commit") || primary.id.includes("push")) return ["补齐提交与推送证据，然后重新运行 reconcile。"];
  return ["处理 primary blocker 指向的证据缺口，然后重新运行 reconcile。"];
}

export function writeHarnessDebuggerReport(cwd: string, runId: string): HarnessDebuggerResult {
  const root = runDir(cwd, runId);
  const analysisDir = path.join(root, "analysis");
  ensureDir(analysisDir);
  const run = readJson<{ status?: unknown }>(path.join(root, "run.json"));
  const runStatus = typeof run.status === "string" ? run.status : "unknown";
  const blockers = latestBlockerTrace(cwd, runId, 20);
  const claims = [
    ...gateClaims(cwd, root, blockers),
    ...evidenceClaims(cwd, root, blockers)
  ];
  const primary = claims.find((item) => item.status === "blocked") || claims.find((item) => item.status === "missing") || null;
  const traceFiles = runtimeTraceFiles(cwd, runId);
  const detail = path.join(analysisDir, "harness-debug-detail.json");
  const overview = path.join(analysisDir, "harness-debug-overview.md");
  const payload = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    run_status: runStatus,
    primary_blocker: primary,
    trace_files: {
      run_trace: rel(cwd, traceFiles.runTrace),
      gate_trace: rel(cwd, traceFiles.gateTrace)
    },
    recent_blocker_trace: blockers.map((event) => ({
      event_id: event.event_id,
      source: event.source,
      component_id: event.component_id,
      action_id: event.action_id,
      reason: event.reason,
      output_artifacts: event.output_artifacts
    })),
    claims,
    claim_integrity: claims.every((item) => item.artifact_refs.length > 0 || item.trace_refs.length > 0) ? "all_claims_have_evidence_refs" : "claim_without_evidence_ref"
  };
  writeText(detail, `${JSON.stringify(payload, null, 2)}\n`);
  writeText(overview, `# Harness Debug Overview

## 当前结论

- run status: ${runStatus}
- primary blocker: ${primary ? `${primary.id}: ${primary.claim}` : "none"}
- detail: ${rel(cwd, detail)}

## 证据链

${claims.map((item) => `- ${item.status}: ${item.id}; claim=${item.claim}; artifacts=${item.artifact_refs.join(", ") || "none"}; traces=${item.trace_refs.join(", ") || "none"}`).join("\n")}

## 建议动作

${nextActions(primary).map((item, index) => `${index + 1}. ${item}`).join("\n")}
`);
  return {
    runId,
    overview,
    detail,
    runStatus,
    primaryBlocker: primary ? primary.id : null
  };
}
