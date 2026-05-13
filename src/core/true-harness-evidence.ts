import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

interface RunMetadata {
  run_id: string;
  status?: string;
  project_kind?: string;
  needs_task_replan_at?: string;
}

interface AgentRunRecord {
  id: string;
  role: string;
  taskId?: string;
  status?: string;
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
  const parallelPlan = optionalJson<{
    wave_history?: ParallelPlanWave[];
    executed_parallel_groups?: string[];
    blocked_parallel_groups?: string[];
  }>(path.join(orchestrationDir, "parallel-plan.json"));
  const capabilityGateFile = path.join(orchestrationDir, "subagent-capability-gate.json");
  const handoffs = collectHandoffs(runDirPath, cwd);
  const taskStatusValues = taskStatuses(runDirPath);
  const graphTaskIds = taskIds(runDirPath);
  const participatingRoles = Array.from(new Set([
    ...(Array.isArray(agentRuns?.agents) ? agentRuns.agents.filter((agent) => agent.status === "completed" || agent.executionStatus === "completed").map((agent) => agent.role) : []),
    ...handoffs.map((handoff) => handoff.role)
  ])).sort();
  const waves = Array.isArray(parallelPlan?.wave_history) ? parallelPlan.wave_history : [];

  const payload = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    target_goal: "依赖大模型能力，通过多角色多 agent + skill 并行执行，实现 harness 工程",
    capability_gate: {
      passed: !fs.existsSync(capabilityGateFile),
      gate_file: fs.existsSync(capabilityGateFile) ? rel(cwd, capabilityGateFile) : null
    },
    run: {
      status: run.status || "unknown",
      project_kind: run.project_kind || "unknown"
    },
    participating_roles: participatingRoles,
    task_count: graphTaskIds.length,
    parallel_execution: {
      executed_parallel_groups: Array.isArray(parallelPlan?.executed_parallel_groups) ? parallelPlan.executed_parallel_groups : [],
      blocked_parallel_groups: Array.isArray(parallelPlan?.blocked_parallel_groups) ? parallelPlan.blocked_parallel_groups : [],
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
      design_rework_used: fs.existsSync(path.join(evidenceDir, "design-rework.md")) || taskStatusValues.includes("implementation_blocked_by_design"),
      conflict_resolution_used: fs.existsSync(path.join(evidenceDir, "conflicts.md")) || taskStatusValues.includes("needs_conflict_resolution")
    }
  };

  const jsonFile = path.join(orchestrationDir, "true-harness-evidence.json");
  const markdownFile = path.join(orchestrationDir, "true-harness-evidence.md");
  writeText(jsonFile, `${JSON.stringify(payload, null, 2)}\n`);
  writeText(markdownFile, `# True Harness Evidence

## Goal

- ${payload.target_goal}

## Capability Gate

- passed: ${payload.capability_gate.passed ? "yes" : "no"}
- gate file: ${payload.capability_gate.gate_file || "none"}

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
- conflict resolution used: ${payload.fix_loop_usage.conflict_resolution_used ? "yes" : "no"}
`);

  return {
    json: jsonFile,
    markdown: markdownFile
  };
}
