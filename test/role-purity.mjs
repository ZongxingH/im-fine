import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeRolePurityAudit } from "../dist/core/role-purity.js";
import { writeTrueHarnessEvidence } from "../dist/core/true-harness-evidence.js";
import { reconcileRun } from "../dist/core/reconcile.js";

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function makeRun() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-role-purity-"));
  const runId = "role-purity-demo";
  const runDir = path.join(cwd, ".imfine", "runs", runId);
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".imfine", "state"), { recursive: true });
  writeJson(path.join(cwd, ".imfine", "state", "current.json"), { current_run_id: runId });
  writeJson(path.join(runDir, "run.json"), {
    schema_version: 1,
    run_id: runId,
    status: "waiting_for_agent_output",
    execution_mode: "true_harness",
    project_kind: "new_project",
    source: { type: "text", value: "role purity demo" }
  });
  writeJson(path.join(runDir, "orchestration", "orchestrator-session.json"), {
    schema_version: 1,
    run_id: runId,
    decision_source: "orchestrator_agent",
    execution_mode: "true_harness",
    harness_classification: "true_harness",
    status: "waiting_for_agent_output",
    next_actions: [
      {
        id: "agent-reviewer-T1",
        kind: "agent",
        status: "done",
        role: "reviewer",
        taskId: "T1",
        reason: "review implementation",
        inputs: [],
        outputs: [path.join(runDir, "agents", "reviewer-T1", "handoff.json")],
        dependsOn: [],
        parallelGroup: "review"
      }
    ],
    agent_runs: [
      {
        id: "reviewer-T1",
        role: "reviewer",
        taskId: "T1",
        status: "completed",
        skills: ["risk-review"],
        inputs: [],
        outputs: [path.join(runDir, "agents", "reviewer-T1", "handoff.json")],
        readScope: [".imfine/runs/role-purity-demo/**"],
        writeScope: [".imfine/runs/role-purity-demo/agents/reviewer-T1/**"],
        dependsOn: [],
        parallelGroup: "review"
      }
    ]
  });
  writeJson(path.join(runDir, "agents", "reviewer-T1", "handoff.json"), {
    run_id: runId,
    task_id: "T1",
    role: "reviewer",
    from: "reviewer",
    to: "orchestrator",
    status: "changes_requested",
    summary: "review found blockers",
    commands: [],
    findings: [{ id: "R1", severity: "P0", summary: "pagination broken" }],
    evidence: [path.join(runDir, "evidence", "review.md")],
    next_state: "needs_dev_fix"
  });
  fs.mkdirSync(path.join(runDir, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "evidence", "review.md"), "# Review\n\n- blocker: pagination broken\n");
  fs.mkdirSync(path.join(cwd, "backend"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "tests"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "backend", "app.py"), "# patched by orchestrator\n");
  fs.writeFileSync(path.join(cwd, "tests", "test_api.py"), "# patched by orchestrator\n");
  writeJson(path.join(runDir, "orchestration", "artifact-authorship.json"), {
    schema_version: 1,
    run_id: runId,
    artifacts: [
      { file: "backend/app.py", author_role: "orchestrator", action_id: "orchestrator-direct-fix" },
      { file: "tests/test_api.py", author_role: "orchestrator", action_id: "orchestrator-direct-fix" },
      { file: path.join(runDir, "evidence", "review.md"), author_role: "reviewer", action_id: "agent-reviewer-T1" }
    ]
  });
  writeJson(path.join(runDir, "orchestration", "agent-acceptance-matrix.json"), {
    schema_version: 1,
    required_coverage_declared_complete: true,
    items: [
      {
        id: "product_shape.user-mini-program",
        category: "product_shape",
        requirement_level: "required",
        classification: "demo-substitute",
        status: "blocked",
        detail: "static page substitute is not accepted",
        expected: "mini-program frontend",
        observed: "static frontend substitute",
        accepted_by_review: false,
        evidence: []
      }
    ]
  });
  return { cwd, runId, runDir };
}

{
  const { cwd, runId, runDir } = makeRun();
  const auditFile = writeRolePurityAudit(cwd, runId);
  const audit = JSON.parse(fs.readFileSync(auditFile, "utf8"));
  assert.equal(audit.status, "blocked");
  assert.equal(audit.orchestrator_role_purity, "fail");
  assert.ok(audit.violations.some((item) => item.id.includes("backend-app.py") && item.observed === "orchestrator"));
  assert.ok(audit.violations.some((item) => item.id.startsWith("rework-dispatch.")));
  assert.ok(audit.violations.some((item) => item.id.startsWith("deviation.")));

  const evidence = JSON.parse(fs.readFileSync(writeTrueHarnessEvidence(cwd, runId).json, "utf8"));
  assert.equal(evidence.true_harness_passed, false);
  assert.equal(evidence.role_purity.status, "blocked");
  assert.equal(evidence.role_purity.orchestrator_role_purity, "fail");

  const result = reconcileRun(cwd, runId);
  assert.equal(result.status, "blocked");
  assert.equal(result.gates.find((gate) => gate.id === "role_purity").status, "blocked");
  const finalGates = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "final-gates.json"), "utf8"));
  assert.equal(finalGates.gates.role_purity, "blocked");
  assert.equal(finalGates.gates.true_harness, "blocked");
}

console.log("role purity ok");
