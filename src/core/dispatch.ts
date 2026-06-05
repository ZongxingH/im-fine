import type { AgentRun, OrchestrationAction, OrchestrationActionStatus } from "./orchestrator.js";
import fs from "node:fs";
import path from "node:path";
import { allowedTransitionsForRole, evidenceRequirementsForRole, handoffSchemaForRole } from "./role-registry.js";

export interface DispatchContract {
  id: string;
  role: string;
  task_id?: string;
  workflow_state?: string;
  run_id: string;
  action_id: string;
  status: "ready" | "waiting" | "blocked" | "done";
  kind: "agent" | "runtime";
  depends_on: string[];
  read_scope: string[];
  write_scope: string[];
  inputs: string[];
  required_outputs: string[];
  expected_handoff_path: string;
  expected_provider_receipt_path: string;
  expected_output_paths: string[];
  skills: string[];
  handoff_schema: string;
  role_required_evidence: string[];
  allowed_transitions: string[];
  close_preconditions: string[];
  role_purity_policy: {
    orchestrator_may_author_outputs: false;
    required_author_role: string;
    provider_origin_receipt_required: boolean;
  };
  parallel_group: string;
  ready_reason?: string;
  blocked_reason?: string;
}

interface OrchestratorSessionSnapshot {
  next_actions?: OrchestrationAction[];
  agent_runs?: AgentRun[];
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

function readSessionSnapshot(file: string): OrchestratorSessionSnapshot {
  return JSON.parse(fs.readFileSync(file, "utf8")) as OrchestratorSessionSnapshot;
}

export function buildDispatchContracts(runId: string, runDir: string, orchestratorSessionFile: string): DispatchContract[] {
  const session = readSessionSnapshot(orchestratorSessionFile);
  const actions = Array.isArray(session.next_actions) ? session.next_actions : [];
  const agentRuns = Array.isArray(session.agent_runs) ? session.agent_runs : [];
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

  const agentContracts: DispatchContract[] = agentRuns.map((agent) => {
    const action = actionByRoleTask.get(`${agent.role}::${agent.taskId || ""}::${agent.parallelGroup}`) || actionByAgentId.get(agent.id);
    return {
      id: agent.id,
      role: agent.role,
      task_id: agent.taskId,
      workflow_state: agent.workflowState,
      run_id: runId,
      action_id: action?.id || `agent-${agent.id}`,
      status: action ? normalizeStatus(action.status) : normalizeAgentRunStatus(agent.status),
      kind: "agent" as const,
      depends_on: action?.dependsOn || agent.dependsOn,
      read_scope: agent.readScope,
      write_scope: agent.writeScope,
      inputs: agent.inputs,
      required_outputs: agent.outputs,
      expected_handoff_path: path.join(runDir, "agents", agent.id, "handoff.json"),
      expected_provider_receipt_path: path.join(runDir, "orchestration", "provider-receipts", `${(action?.id || `agent-${agent.id}`).replace(/[^a-zA-Z0-9_.-]+/g, "-")}.json`),
      expected_output_paths: Array.from(new Set([
        ...agent.outputs,
        path.join(runDir, "agents", agent.id, "handoff.json")
      ])),
      skills: agent.skills,
      handoff_schema: handoffSchemaForRole(agent.role),
      role_required_evidence: evidenceRequirementsForRole(agent.role),
      allowed_transitions: allowedTransitionsForRole(agent.role),
      close_preconditions: [
        "expected handoff exists and validates",
        "provider-origin receipt exists and validates",
        "outputs are authored inside declared write_scope",
        "QA/Reviewer findings use rework dispatch before final gates"
      ],
      role_purity_policy: {
        orchestrator_may_author_outputs: false,
        required_author_role: agent.role,
        provider_origin_receipt_required: true
      },
      parallel_group: agent.parallelGroup,
      ready_reason: action?.status === "ready" ? action.reason : undefined,
      blocked_reason: action?.status === "blocked" ? action.reason : undefined
    };
  });
  const agentActionIds = new Set(agentContracts.map((contract) => contract.action_id));
  const runtimeContracts: DispatchContract[] = actions
    .filter((action) => action.kind === "runtime")
    .map((action) => ({
      id: action.id,
      role: action.role,
      task_id: action.taskId,
      run_id: runId,
      action_id: action.id,
      status: normalizeStatus(action.status),
      kind: "runtime",
      depends_on: action.dependsOn,
      read_scope: [],
      write_scope: [],
      inputs: action.inputs,
      required_outputs: action.outputs,
      expected_handoff_path: "",
      expected_provider_receipt_path: "",
      expected_output_paths: action.outputs,
      skills: [],
      handoff_schema: "runtime-action-ledger",
      role_required_evidence: action.outputs,
      allowed_transitions: [],
      close_preconditions: [
        "runtime action ledger records completed status"
      ],
      role_purity_policy: {
        orchestrator_may_author_outputs: false,
        required_author_role: "runtime",
        provider_origin_receipt_required: false
      },
      parallel_group: action.parallelGroup,
      ready_reason: action.status === "ready" ? action.reason : undefined,
      blocked_reason: action.status === "blocked" ? action.reason : undefined
    }));
  const missingAgentActions: DispatchContract[] = actions
    .filter((action) => action.kind === "agent" && !agentActionIds.has(action.id))
    .map((action) => {
      const outputHandoff = action.outputs.find((item) => item.endsWith("handoff.json"));
      return {
        id: action.id,
        role: action.role,
        task_id: action.taskId,
        run_id: runId,
        action_id: action.id,
        status: normalizeStatus(action.status),
        kind: "agent" as const,
        depends_on: action.dependsOn,
        read_scope: [],
        write_scope: [],
        inputs: action.inputs,
        required_outputs: action.outputs,
        expected_handoff_path: outputHandoff || path.join(runDir, "agents", action.taskId ? `${action.role}-${action.taskId}` : action.role, "handoff.json"),
        expected_provider_receipt_path: path.join(runDir, "orchestration", "provider-receipts", `${action.id.replace(/[^a-zA-Z0-9_.-]+/g, "-")}.json`),
        expected_output_paths: Array.from(new Set([
          ...action.outputs,
          outputHandoff || path.join(runDir, "agents", action.taskId ? `${action.role}-${action.taskId}` : action.role, "handoff.json")
        ])),
        skills: [],
        handoff_schema: handoffSchemaForRole(action.role),
        role_required_evidence: evidenceRequirementsForRole(action.role),
        allowed_transitions: allowedTransitionsForRole(action.role),
        close_preconditions: [
          "expected handoff exists and validates",
          "provider-origin receipt exists and validates",
          "outputs are authored inside declared write_scope",
          "QA/Reviewer findings use rework dispatch before final gates"
        ],
        role_purity_policy: {
          orchestrator_may_author_outputs: false,
          required_author_role: action.role,
          provider_origin_receipt_required: true
        },
        parallel_group: action.parallelGroup,
        ready_reason: action.status === "ready" ? action.reason : undefined,
        blocked_reason: action.status === "blocked" ? action.reason : undefined
      };
    });
  return [...agentContracts, ...missingAgentActions, ...runtimeContracts];
}
