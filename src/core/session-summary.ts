import fs from "node:fs";
import path from "node:path";
import type { AutoOrchestratorResult } from "./auto-orchestrator.js";
import type { AgentRun, OrchestratorResult } from "./orchestrator.js";

export interface SessionSummaryEntry {
  agentId: string;
  role: string;
  taskId?: string;
  status: string;
  summary: string;
  outputs: string[];
  details: string[];
}

export interface SessionSummaryPayload {
  orchestrator: {
    summary: string;
    outputs: string[];
    details: string[];
  };
  agents: SessionSummaryEntry[];
}

export interface SessionSummarizedOrchestratorResult extends OrchestratorResult {
  sessionSummary: SessionSummaryPayload;
}

export interface SessionSummarizedAutoOrchestratorResult extends AutoOrchestratorResult {
  sessionSummary: SessionSummaryPayload;
}

interface HandoffPayload {
  status?: string;
  summary?: string;
  parallel_groups?: unknown[];
  serial_tasks?: unknown[];
  task_graph?: string;
  design_files?: unknown[];
  evidence?: unknown[];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function exists(file: string): boolean {
  return fs.existsSync(file);
}

function existingOutputs(cwd: string, outputs: string[]): string[] {
  return outputs.filter((item) => exists(path.resolve(cwd, item)));
}

function readHandoff(file: string | undefined): HandoffPayload | null {
  if (!file || !exists(file)) return null;
  return readJson<HandoffPayload>(file);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function roleSummary(result: OrchestratorResult, agent: AgentRun): { summary: string; details: string[] } {
  const handoff = readHandoff(agent.handoffFile);
  if (handoff?.summary) {
    const details: string[] = [];
    if (agent.role === "task-planner") {
      const groups = Array.isArray(handoff.parallel_groups) ? handoff.parallel_groups.length : 0;
      const serialTasks = Array.isArray(handoff.serial_tasks) ? handoff.serial_tasks.length : 0;
      if (groups > 0) details.push(`parallel groups: ${groups}`);
      if (serialTasks > 0) details.push(`serial tasks: ${serialTasks}`);
      if (typeof handoff.task_graph === "string") details.push(`task graph: ${handoff.task_graph}`);
    }
    if (agent.role === "architect") {
      const designFiles = stringList(handoff.design_files);
      if (designFiles.length > 0) details.push(...designFiles);
    }
    const evidence = stringList(handoff.evidence);
    if (details.length === 0 && evidence.length > 0) details.push(...evidence);
    if (details.length === 0) details.push(`parallel group: ${agent.parallelGroup}`);
    return { summary: handoff.summary, details };
  }
  return {
    summary: agent.status === "completed"
      ? `${agent.role} completed without a model-authored summary`
      : `${agent.role} is ${agent.status}; waiting for model-authored summary`,
    details: [`parallel group: ${agent.parallelGroup}`]
  };
}

export function summarizeOrchestratorSession(cwd: string, result: OrchestratorResult): SessionSummarizedOrchestratorResult {
  const orchestratorSummary = {
    summary: `Orchestrator inferred ${result.status} with ${result.nextActions.filter((action) => action.status !== "done").length} actionable step(s) across ${result.parallelGroups.length} parallel group(s)`,
    outputs: [result.files.state, result.files.queue, result.files.dispatchContracts, result.files.timeline].map((file) => rel(cwd, file)),
    details: [
      `ready actions: ${result.nextActions.filter((action) => action.status === "ready").length}`,
      `waiting actions: ${result.nextActions.filter((action) => action.status === "waiting").length}`,
      `blocked actions: ${result.nextActions.filter((action) => action.status === "blocked").length}`
    ]
  };
  const agents = result.agentRuns.map((agent) => {
    const role = roleSummary(result, agent);
    return {
      agentId: agent.id,
      role: agent.role,
      taskId: agent.taskId,
      status: agent.status,
      summary: role.summary,
      outputs: existingOutputs(cwd, agent.outputs),
      details: role.details
    };
  });
  return { ...result, sessionSummary: { orchestrator: orchestratorSummary, agents } };
}

export function summarizeAutoOrchestratorSession(cwd: string, result: AutoOrchestratorResult): SessionSummarizedAutoOrchestratorResult {
  const summarized = summarizeOrchestratorSession(cwd, result.lastOrchestration);
  return {
    ...result,
    sessionSummary: {
      orchestrator: {
        summary: `Current session completed ${result.steps.filter((step) => step.status === "completed").length} step(s) in ${result.iterations} iteration(s); final status is ${result.status}`,
        outputs: [result.timeline],
        details: result.steps.map((step) => `${step.actionId}: ${step.detail}`)
      },
      agents: summarized.sessionSummary.agents
    }
  };
}
