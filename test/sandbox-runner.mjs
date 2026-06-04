import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveRun } from "../dist/core/archive.js";
import { runSandboxVerification, sandboxVerificationFile } from "../dist/core/sandbox-runner.js";
import { status as readStatus } from "../dist/core/status.js";
import { writeTrueHarnessEvidence, staleTrueHarnessEvidence } from "../dist/core/true-harness-evidence.js";

function makeRun(prefix = "imfine-sandbox-runner-", exitCode = 0) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const runId = "run-1";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "request"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "planned",
    execution_mode: "true_harness",
    project_kind: "existing_project",
    source: { type: "text", value: "sandbox fixture" },
    created_at: "2026-01-01T00:00:00.000Z"
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "request", "normalized.md"), "sandbox fixture\n");
  fs.writeFileSync(path.join(cwd, ".imfine", "state", "current.json"), JSON.stringify({
    schema_version: 1,
    current_run_id: runId
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    scripts: { test: "node sandbox-test.js" }
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(cwd, "sandbox-test.js"), `process.exit(${exitCode});\n`);
  return { cwd, runId, runDir };
}

{
  const { cwd, runId } = makeRun("imfine-sandbox-pass-", 0);
  const result = runSandboxVerification(cwd, runId, { testCommands: ["node sandbox-test.js"] });
  assert.equal(result.status, "pass");
  assert.ok(fs.existsSync(sandboxVerificationFile(cwd, runId)));
  assert.equal(result.test_commands[0].exit_code, 0);
}

{
  const { cwd, runId, runDir } = makeRun("imfine-sandbox-fail-", 1);
  fs.writeFileSync(path.join(runDir, "evidence", "test-results.md"), "# Tests\n\nPASS locally\n");
  fs.writeFileSync(path.join(runDir, "evidence", "review.md"), "# Review\n\napproved\n");
  fs.writeFileSync(path.join(runDir, "evidence", "commits.md"), "# Commits\n\n- abc1234\n");
  fs.writeFileSync(path.join(runDir, "evidence", "push.md"), "# Push\n\n- status: pushed\n");
  const runFile = path.join(runDir, "run.json");
  const run = JSON.parse(fs.readFileSync(runFile, "utf8"));
  fs.writeFileSync(runFile, JSON.stringify({ ...run, commit_hash: "abc1234", commit_hashes: ["abc1234"], push_status: "pushed", pushed_head: "abc1234" }, null, 2) + "\n");
  const evidence = writeTrueHarnessEvidence(cwd, runId);
  const result = runSandboxVerification(cwd, runId, { testCommands: ["node sandbox-test.js"] });
  assert.equal(result.status, "blocked");
  assert.ok(staleTrueHarnessEvidence(evidence.json).some((item) => item.includes("sandbox_verification")));

  const current = readStatus(cwd);
  assert.equal(current.currentRunSandboxVerification.present, true);
  assert.equal(current.currentRunSandboxVerification.status, "blocked");
  assert.equal(current.currentRunSandboxVerification.environmentMismatch, true);
  assert.match(current.currentRunNextOwner.reason, /environment \/ verification mismatch/);

  const archived = archiveRun(cwd, runId);
  const sandboxCheck = archived.checks.find((check) => check.id === "run-level.sandbox-verification");
  assert.ok(sandboxCheck);
  assert.equal(sandboxCheck.status, "fail");
  assert.equal(archived.status, "blocked");
}

console.log("sandbox runner ok");
