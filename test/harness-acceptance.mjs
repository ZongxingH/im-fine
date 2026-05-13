import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli", "imfine.js");
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-harness-home-"));
const harnessEnv = {
  IMFINE_PROVIDER: "codex",
  IMFINE_SUBAGENT_SUPPORTED: "true"
};

function run(args, cwd, extraEnv = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, HOME: tempHome, ...extraEnv },
    encoding: "utf8"
  });
}

function makeGitProject(prefix, packageJson = { scripts: { test: "node --test" } }) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const git = (args) => execFileSync("git", args, { cwd: project, encoding: "utf8" });
  git(["init"]);
  git(["config", "user.email", "imfine@example.test"]);
  git(["config", "user.name", "imfine test"]);
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify(packageJson, null, 2));
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src", "index.js"), "export const value = 1;\n");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  return project;
}

const blockedProject = makeGitProject("imfine-harness-blocked-");
const blockedRun = JSON.parse(run(["run", "Blocked harness path", "--plan-only", "--json"], blockedProject));
const blockedResume = JSON.parse(run(["resume", blockedRun.runId, "--json"], blockedProject));
assert.equal(blockedResume.status, "blocked");
assert.ok(blockedResume.nextActions.some((action) => action.id === "gate-subagent-capability"));
assert.ok(fs.existsSync(path.join(blockedRun.runDir, "orchestration", "true-harness-evidence.json")));
const blockedEvidence = JSON.parse(fs.readFileSync(path.join(blockedRun.runDir, "orchestration", "true-harness-evidence.json"), "utf8"));
assert.equal(blockedEvidence.capability_gate.passed, false);

const fakeExecutor = path.join(os.tmpdir(), `imfine-harness-executor-${process.pid}.mjs`);
fs.writeFileSync(fakeExecutor, `
import fs from "node:fs";
import path from "node:path";

const role = process.env.IMFINE_AGENT_ROLE || "";
const id = process.env.IMFINE_AGENT_ID || "";
const outputDir = process.env.IMFINE_AGENT_OUTPUT_DIR || "";
const promptFile = process.env.IMFINE_AGENT_PROMPT || "";
const prompt = fs.readFileSync(promptFile, "utf8");
const agentDir = path.dirname(outputDir);

function worktreePath() {
  const match = prompt.match(/## Worktree\\n\\n([^\\n]+)/);
  return match ? match[1].trim() : "";
}

function writeHandoff(payload) {
  fs.writeFileSync(path.join(agentDir, "handoff.json"), JSON.stringify(payload, null, 2));
}

if (role === "dev") {
  const worktree = worktreePath();
  fs.writeFileSync(path.join(worktree, "src", "index.js"), "export const value = 2;\\n");
} else if (role === "intake" || role === "project-analyzer" || role === "product-planner") {
  fs.writeFileSync(path.join(agentDir, "note.txt"), role + " completed\\n");
} else if (role === "qa") {
  writeHandoff({
    run_id: process.env.IMFINE_RUN_ID,
    from: "qa",
    to: "reviewer",
    status: "pass",
    summary: "acceptance qa passed",
    commands: ["fake qa"],
    failures: [],
    evidence: [path.join(agentDir, "handoff.json")],
    next_state: "reviewing"
  });
} else if (role === "reviewer") {
  writeHandoff({
    run_id: process.env.IMFINE_RUN_ID,
    from: "reviewer",
    to: "orchestrator",
    status: "approved",
    summary: "acceptance review approved",
    findings: [],
    evidence: [path.join(agentDir, "handoff.json")],
    next_state: "committing"
  });
} else if (role === "risk-reviewer") {
  writeHandoff({
    run_id: process.env.IMFINE_RUN_ID,
    from: "risk-reviewer",
    to: "orchestrator",
    status: "ready",
    summary: "acceptance risk review passed",
    risks: [],
    evidence: [path.join(agentDir, "handoff.json")],
    required_changes: [],
    next_state: "planned"
  });
} else if (role === "committer") {
  writeHandoff({
    run_id: process.env.IMFINE_RUN_ID,
    from: "committer",
    to: "orchestrator",
    status: "ready",
    summary: "acceptance commit readiness approved",
    commit_mode: "task",
    evidence: [path.join(agentDir, "handoff.json")],
    next_state: "committing"
  });
} else if (role === "technical-writer") {
  if (id === "technical-writer") {
    writeHandoff({
      run_id: process.env.IMFINE_RUN_ID,
      from: "technical-writer",
      to: "archive",
      status: "ready",
      summary: "acceptance technical summary ready",
      docs_changed: [],
      evidence: [path.join(agentDir, "handoff.json")],
      reason: "archive summary prepared",
      next_state: "archiving"
    });
  } else {
    const worktree = worktreePath();
    fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "docs", "usage.md"), "# Usage\\n\\nAcceptance docs update.\\n");
  }
} else if (role === "project-knowledge-updater") {
  writeHandoff({
    run_id: process.env.IMFINE_RUN_ID,
    from: "project-knowledge-updater",
    to: "archive",
    status: "ready",
    summary: "acceptance project knowledge ready",
    evidence: [path.join(agentDir, "handoff.json")],
    updated_files: [],
    next_state: "archived"
  });
} else if (role === "architect") {
  const runRoot = path.resolve(outputDir, "..", "..", "..");
  fs.mkdirSync(path.join(runRoot, "design"), { recursive: true });
  fs.writeFileSync(path.join(runRoot, "design", "stack-decision.json"), JSON.stringify({
    language: "JavaScript",
    runtime: "Node.js",
    package_manager: "npm"
  }, null, 2) + "\\n");
  fs.writeFileSync(path.join(runRoot, "design", "technical-solution.md"), "# Technical Solution\\n\\nAcceptance architect output.\\n");
  fs.writeFileSync(path.join(runRoot, "design", "architecture-decisions.md"), "# Architecture Decisions\\n\\nAcceptance architect output.\\n");
} else if (role === "task-planner") {
  const runRoot = path.resolve(outputDir, "..", "..", "..");
  const runId = process.env.IMFINE_RUN_ID;
  const graph = {
    run_id: runId,
    strategy: "serial",
    tasks: [
      {
        id: "T1",
        title: "Implement requested change",
        type: "dev",
        depends_on: [],
        read_scope: [".imfine/project/**", ".imfine/runs/" + runId + "/**", "src/**"],
        write_scope: ["src/**", "test/**"],
        acceptance: ["requested change implemented"],
        dev_plan: ["edit source"],
        test_plan: ["npm run test"],
        review_plan: ["review source change"],
        verification: ["npm run test"],
        commit: { mode: "task", message: "feat: acceptance implementation" }
      }
    ]
  };
  fs.mkdirSync(path.join(runRoot, "planning"), { recursive: true });
  fs.writeFileSync(path.join(runRoot, "planning", "task-graph.json"), JSON.stringify(graph, null, 2) + "\\n");
}
`);

const harnessProject = makeGitProject("imfine-harness-ok-");
const fakeExecutorCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(fakeExecutor)}`;
const autoRun = JSON.parse(run(["run", "True harness acceptance run", "--executor", fakeExecutorCommand, "--max-iterations", "30", "--json"], harnessProject, harnessEnv));
assert.equal(autoRun.status, "completed");
assert.ok(typeof autoRun.sessionSummary?.orchestrator?.summary === "string");
assert.ok(Array.isArray(autoRun.sessionSummary?.agents));
assert.ok(autoRun.sessionSummary.agents.some((agent) => agent.role === "reviewer" && agent.summary === "acceptance review approved"));
const runDir = path.join(harnessProject, ".imfine", "runs", autoRun.runId);
const parallelPlan = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "parallel-plan.json"), "utf8"));
assert.ok(Array.isArray(parallelPlan.wave_history));
assert.ok(parallelPlan.wave_history.length > 0);
assert.ok(fs.existsSync(path.join(runDir, "orchestration", "dispatch-contracts.json")));
assert.ok(fs.existsSync(path.join(runDir, "orchestration", "true-harness-evidence.json")));
const harnessEvidence = JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "true-harness-evidence.json"), "utf8"));
assert.equal(harnessEvidence.capability_gate.passed, true);
assert.ok(harnessEvidence.parallel_execution.wave_count > 0);
assert.ok(harnessEvidence.participating_roles.includes("dev"));
assert.ok(harnessEvidence.participating_roles.includes("qa"));
assert.ok(harnessEvidence.participating_roles.includes("reviewer"));
assert.ok(harnessEvidence.handoff_evidence_chain.length > 0);
const archiveReport = fs.readFileSync(path.join(runDir, "archive", "archive-report.md"), "utf8");
assert.match(archiveReport, /True Harness Evidence/);
assert.match(archiveReport, /true-harness-evidence\.md/);

const bridgePrepared = JSON.parse(run(["agents", "prepare", autoRun.runId, "--json"], harnessProject, harnessEnv));
const bridgeDispatch = JSON.parse(fs.readFileSync(bridgePrepared.dispatch, "utf8"));
assert.equal(bridgeDispatch.bridge_mode, "legacy_debug");
assert.match(bridgeDispatch.bridge_notice, /not the true harness path/i);

console.log("harness acceptance ok");
