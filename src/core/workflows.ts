import { readLibrary } from "./library.js";

interface WorkflowStateMap {
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  id: string;
  states: WorkflowStateMap;
}

export function readWorkflow(id: string): WorkflowDefinition {
  const content = readLibrary("workflows", id);
  const parsed = JSON.parse(content) as Partial<WorkflowDefinition>;
  if (!parsed.id || typeof parsed.id !== "string") {
    throw new Error(`Workflow ${id} is missing id`);
  }
  if (!parsed.states || typeof parsed.states !== "object") {
    throw new Error(`Workflow ${id} is missing states`);
  }
  return {
    id: parsed.id,
    states: parsed.states
  };
}

export function workflowState<T>(workflowId: string, stateId: string): T {
  const workflow = readWorkflow(workflowId);
  const state = workflow.states[stateId];
  if (!state || typeof state !== "object") {
    throw new Error(`Workflow ${workflowId} is missing state ${stateId}`);
  }
  return state as T;
}
