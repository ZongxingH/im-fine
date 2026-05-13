import type { ArchiveResult } from "./archive.js";
import type { AgentExecuteResult, AgentPrepareResult } from "./agent-execution.js";
import type { AutoOrchestratorResult } from "./auto-orchestrator.js";
import type { DoctorReport, InitResult } from "./types.js";
import type { CommitResult, PushResult } from "./gitflow.js";
import type { InstallResult } from "./install.js";
import type { LibraryEntry, LibrarySyncResult } from "./library.js";
import type { NewProjectDeliveryResult } from "./new-project.js";
import type { OrchestratorResult } from "./orchestrator.js";
import type { PlanResult } from "./plan.js";
import type { DesignReworkResult, ReviewResult, VerificationResult } from "./quality.js";
import type { ReplanResult } from "./replan.js";
import type { RecoveryResult } from "./recovery.js";
import type { DeliveryRunResult } from "./run.js";
import type { SessionSummarizedAutoOrchestratorResult, SessionSummarizedOrchestratorResult } from "./session-summary.js";
import type { ReportResult, StatusResult } from "./status.js";
import type { PatchCollectResult, PatchValidationResult, WorktreePrepareResult } from "./worktree.js";

export function formatDoctor(report: DoctorReport): string {
  const lines = [
    `imfine doctor: ${report.cwd}`,
    `summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    ""
  ];
  for (const item of report.checks) {
    lines.push(`[${item.status}] ${item.label}: ${item.detail}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatInit(result: InitResult): string {
  return [
    `initialized imfine workspace: ${result.workspace}`,
    `project mode: ${result.projectMode}`,
    `architecture placeholders: ${result.architecture.files.length}`,
    result.architecture.architectInput ? `architect input: ${result.architecture.architectInput}` : "architect input: none",
    `created: ${result.created.length}`,
    `updated: ${result.updated.length}`,
    `preserved: ${result.preserved.length}`,
    "",
    formatDoctor(result.doctor)
  ].join("\n");
}

export function formatLibraryList(kind: string, entries: LibraryEntry[]): string {
  const lines = [`imfine ${kind}:`];
  for (const entry of entries) lines.push(`- ${entry.id}`);
  if (entries.length === 0) lines.push("- none");
  return `${lines.join("\n")}\n`;
}

export function formatLibrarySync(result: LibrarySyncResult): string {
  return [
    `synced imfine library: ${result.workspace}`,
    `created: ${result.created.length}`,
    `updated: ${result.updated.length}`,
    `preserved: ${result.preserved.length}`,
    ""
  ].join("\n");
}

export function formatInstall(result: InstallResult): string {
  const lines = [
    result.dryRun ? "imfine install dry run" : "imfine install complete",
    `target: ${result.target}`,
    `language: ${result.language}`,
    `runtime: ${result.runtime}`,
    "written:"
  ];
  for (const item of result.written) lines.push(`- ${item}`);
  return `${lines.join("\n")}\n`;
}

export function formatStatus(result: StatusResult): string {
  return [
    `imfine status: ${result.cwd}`,
    `initialized: ${result.initialized ? "yes" : "no"}`,
    `workspace: ${result.workspace}`,
    `current run: ${result.currentRunId || "none"}`,
    `current run status: ${result.currentRunStatus || "none"}`,
    `current run branch: ${result.currentRunBranch || "none"}`,
    `reports: ${result.reports.length === 0 ? "none" : result.reports.join(", ")}`,
    ""
  ].join("\n");
}

export function formatReport(result: ReportResult): string {
  if (!result.exists) {
    return `report not found: ${result.file}\n`;
  }
  return result.content || "";
}

export function formatDeliveryRun(result: DeliveryRunResult): string {
  return [
    `created imfine run: ${result.runId}`,
    `status: ${result.status}`,
    `project kind: ${result.projectKind}`,
    `run dir: ${result.runDir}`,
    `runtime context: ${result.runDir}/orchestration/context.json`,
    `pending roles: ${result.runDir}/orchestration/pending-roles.json`,
    `task graph: pending model task planner output`,
    `artifacts: ${result.artifacts.length}`,
    ""
  ].join("\n");
}

export function formatPlan(result: PlanResult): string {
  return [
    `planned imfine run: ${result.runId}`,
    `task graph: ${result.taskGraph}`,
    `ownership: ${result.ownership}`,
    `execution plan: ${result.executionPlan}`,
    `commit plan: ${result.commitPlan}`,
    `validation: ${result.validation.passed ? "pass" : "fail"}`,
    `parallel groups: ${result.validation.parallelGroups.length}`,
    `serial tasks: ${result.validation.serialTasks.length}`,
    ""
  ].join("\n");
}

export function formatWorktreePrepare(result: WorktreePrepareResult): string {
  return [
    `prepared worktrees for run: ${result.runId}`,
    `run branch: ${result.runBranch}`,
    `worktree root: ${result.worktreeRoot}`,
    `tasks: ${result.tasks.length}`,
    ...result.tasks.map((task) => `- ${task.task_id}: ${task.path}`),
    ""
  ].join("\n");
}

export function formatPatchValidation(result: PatchValidationResult): string {
  return [
    `patch validation: ${result.passed ? "pass" : "fail"}`,
    "changed files:",
    ...(result.changedFiles.length > 0 ? result.changedFiles.map((file) => `- ${file}`) : ["- none"]),
    "errors:",
    ...(result.errors.length > 0 ? result.errors.map((error) => `- ${error}`) : ["- none"]),
    ""
  ].join("\n");
}

export function formatPatchCollect(result: PatchCollectResult): string {
  return [
    `collected patch for ${result.runId}/${result.taskId}`,
    `patch: ${result.patch}`,
    `commands: ${result.commands}`,
    `evidence: ${result.evidence}`,
    `validation: ${result.validation.passed ? "pass" : "fail"}`,
    ""
  ].join("\n");
}

export function formatVerification(result: VerificationResult): string {
  return [
    `verified ${result.runId}/${result.taskId}: ${result.status}`,
    `summary: ${result.summary || "none"}`,
    `commands: ${result.commands.length}`,
    `evidence: ${result.evidence}`,
    `agent: ${result.agent}`,
    `fix task: ${result.fixTaskId || "none"}`,
    "errors:",
    ...(result.errors.length > 0 ? result.errors.map((error) => `- ${error}`) : ["- none"]),
    ""
  ].join("\n");
}

export function formatReview(result: ReviewResult): string {
  return [
    `reviewed ${result.runId}/${result.taskId}: ${result.status}`,
    `summary: ${result.summary || "none"}`,
    `evidence: ${result.evidence}`,
    `agent: ${result.agent}`,
    `fix task: ${result.fixTaskId || "none"}`,
    "errors:",
    ...(result.errors.length > 0 ? result.errors.map((error) => `- ${error}`) : ["- none"]),
    ""
  ].join("\n");
}

export function formatDesignRework(result: DesignReworkResult): string {
  return [
    `requested design rework for ${result.runId}/${result.taskId}`,
    `status: ${result.status}`,
    `summary: ${result.summary || "none"}`,
    `evidence: ${result.evidence}`,
    `architect input: ${result.architectInput}`,
    `task planner input: ${result.taskPlannerInput}`,
    ""
  ].join("\n");
}

export function formatRecovery(result: RecoveryResult): string {
  return [
    `recovered task ${result.runId}/${result.taskId}`,
    `task state: ${result.fromTaskState} -> ${result.toTaskState}`,
    `run state: ${result.fromRunState} -> ${result.toRunState}`,
    ""
  ].join("\n");
}

export function formatReplan(result: ReplanResult): string {
  return [
    `requested task-planner replan for ${result.runId}`,
    `status: ${result.status}`,
    `reason: ${result.reason}`,
    `input: ${result.input}`,
    `report: ${result.report}`,
    ""
  ].join("\n");
}

export function formatCommit(result: CommitResult): string {
  return [
    `committed run ${result.runId}`,
    `mode: ${result.mode}`,
    `branch: ${result.runBranch}`,
    `worktree: ${result.runWorktree}`,
    `evidence: ${result.evidence}`,
    "commits:",
    ...result.commits.map((commit) => `- ${commit.hash}: ${commit.taskIds.join(", ")}`),
    ""
  ].join("\n");
}

export function formatPush(result: PushResult): string {
  return [
    `pushed run ${result.runId}: ${result.status}`,
    `branch: ${result.runBranch}`,
    `remote: ${result.remote}`,
    `worktree: ${result.runWorktree}`,
    `evidence: ${result.evidence}`,
    ""
  ].join("\n");
}

export function formatArchive(result: ArchiveResult): string {
  return [
    `archived run ${result.runId}: ${result.status}`,
    `archive report: ${result.archiveReport}`,
    `user report: ${result.userReport}`,
    `project updates: ${result.projectUpdates}`,
    `final summary: ${result.finalSummary}`,
    `agent: ${result.agent}`,
    `blocked items: ${result.blockedItems.length}`,
    ""
  ].join("\n");
}

export function formatNewProjectDelivery(result: NewProjectDeliveryResult): string {
  return [
    `delivered new project run ${result.runId}: ${result.status}`,
    `project worktree: ${result.projectWorktree}`,
    `run branch: ${result.commit.runBranch}`,
    `commits: ${result.commit.commits.map((commit) => commit.hash).join(", ")}`,
    `push: ${result.push.status}`,
    `archive report: ${result.archive.archiveReport}`,
    `user report: ${result.archive.userReport}`,
    ""
  ].join("\n");
}

function formatSessionSummary(result: unknown): string[] {
  const sessionSummary = (result as { sessionSummary?: SessionSummarizedOrchestratorResult["sessionSummary"] | SessionSummarizedAutoOrchestratorResult["sessionSummary"] }).sessionSummary;
  if (!sessionSummary) return [];
  return [
    "session summary:",
    `- orchestrator: ${sessionSummary.orchestrator.summary}`,
    ...sessionSummary.agents.map((agent) => `- ${agent.role}${agent.taskId ? `/${agent.taskId}` : ""}: ${agent.summary}`)
  ];
}

export function formatOrchestrator(result: OrchestratorResult | SessionSummarizedOrchestratorResult): string {
  return [
    `${result.mode === "resume" ? "resumed" : "orchestrated"} imfine run: ${result.runId}`,
    `status: ${result.status}`,
    `next actions: ${result.nextActions.length}`,
    `agent runs: ${result.agentRuns.length}`,
    `dispatch contracts: ${result.dispatchContracts.length}`,
    `parallel groups: ${result.parallelGroups.length}`,
    `state: ${result.files.state}`,
    `queue: ${result.files.queue}`,
    `contracts: ${result.files.dispatchContracts}`,
    `timeline: ${result.files.timeline}`,
    "actions:",
    ...(result.nextActions.length > 0
      ? result.nextActions.map((action) => `- [${action.status}] ${action.id}${action.command ? `: ${action.command}` : ""}`)
      : ["- none"]),
    ...formatSessionSummary(result),
    ""
  ].join("\n");
}

export function formatAgentPrepare(result: AgentPrepareResult): string {
  return [
    `prepared legacy bridge artifacts for run: ${result.runId}`,
    `usage: debug/testing only`,
    `dispatch: ${result.dispatch}`,
    `packages: ${result.packages.length}`,
    ...result.packages.map((item) => `- [${item.status}] ${item.id}: ${item.prompt}`),
    ""
  ].join("\n");
}

export function formatAgentExecute(result: AgentExecuteResult): string {
  return [
    `executed legacy bridge batch for run: ${result.runId}`,
    `usage: debug/testing only`,
    `executor: ${result.executor}`,
    `dry run: ${result.dryRun ? "yes" : "no"}`,
    `dispatch: ${result.dispatch}`,
    `results: ${result.results.length}`,
    ...result.results.map((item) => `- [${item.status}] ${item.id}: ${item.prompt}`),
    ""
  ].join("\n");
}

export function formatAutoOrchestrator(result: AutoOrchestratorResult | SessionSummarizedAutoOrchestratorResult): string {
  return [
    `auto orchestration run: ${result.runId}`,
    `status: ${result.status}`,
    `iterations: ${result.iterations}`,
    `timeline: ${result.timeline}`,
    `steps: ${result.steps.length}`,
    ...result.steps.map((step) => `- ${step.iteration} [${step.status}] ${step.actionId}: ${step.detail}`),
    ...formatSessionSummary(result),
    ""
  ].join("\n");
}
