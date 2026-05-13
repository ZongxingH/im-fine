import type { TaskState } from "./state-machine.js";
import { workflowState } from "./workflows.js";

type FixLoopRecoveryRunMode = "infer_dev" | "planned_if_possible";

interface FixLoopRecoveryWorkflowState {
  reason: string;
  recovery_task_state: TaskState;
  recovery_run_state: FixLoopRecoveryRunMode;
  fix_task_required?: boolean;
}

interface FixLoopRoleActionWorkflowState {
  role: string;
  action_id: string;
  parallel_group: string;
  reason: string;
}

interface FixLoopDesignReworkActor {
  role: string;
  action_id_pattern: string;
  parallel_group_pattern: string;
  reason: string;
}

interface FixLoopDesignReworkPlanner extends FixLoopDesignReworkActor {
  depends_on_pattern: string;
}

interface FixLoopDesignReworkWorkflowState extends FixLoopRecoveryWorkflowState {
  architect: FixLoopDesignReworkActor;
  task_planner: FixLoopDesignReworkPlanner;
}

export type FixLoopRecoveryStateId =
  | "qa_failed"
  | "review_changes_requested"
  | "implementation_blocked_by_design";

export type FixLoopRoleActionStateId =
  | "needs_conflict_resolution"
  | "needs_task_replan";

export function readFixLoopRecoveryState(stateId: FixLoopRecoveryStateId): FixLoopRecoveryWorkflowState {
  return workflowState<FixLoopRecoveryWorkflowState>("fix-loop", stateId);
}

export function readFixLoopRoleActionState(stateId: FixLoopRoleActionStateId): FixLoopRoleActionWorkflowState {
  return workflowState<FixLoopRoleActionWorkflowState>("fix-loop", stateId);
}

export function readFixLoopDesignReworkState(): FixLoopDesignReworkWorkflowState {
  return workflowState<FixLoopDesignReworkWorkflowState>("fix-loop", "implementation_blocked_by_design");
}

export function materializeFixLoopPattern(pattern: string, params: Record<string, string>): string {
  return pattern.replace(/\{([^}]+)\}/g, (_match, key) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing fix-loop pattern param: ${key}`);
    return value;
  });
}
