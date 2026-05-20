import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileRun } from "../dist/core/reconcile.js";

const demoRoots = {
  early: "/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo",
  current: "/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo1"
};

function copyDemo(source, prefix) {
  assert.ok(fs.existsSync(source), `demo fixture missing: ${source}`);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(source, target, {
    recursive: true,
    dereference: false,
    filter: (file) => !file.includes(`${path.sep}backend${path.sep}build${path.sep}`)
  });
  return target;
}

function runIds(cwd) {
  const runs = path.join(cwd, ".imfine", "runs");
  return fs.readdirSync(runs)
    .filter((entry) => fs.existsSync(path.join(runs, entry, "run.json")))
    .sort();
}

function ensureAgentAcceptanceMatrix(cwd, runId, items) {
  const file = path.join(cwd, ".imfine", "runs", runId, "orchestration", "agent-acceptance-matrix.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, items }, null, 2) + "\n");
}

{
  const cwd = copyDemo(demoRoots.early, "imfine-real-early-demo-");
  const runId = runIds(cwd).find((id) => !id.endsWith("-2"));
  assert.ok(runId);
  ensureAgentAcceptanceMatrix(cwd, runId, [{
    id: "git_delivery.commits",
    category: "git_delivery",
    requirement_level: "required",
    classification: "required",
    status: "blocked",
    detail: "commit evidence missing",
    expected: "commit evidence",
    observed: "missing",
    accepted_by_review: false,
    evidence: []
  }]);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "commit").status, "blocked");
  const run = JSON.parse(fs.readFileSync(path.join(cwd, ".imfine", "runs", runId, "run.json"), "utf8"));
  assert.equal(run.status, "blocked");
}

{
  const cwd = copyDemo(demoRoots.current, "imfine-real-current-demo-");
  const runId = runIds(cwd)[0];
  assert.ok(runId);
  ensureAgentAcceptanceMatrix(cwd, runId, [{
    id: "product_shape.user-mini-program",
    category: "product_shape",
    requirement_level: "required",
    classification: "demo-substitute",
    status: "blocked",
    detail: "QA rejected substitute frontend as final mini-program evidence",
    expected: "mini-program frontend",
    observed: "static frontend substitute",
    accepted_by_review: false,
    evidence: []
  }]);
  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "commit").status, "pass");
  assert.equal(result.gates.find((gate) => gate.id === "true_harness").status, "blocked");
  const matrix = JSON.parse(fs.readFileSync(path.join(cwd, ".imfine", "runs", runId, "orchestration", "acceptance-matrix.json"), "utf8"));
  assert.ok(matrix.items.some((item) => item.id === "product_shape.user-mini-program" && item.classification === "demo-substitute" && item.status === "blocked"));
  const report = fs.readFileSync(path.join(cwd, ".imfine", "runs", runId, "archive", "final-report.md"), "utf8");
  assert.match(report, /## Demo Substitute/);
}

console.log("demo replay ok");
