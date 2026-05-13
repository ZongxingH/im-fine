import path from "node:path";
import type { AgentRun, OrchestrationAction, OrchestrationActionStatus } from "./orchestrator.js";

export interface DispatchContract {
  id: string;
  role: string;
  task_id?: string;
  workflow_state?: string;
  run_id: string;
  action_id: string;
  status: "ready" | "waiting" | "blocked" | "done";
  kind: "agent";
  depends_on: string[];
  read_scope: string[];
  write_scope: string[];
  inputs: string[];
  required_outputs: string[];
  skills: string[];
  handoff_schema: string;
  allowed_transitions: string[];
  parallel_group: string;
  ready_reason?: string;
  blocked_reason?: string;
}

function normalizeStatus(status: OrchestrationActionStatus): DispatchContract["status"] {
  if (status === "done") return "done";
  return status;
}

function normalizeAgentRunStatus(status: AgentRun["status"]): DispatchContract["status"] {
  if (status === "completed") return "done";
  if (status === "planned") return "waiting";
  return status;
}

function allowedTransitionsForRole(role: string): string[] {
  if (role === "qa") return ["qa_passed", "qa_failed", "blocked"];
  if (role === "reviewer") return ["review_approved", "review_changes_requested", "blocked"];
  if (role === "archive") return ["archived", "blocked"];
  if (role === "architect") return ["designed", "needs_design_update", "blocked"];
  if (role === "task-planner") return ["planned", "needs_task_replan", "blocked"];
  if (role === "risk-reviewer") return ["planned", "implementing", "blocked"];
  if (role === "committer") return ["committing", "blocked"];
  if (role === "technical-writer") return ["archiving", "blocked"];
  if (role === "project-knowledge-updater") return ["archiving", "blocked"];
  if (role === "conflict-resolver") return ["reviewing", "committing", "blocked"];
  return ["implementing", "patch_validated", "blocked"];
}

export function buildDispatchContracts(cwd: string, runId: string, runDir: string, actions: OrchestrationAction[], agentRuns: AgentRun[]): DispatchContract[] {
  const actionByAgentId = new Map<string, OrchestrationAction>();
  const actionByRoleTask = new Map<string, OrchestrationAction>();

  for (const action of actions.filter((item) => item.kind === "agent")) {
    const derivedId = action.taskId
      ? action.role === "dev" || action.role === "technical-writer"
        ? action.taskId
        : `${action.role}-${action.taskId}`
      : action.role;
    actionByAgentId.set(derivedId, action);
    actionByRoleTask.set(`${action.role}::${action.taskId || ""}::${action.parallelGroup}`, action);
  }

  return agentRuns.map((agent) => {
    const action = actionByRoleTask.get(`${agent.role}::${agent.taskId || ""}::${agent.parallelGroup}`) || actionByAgentId.get(agent.id);
    const handoffSchema = path.relative(cwd, path.join(runDir, "..", "..", "..", "library", "templates", "handoff.schema.json")) || "library/templates/handoff.schema.json";
    return {
      id: agent.id,
      role: agent.role,
      task_id: agent.taskId,
      workflow_state: agent.workflowState,
      run_id: runId,
      action_id: action?.id || `agent-${agent.id}`,
      status: action ? normalizeStatus(action.status) : normalizeAgentRunStatus(agent.status),
      kind: "agent",
      depends_on: action?.dependsOn || agent.dependsOn,
      read_scope: agent.readScope,
      write_scope: agent.writeScope,
      inputs: agent.inputs,
      required_outputs: agent.outputs,
      skills: agent.skills,
      handoff_schema: handoffSchema,
      allowed_transitions: allowedTransitionsForRole(agent.role),
      parallel_group: agent.parallelGroup,
      ready_reason: action?.status === "ready" ? action.reason : undefined,
      blocked_reason: action?.status === "blocked" ? action.reason : undefined
    };
  });
}
