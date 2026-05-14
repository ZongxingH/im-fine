import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, releaseLock, writeCheckpoint } from "../dist/core/reliability.js";
import { transitionRunState, transitionTaskState } from "../dist/core/state-machine.js";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-reliability-"));
const runId = "reliability-run";
const runDir = path.join(cwd, ".imfine", "runs", runId);
fs.mkdirSync(path.join(runDir, "tasks", "T1"), { recursive: true });
fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
  schema_version: 1,
  run_id: runId,
  status: "created"
}, null, 2) + "\n");

assert.equal(transitionRunState(cwd, runId, "infrastructure_checked").accepted, true);
assert.equal(transitionRunState(cwd, runId, "project_analyzed").accepted, true);
assert.equal(transitionRunState(cwd, runId, "requirement_analyzed").accepted, true);
assert.equal(transitionRunState(cwd, runId, "designed").accepted, true);
const runTransition = transitionRunState(cwd, runId, "planned");
assert.equal(runTransition.accepted, true);
assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8")).status, "planned");

transitionRunState(cwd, runId, "branch_prepared");
transitionRunState(cwd, runId, "implementing");
transitionRunState(cwd, runId, "reviewing");
transitionRunState(cwd, runId, "committing");
transitionRunState(cwd, runId, "pushing");
transitionRunState(cwd, runId, "archiving");
transitionRunState(cwd, runId, "completed");
const illegalRunTransition = transitionRunState(cwd, runId, "implementing");
assert.equal(illegalRunTransition.accepted, false);
assert.ok(fs.existsSync(path.join(runDir, "orchestration", "state-blockers.json")));
assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8")).status, "completed");

const taskTransition = transitionTaskState(cwd, runId, "T1", "planned");
assert.equal(taskTransition.accepted, true);
transitionTaskState(cwd, runId, "T1", "ready_for_dev");
transitionTaskState(cwd, runId, "T1", "patch_validated");
transitionTaskState(cwd, runId, "T1", "qa_passed");
transitionTaskState(cwd, runId, "T1", "review_approved");
transitionTaskState(cwd, runId, "T1", "committed");
const illegalTaskTransition = transitionTaskState(cwd, runId, "T1", "implementing");
assert.equal(illegalTaskTransition.accepted, false);

const firstLock = acquireLock(cwd, runId, "run", undefined, 60_000);
assert.equal(firstLock.acquired, true);
const duplicateLock = acquireLock(cwd, runId, "run", undefined, 60_000);
assert.equal(duplicateLock.acquired, false);
releaseLock(cwd, firstLock);
const staleLock = acquireLock(cwd, runId, "action", "A1", -1);
assert.equal(staleLock.acquired, true);
const recovered = acquireLock(cwd, runId, "action", "A1", 60_000);
assert.equal(recovered.acquired, true);
assert.equal(recovered.recoveredStale, true);
releaseLock(cwd, recovered);

const checkpoint = writeCheckpoint(cwd, runId, "A1", "after", "completed", "done", []);
assert.ok(fs.existsSync(checkpoint));
assert.ok(fs.existsSync(path.join(runDir, "orchestration", "checkpoints", "latest.json")));
assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "action-ledger.json"), "utf8")).actions.A1.status, "completed");

console.log("reliability ok");
