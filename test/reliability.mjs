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
const missingCommitter = transitionRunState(cwd, runId, "committing");
assert.equal(missingCommitter.accepted, false);
fs.mkdirSync(path.join(runDir, "agents", "committer"), { recursive: true });
const committerHandoff = path.join(runDir, "agents", "committer", "handoff.json");
fs.writeFileSync(committerHandoff, JSON.stringify({
  run_id: runId,
  task_id: "run",
  role: "committer",
  from: "committer",
  to: "orchestrator",
  status: "ready",
  summary: "commit ready",
  commit_mode: "task",
  commands: [],
  evidence: [committerHandoff],
  next_state: "committing"
}, null, 2) + "\n");
assert.equal(transitionRunState(cwd, runId, "committing").accepted, true);
transitionRunState(cwd, runId, "pushing");
const missingArchivingEvidence = transitionRunState(cwd, runId, "archiving");
assert.equal(missingArchivingEvidence.accepted, false);
fs.mkdirSync(path.join(runDir, "evidence"), { recursive: true });
fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Test Results\n\npass\n");
fs.writeFileSync(path.join(runDir, "evidence", "review.md"), "# Review\n\napproved\n");
fs.writeFileSync(path.join(runDir, "evidence", "commits.md"), "# Commits\n\nabc123\n");
fs.writeFileSync(path.join(runDir, "evidence", "push.md"), "# Push\n\npushed\n");
const pushingRun = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
  ...pushingRun,
  status: "pushing",
  commit_hashes: ["abc123"],
  push_status: "pushed"
}, null, 2) + "\n");
assert.equal(transitionRunState(cwd, runId, "archiving").accepted, true);
const missingCompletionEvidence = transitionRunState(cwd, runId, "completed");
assert.equal(missingCompletionEvidence.accepted, false);
fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
fs.mkdirSync(path.join(runDir, "agents", "archive"), { recursive: true });
fs.mkdirSync(path.join(runDir, "archive"), { recursive: true });
fs.mkdirSync(path.join(cwd, ".imfine", "reports"), { recursive: true });
const archiveReport = path.join(runDir, "archive", "archive-report.md");
const userReport = path.join(cwd, ".imfine", "reports", `${runId}.md`);
fs.writeFileSync(archiveReport, "# Archive\n");
fs.writeFileSync(userReport, "# Report\n");
fs.writeFileSync(path.join(runDir, "orchestration", "true-harness-evidence.json"), JSON.stringify({
  schema_version: 1,
  run_id: runId,
  true_harness_passed: true
}, null, 2) + "\n");
fs.writeFileSync(path.join(runDir, "agents", "archive", "status.json"), JSON.stringify({
  run_id: runId,
  status: "completed"
}, null, 2) + "\n");
fs.writeFileSync(path.join(runDir, "agents", "archive", "handoff.json"), JSON.stringify({
  run_id: runId,
  task_id: "run",
  role: "archive",
  from: "archive",
  to: "orchestrator",
  status: "completed",
  summary: "archive completed",
  commands: [],
  archive_report: archiveReport,
  project_updates: [],
  blocked_items: [],
  evidence: [archiveReport, userReport],
  next_state: "completed"
}, null, 2) + "\n");
assert.equal(transitionRunState(cwd, runId, "completed").accepted, true);
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
