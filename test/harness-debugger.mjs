import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileRun } from "../dist/core/reconcile.js";
import { status as readStatus } from "../dist/core/status.js";
import { writeHarnessDebuggerReport } from "../dist/core/harness-debugger.js";

function makeRun(prefix = "imfine-harness-debugger-") {
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
    source: { type: "text", value: "debug fixture" },
    created_at: "2026-01-01T00:00:00.000Z"
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "request", "normalized.md"), "debug fixture\n");
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({
    schema_version: 1,
    current_run_id: runId
  }, null, 2) + "\n");
  return { cwd, runId };
}

const { cwd, runId } = makeRun();
const result = reconcileRun(cwd, runId);
assert.equal(result.status, "blocked");

const report = writeHarnessDebuggerReport(cwd, runId);
assert.ok(fs.existsSync(report.overview));
assert.ok(fs.existsSync(report.detail));
assert.ok(result.files.includes(report.overview));
assert.ok(result.files.includes(report.detail));

const detail = JSON.parse(fs.readFileSync(report.detail, "utf8"));
assert.equal(detail.claim_integrity, "all_claims_have_evidence_refs");
assert.ok(detail.claims.length > 0);
assert.ok(detail.claims.every((item) => item.artifact_refs.length > 0 || item.trace_refs.length > 0));
assert.ok(detail.primary_blocker);
assert.ok(detail.recent_blocker_trace.length > 0);

const overview = fs.readFileSync(report.overview, "utf8");
assert.match(overview, /## 当前结论/);
assert.match(overview, /## 证据链/);
assert.match(overview, /## 建议动作/);

const current = readStatus(cwd);
assert.ok(current.currentRunHarnessDebugger);
assert.ok(fs.existsSync(current.currentRunHarnessDebugger.overview));
assert.ok(fs.existsSync(current.currentRunHarnessDebugger.detail));
assert.equal(current.currentRunHarnessDebugger.primaryBlocker, report.primaryBlocker);

console.log("harness debugger ok");
