import { resumeRun } from "./orchestrator.js";

export function refreshOrchestrationSnapshot(cwd: string, runId: string): void {
  try {
    resumeRun(cwd, runId);
  } catch {
    // Best-effort snapshot refresh. State-changing commands should not fail only because
    // the orchestration view could not be regenerated.
  }
}
