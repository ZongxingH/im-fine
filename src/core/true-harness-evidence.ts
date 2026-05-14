import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

interface RunMetadata {
  run_id: string;
  status?: string;
  execution_mode?: string;
  project_kind?: string;
  needs_task_replan_at?: string;
}

interface AgentRunRecord {
  id: string;
  role: string;
  taskId?: string;
  status?: string;
  executionSource?: string;
  executedBy?: string;
  executionStatus?: string;
  workflowState?: string;
  skills?: string[];
}

interface ParallelPlanWave {
  iteration: number;
  parallel_group: string;
  action_ids: string[];
  task_ids: string[];
  roles: string[];
  status: string;
  reason: string;
  started_at: string;
  completed_at?: string;
}

interface HandoffRecord {
  run_id?: string;
  task_id?: string;
  from?: string;
  to?: string;
  status?: string;
  summary?: string;
  evidence?: string[];
  next_state?: string;
}

interface TaskGraph {
  tasks: Array<{ id: string }>;
}

interface OrchestratorSessionRecord {
  decision_source?: string;
  execution_mode?: string;
  harness_classification?: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function optionalJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return readJson<T>(file);
}

function taskStatuses(runDirPath: string): string[] {
  const tasksDir = path.join(runDirPath, "tasks");
  if (!fs.existsSync(tasksDir)) return [];
  return fs.readdirSync(tasksDir)
    .map((taskId) => optionalJson<{ status?: string }>(path.join(tasksDir, taskId, "status.json"))?.status)
    .filter((status): status is string => typeof status === "string");
}

function taskIds(runDirPath: string): string[] {
  const graph = optionalJson<TaskGraph>(path.join(runDirPath, "planning", "task-graph.json"));
  if (!graph) return [];
  return graph.tasks.map((task) => task.id);
}

function collectHandoffs(runDirPath: string, cwd: string): Array<{
  agent_id: string;
  role: string;
  task_id?: string;
  status: string;
  summary: string;
  evidence: string[];
  file: string;
}> {
  const agentsDir = path.join(runDirPath, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  const entries = fs.readdirSync(agentsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const handoffs: Array<{
    agent_id: string;
    role: string;
    task_id?: string;
    status: string;
    summary: string;
    evidence: string[];
    file: string;
  }> = [];

  for (const entry of entries) {
    const file = path.join(agentsDir, entry.name, "handoff.json");
    if (!fs.existsSync(file)) continue;
    const handoff = readJson<HandoffRecord>(file);
    if (typeof handoff.from !== "string") continue;
    handoffs.push({
      agent_id: entry.name,
      role: handoff.from,
      task_id: handoff.task_id,
      status: handoff.status || "unknown",
      summary: handoff.summary || "",
      evidence: Array.isArray(handoff.evidence)
        ? handoff.evidence.filter((item): item is string => typeof item === "string").map((item) => rel(cwd, item))
        : [],
      file: rel(cwd, file)
    });
  }

  return handoffs;
}

export interface TrueHarnessEvidenceFiles {
  json: string;
  markdown: string;
}

export function writeTrueHarnessEvidence(cwd: string, runId: string): TrueHarnessEvidenceFiles {
  const runDirPath = runDir(cwd, runId);
  const orchestrationDir = path.join(runDirPath, "orchestration");
  const evidenceDir = path.join(runDirPath, "evidence");
  ensureDir(orchestrationDir);
  ensureDir(evidenceDir);

  const run = readJson<RunMetadata>(path.join(runDirPath, "run.json"));
  const agentRuns = optionalJson<{ agents?: AgentRunRecord[] }>(path.join(orchestrationDir, "agent-runs.json"));
  const parallelExecution = optionalJson<{
    wave_history?: ParallelPlanWave[];
    executed_parallel_groups?: string[];
    blocked_parallel_groups?: string[];
  }>(path.join(orchestrationDir, "parallel-execution.json"));
  const orchestratorSessionFile = path.join(orchestrationDir, "orchestrator-session.json");
  const orchestratorSession = optionalJson<OrchestratorSessionRecord>(orchestratorSessionFile);
  const handoffs = collectHandoffs(runDirPath, cwd);
  const taskStatusValues = taskStatuses(runDirPath);
  const graphTaskIds = taskIds(runDirPath);
  const participatingRoles = Array.from(new Set([
    ...(Array.isArray(agentRuns?.agents) ? agentRuns.agents.filter((agent) => agent.status === "completed" || agent.executionStatus === "completed").map((agent) => agent.role) : []),
    ...handoffs.map((handoff) => handoff.role)
  ])).sort();
  const waves = Array.isArray(parallelExecution?.wave_history) ? parallelExecution.wave_history : [];
  const agentRecords = Array.isArray(agentRuns?.agents) ? agentRuns.agents : [];
  const hasTrueHarnessAgent = agentRecords.some((agent) => agent.executionSource === "true_harness");
  const hasCompletedWave = waves.some((wave) => wave.status === "completed");
  const hasHandoffChain = handoffs.length > 0;
  const orchestratorDeclaredTrueHarness = orchestratorSession?.decision_source === "orchestrator_agent"
    && orchestratorSession.execution_mode === "true_harness"
    && orchestratorSession.harness_classification === "true_harness";
  const passed = orchestratorDeclaredTrueHarness && hasTrueHarnessAgent && hasCompletedWave && hasHandoffChain;

  const payload = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    target_goal: "依赖大模型能力，通过多角色多 agent + skill 并行执行，实现 harness 工程",
    harness_classification: "true_harness",
    true_harness_passed: passed,
    orchestrator_declaration: {
      passed: orchestratorDeclaredTrueHarness,
      decision_source: orchestratorSession?.decision_source || "missing",
      execution_mode: orchestratorSession?.execution_mode || "missing",
      harness_classification: orchestratorSession?.harness_classification || "missing",
      session_file: fs.existsSync(orchestratorSessionFile) ? rel(cwd, orchestratorSessionFile) : null
    },
    run: {
      status: run.status || "unknown",
      execution_mode: run.execution_mode || "unknown",
      project_kind: run.project_kind || "unknown"
    },
    participating_roles: participatingRoles,
    task_count: graphTaskIds.length,
    parallel_execution: {
      executed_parallel_groups: Array.isArray(parallelExecution?.executed_parallel_groups) ? parallelExecution.executed_parallel_groups : [],
      blocked_parallel_groups: Array.isArray(parallelExecution?.blocked_parallel_groups) ? parallelExecution.blocked_parallel_groups : [],
      wave_count: waves.length,
      waves: waves.map((wave) => ({
        iteration: wave.iteration,
        parallel_group: wave.parallel_group,
        agent_count: wave.action_ids.length,
        roles: wave.roles,
        task_ids: wave.task_ids,
        status: wave.status,
        started_at: wave.started_at,
        completed_at: wave.completed_at || null
      }))
    },
    handoff_evidence_chain: handoffs.map((handoff) => ({
      agent_id: handoff.agent_id,
      role: handoff.role,
      task_id: handoff.task_id || null,
      status: handoff.status,
      summary: handoff.summary,
      handoff_file: handoff.file,
      evidence: handoff.evidence
    })),
    fix_loop_usage: {
      fix_tasks_present: graphTaskIds.some((taskId) => taskId.startsWith("FIX-")),
      replan_used: fs.existsSync(path.join(orchestrationDir, "task-planner-replan.md")) || typeof run.needs_task_replan_at === "string",
      design_rework_used: fs.existsSync(path.join(evidenceDir, "design-rework.md")) || taskStatusValues.includes("implementation_blocked_by_design")
    }
  };

  const jsonFile = path.join(orchestrationDir, "true-harness-evidence.json");
  const markdownFile = path.join(orchestrationDir, "true-harness-evidence.md");
  writeText(jsonFile, `${JSON.stringify(payload, null, 2)}\n`);
  writeText(markdownFile, `# True Harness Evidence

## Goal

- ${payload.target_goal}

## Assessment

- harness classification: ${payload.harness_classification}
- true harness passed: ${payload.true_harness_passed ? "yes" : "no"}

## Orchestrator Declaration

- passed: ${payload.orchestrator_declaration.passed ? "yes" : "no"}
- decision source: ${payload.orchestrator_declaration.decision_source}
- execution mode: ${payload.orchestrator_declaration.execution_mode}
- harness classification: ${payload.orchestrator_declaration.harness_classification}
- session file: ${payload.orchestrator_declaration.session_file || "none"}

## Run

- status: ${payload.run.status}
- execution mode: ${payload.run.execution_mode}
- project kind: ${payload.run.project_kind}

## Participating Roles

${payload.participating_roles.length > 0 ? payload.participating_roles.map((role) => `- ${role}`).join("\n") : "- none"}

## Parallel Execution

- wave count: ${payload.parallel_execution.wave_count}
- executed parallel groups: ${payload.parallel_execution.executed_parallel_groups.length}
- blocked parallel groups: ${payload.parallel_execution.blocked_parallel_groups.length}

${payload.parallel_execution.waves.length > 0 ? payload.parallel_execution.waves.map((wave) => `- iteration ${wave.iteration} / ${wave.parallel_group}: ${wave.agent_count} agent(s), status=${wave.status}, roles=${wave.roles.join(", ") || "none"}`).join("\n") : "- no wave history"}

## Handoff Evidence Chain

${payload.handoff_evidence_chain.length > 0 ? payload.handoff_evidence_chain.map((handoff) => `- ${handoff.role}${handoff.task_id ? `/${handoff.task_id}` : ""}: ${handoff.status} -> ${handoff.handoff_file}`).join("\n") : "- none"}

## Fix Loop Usage

- fix tasks present: ${payload.fix_loop_usage.fix_tasks_present ? "yes" : "no"}
- replan used: ${payload.fix_loop_usage.replan_used ? "yes" : "no"}
- design rework used: ${payload.fix_loop_usage.design_rework_used ? "yes" : "no"}
`);

  return {
    json: jsonFile,
    markdown: markdownFile
  };
}
