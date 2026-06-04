import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileRun } from "../dist/core/reconcile.js";
import { status as readStatus } from "../dist/core/status.js";
import { appendRuntimeTraceEvent, readRuntimeTraceEvents, runtimeTraceFiles } from "../dist/core/trace-events.js";
import { staleTrueHarnessEvidence, writeTrueHarnessEvidence } from "../dist/core/true-harness-evidence.js";

function makeRun(prefix = "imfine-runtime-trace-") {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const runId = "run-1";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "request"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "planned",
    execution_mode: "true_harness",
    project_kind: "existing_project",
    source: { type: "text", value: "trace fixture" },
    created_at: "2026-01-01T00:00:00.000Z"
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "request", "normalized.md"), "trace fixture\n");
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({
    schema_version: 1,
    current_run_id: runId
  }, null, 2) + "\n");
  return { cwd, runId, runDir };
}

{
  const { cwd, runId } = makeRun();
  const result = reconcileRun(cwd, runId);
  const files = runtimeTraceFiles(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.ok(fs.existsSync(files.runTrace));
  assert.ok(fs.existsSync(files.gateTrace));
  assert.ok(result.files.includes(files.runTrace));
  assert.ok(result.files.includes(files.gateTrace));

  const runEvents = readRuntimeTraceEvents(cwd, runId, "run");
  const gateEvents = readRuntimeTraceEvents(cwd, runId, "gate");
  assert.ok(runEvents.some((event) => event.event_type === "ingest"));
  assert.ok(runEvents.some((event) => event.event_type === "artifact_written" && event.component_id === "runtime.true-harness-evidence"));
  assert.ok(runEvents.some((event) => event.event_type === "gate_evaluated"));
  assert.ok(runEvents.some((event) => event.event_type === "finalization"));
  assert.ok(gateEvents.some((event) => event.status === "blocked"));
  assert.ok(gateEvents.some((event) => event.action_id === "gate.runtime_requirements" && event.status === "blocked"));

  const current = readStatus(cwd);
  assert.ok(current.currentRunRecentBlockerTrace.length > 0);
  assert.equal(current.currentRunRecentBlockerTrace[0].outputArtifacts.includes(path.relative(cwd, path.join(cwd, ".imfine", "runs", runId, "orchestration", "final-gates.json"))), true);
}

{
  const { cwd, runId, runDir } = makeRun("imfine-runtime-trace-stale-");
  const session = path.join(runDir, "orchestration", "orchestrator-session.json");
  fs.writeFileSync(session, JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "planned"
  }, null, 2) + "\n");
  const evidence = writeTrueHarnessEvidence(cwd, runId);
  fs.writeFileSync(session, JSON.stringify({
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "changed-after-evidence"
  }, null, 2) + "\n");
  appendRuntimeTraceEvent(cwd, runId, {
    source: "test.runtime-trace",
    componentId: "runtime.ingest-orchestrator-session",
    actionId: "test.modify_orchestrator_session",
    eventType: "artifact_written",
    status: "recorded",
    reason: "test changed orchestrator session after evidence",
    outputArtifacts: [session]
  });
  const stale = staleTrueHarnessEvidence(evidence.json);
  assert.ok(stale.some((item) => item.includes("orchestrator_session")));
  assert.ok(stale.some((item) => item.includes("trace_source=test.runtime-trace")));
  assert.ok(stale.some((item) => item.includes("action=test.modify_orchestrator_session")));
}

console.log("runtime trace ok");
