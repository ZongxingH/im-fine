import fs from "node:fs";
import path from "node:path";
import { readFixLoopRoleActionState } from "./fix-loop.js";
import { writeText } from "./fs.js";
import { validateTaskGraph, type TaskGraph } from "./plan.js";
import { refreshOrchestrationSnapshot } from "./orchestration-sync.js";
import { assertTransitionAccepted, transitionRunState } from "./state-machine.js";

export interface ReplanResult {
  runId: string;
  runDir: string;
  status: "needs_task_replan";
  reason: string;
  input: string;
  report: string;
  audit: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function inferReplanReason(runRoot: string, summary: string): string {
  if (summary.trim()) return summary.trim();
  const graphFile = path.join(runRoot, "planning", "task-graph.json");
  if (!fs.existsSync(graphFile)) return "task graph is missing; Task Planner must produce a new schedulable plan";
  const validation = validateTaskGraph(readJson<TaskGraph>(graphFile));
  if (validation.serialReason) return validation.serialReason;
  if (validation.replanRecommended) return "current task graph recommends replanning due to coarse boundaries or blocked parallelism";
  return "orchestrator requested replanning to improve task granularity or restore safe parallel execution";
}

export function requestTaskPlannerReplan(cwd: string, runId: string, summary = ""): ReplanResult {
  const runRoot = runDir(cwd, runId);
  const reason = inferReplanReason(runRoot, summary);
  const workflow = readFixLoopRoleActionState("needs_task_replan");
  const input = path.join(runRoot, "agents", "task-planner-replan", "input.md");
  const report = path.join(runRoot, "orchestration", "task-planner-replan.md");
  const audit = path.join(runRoot, "orchestration", "task-planner-replan-audit.json");
  const graphFile = path.join(runRoot, "planning", "task-graph.json");
  const executionPlan = path.join(runRoot, "planning", "execution-plan.md");
  const run = readJson<{ status?: string }>(path.join(runRoot, "run.json"));

  writeText(input, `# Task Planner Replan Input

## Reason

${reason}

## Required Outcome

- Re-split work to maximize safe parallel execution.
- Keep write scopes independent where possible.
- If serial execution is still required, record the exact dependency reason.
- Produce updated task graph, ownership, execution plan, and commit plan.

## Current Artifacts

- task graph: ${fs.existsSync(graphFile) ? graphFile : "missing"}
- execution plan: ${fs.existsSync(executionPlan) ? executionPlan : "missing"}
`);

  writeText(report, `# Task Planner Replan Request

- status: needs_task_replan
- role: ${workflow.role}
- action: ${workflow.action_id}
- reason: ${reason}
- input: ${input}
`);
  writeText(audit, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    from_run_state: run.status || "unknown",
    to_run_state: "needs_task_replan",
    reason,
    related_artifacts: {
      task_graph: fs.existsSync(graphFile) ? graphFile : null,
      execution_plan: fs.existsSync(executionPlan) ? executionPlan : null,
      input,
      report
    },
    recorded_at: new Date().toISOString()
  }, null, 2)}\n`);

  assertTransitionAccepted(transitionRunState(cwd, runId, "needs_task_replan", {
    needs_task_replan_at: new Date().toISOString(),
    needs_task_replan_reason: reason,
    needs_task_replan_input: input
  }), `replan run ${runId}`);
  refreshOrchestrationSnapshot(cwd, runId);

  return {
    runId,
    runDir: runRoot,
    status: "needs_task_replan",
    reason,
    input,
    report,
    audit
  };
}
