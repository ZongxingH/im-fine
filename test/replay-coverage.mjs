import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const replayCoverage = [
  {
    issue: "H-001",
    fixture: "demo1-minimized / ingest-session",
    files: ["test/demo-replay.mjs"],
    layers: ["status", "reconcile"],
    blockedBehavior: "orchestrator session cannot make run completed without runtime ingest and gates"
  },
  {
    issue: "H-002",
    fixture: "ingest-session / ingest-completed-wave / planned-action-contract",
    files: ["test/demo-replay.mjs", "test/smoke.mjs"],
    layers: ["status", "true_harness_evidence"],
    blockedBehavior: "missing completed waves are reported by action id"
  },
  {
    issue: "H-003",
    fixture: "provider true harness negative / invalid receipt diagnostics",
    files: ["test/implementation-optimization.mjs"],
    layers: ["true_harness_evidence", "status"],
    blockedBehavior: "missing or invalid provider-origin receipt cannot pass true harness"
  },
  {
    issue: "H-004",
    fixture: "true harness freshness / provider output stale / standard evidence stale",
    files: ["test/implementation-optimization.mjs"],
    layers: ["status", "finalize"],
    blockedBehavior: "stale source artifact invalidates true harness evidence"
  },
  {
    issue: "H-005",
    fixture: "adopt-existing-handoff / invalid-handoff-evidence / markdown-only-report",
    files: ["test/demo-replay.mjs", "test/implementation-optimization.mjs"],
    layers: ["status", "reconcile", "true_harness_evidence"],
    blockedBehavior: "handoff must be valid and linked to evidence; markdown-only report is insufficient"
  },
  {
    issue: "H-006",
    fixture: "qa-recheck-lineage / review-recheck-lineage / recheck-without-lineage",
    files: ["test/reconcile.mjs", "test/implementation-optimization.mjs"],
    layers: ["reconcile", "status", "archive"],
    blockedBehavior: "recheck pass only closes blocker with explicit lineage"
  },
  {
    issue: "H-007",
    fixture: "incomplete-final-gates / forged-final-gates / happy reconcile",
    files: ["test/implementation-optimization.mjs", "test/reconcile.mjs"],
    layers: ["status", "reconcile", "archive"],
    blockedBehavior: "only runtime-generated complete final gates can allow completed"
  },
  {
    issue: "H-008",
    fixture: "current-demo-replay / acceptance coverage fixtures",
    files: ["test/reconcile.mjs", "test/demo-replay.mjs"],
    layers: ["reconcile"],
    blockedBehavior: "agent-authored acceptance matrix is required and blocked items prevent completion"
  },
  {
    issue: "H-009",
    fixture: "non-git commit policy / no-remote push policy / completed report commit hash",
    files: ["test/reconcile.mjs"],
    layers: ["reconcile", "archive"],
    blockedBehavior: "commit hash evidence is required; push blockers are explicit"
  },
  {
    issue: "H-010",
    fixture: "status matrix / quality lineage next owner / standard evidence",
    files: ["test/implementation-optimization.mjs"],
    layers: ["status"],
    blockedBehavior: "status derives gates from runtime artifacts rather than file existence only"
  },
  {
    issue: "H-011",
    fixture: "handoff evidence collector / status standard evidence",
    files: ["test/reconcile.mjs", "test/implementation-optimization.mjs"],
    layers: ["reconcile", "status"],
    blockedBehavior: "standard evidence manifest records missing paths and handoff sources"
  },
  {
    issue: "H-012",
    fixture: "provider observations",
    files: ["test/implementation-optimization.mjs"],
    layers: ["status", "true_harness_evidence"],
    blockedBehavior: "provider UI observation is diagnostic and never satisfies provider receipt gate"
  },
  {
    issue: "H-013",
    fixture: "smoke agent-name-map",
    files: ["test/smoke.mjs"],
    layers: ["status", "dispatch"],
    blockedBehavior: "provider display name maps to action id, dispatch contract, handoff, receipt, and gates"
  },
  {
    issue: "H-014",
    fixture: "runtime requirements status / reconcile blocked-pass / harness acceptance",
    files: ["test/implementation-optimization.mjs", "test/reconcile.mjs", "test/harness-acceptance.mjs"],
    layers: ["status", "reconcile", "archive"],
    blockedBehavior: "missing runtime declaration or QA environment output blocks completed"
  },
  {
    issue: "H-015",
    fixture: "replay coverage table",
    files: ["test/replay-coverage.mjs"],
    layers: ["test_coverage"],
    blockedBehavior: "each closed issue must keep a replay coverage record in npm test"
  },
  {
    issue: "H-016",
    fixture: "harness evolution record",
    files: ["test/harness-evolution.mjs", "docs/harness-evolution/2026-06-02-h001-h015-runtime-gates.json"],
    layers: ["evolution_record"],
    blockedBehavior: "non-trivial harness changes must link source failure, affected components, verification, observed result, and regression risks"
  }
];

const issueIds = replayCoverage.map((item) => item.issue);
assert.deepEqual(issueIds, Array.from({ length: 16 }, (_, index) => `H-${String(index + 1).padStart(3, "0")}`));

for (const item of replayCoverage) {
  assert.ok(item.fixture.trim(), `${item.issue} missing fixture name`);
  assert.ok(item.blockedBehavior.trim(), `${item.issue} missing blocked behavior`);
  assert.ok(item.layers.length > 0, `${item.issue} missing layers`);
  for (const file of item.files) {
    const absolute = path.join(root, file);
    assert.ok(fs.existsSync(absolute), `${item.issue} references missing test file ${file}`);
  }
}

const docs = fs.readFileSync(path.join(root, "docs", "HARNESS_ISSUE_BACKLOG.md"), "utf8");
for (const item of replayCoverage) {
  assert.match(docs, new RegExp(`### ${item.issue}\\b`));
}

console.log("replay coverage ok");
