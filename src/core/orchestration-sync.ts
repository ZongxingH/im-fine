import { resumeRun } from "./orchestrator.js";

export function refreshOrchestrationSnapshot(cwd: string, runId: string): void {
  if (process.env.IMFINE_PROVIDER !== "codex" && process.env.IMFINE_PROVIDER !== "claude") return;
  if (process.env.IMFINE_SUBAGENT_SUPPORTED !== "true") return;
  try {
    resumeRun(cwd, runId);
  } catch {
    // Best-effort snapshot refresh. State-changing commands should not fail only because
    // the orchestration view could not be regenerated.
  }
}
