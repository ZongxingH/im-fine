import type { ArchiveResult } from "./archive.js";
import type { AutoOrchestratorResult } from "./auto-orchestrator.js";
import type { DoctorReport, InitResult } from "./types.js";
import type { CommitResult, PushResult } from "./gitflow.js";
import type { InstallResult } from "./install.js";
import type { LibraryEntry, LibrarySyncResult } from "./library.js";
import type { OrchestratorResult } from "./orchestrator.js";
import type { DesignReworkResult, ReviewResult, VerificationResult } from "./quality.js";
import type { ReplanResult } from "./replan.js";
import type { RecoveryResult } from "./recovery.js";
import type { DeliveryRunResult } from "./run.js";
import type { SessionSummarizedAutoOrchestratorResult, SessionSummarizedOrchestratorResult } from "./session-summary.js";
import type { ReportResult, StatusResult } from "./status.js";
import type { PatchCollectResult, PatchValidationResult, WorktreePrepareResult } from "./worktree.js";

export type StatusFormatView = "summary" | "story" | "debug";

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
    `architecture files: ${result.architecture.files.length}`,
    `architecture status: ${result.architecture.status || result.architecture.mode}`,
    result.architecture.architectInput ? `architect input: ${result.architecture.architectInput}` : "architect input: none",
    result.architecture.architectHandoff ? `architect handoff: ${result.architecture.architectHandoff}` : "architect handoff: none",
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

function compactGateLines(result: StatusResult): string[] {
  const gates = result.currentRunGates || {};
  const receipts = result.currentRunProviderReceipts;
  const dispatch = result.currentRunDispatch;
  const handoffCount = Math.max(
    result.currentRunAgentNameMap?.mappings.filter((item) => item.handoffPath).length || 0,
    result.currentRunHandoffFiles.length
  );
  const receiptLine = receipts
    ? `${receipts.validReceiptCount}/${Math.max(receipts.validReceiptCount + receipts.missingProviderReceiptActionIds.length, receipts.receiptCount)}`
    : "none";
  return [
    `- [gate:planning] planning: ${gates.planning || "not ready"}`,
    `- [gate:dispatch] dispatch: ${gates.dispatch || (dispatch ? dispatch.missingCompletedWaveActionIds.length === 0 ? "pass" : "blocked" : "not ready")}`,
    `- [gate:provider-receipts] provider receipts: ${receiptLine}`,
    `- [gate:handoffs] handoffs: ${handoffCount}`,
    `- [gate:role-purity] role purity: ${gates.role_purity || "not ready"}`,
    `- [gate:qa] QA: ${gates.qa || result.currentRunQualityLineage?.qa || "not ready"}${result.currentRunQualityLineage ? `, coverage ${result.currentRunQualityLineage.coverage.qaPassed}/${result.currentRunQualityLineage.coverage.qaExpected}` : ""}`,
    `- [gate:review] review: ${gates.review || result.currentRunQualityLineage?.review || "not ready"}${result.currentRunQualityLineage ? `, coverage ${result.currentRunQualityLineage.coverage.reviewPassed}/${result.currentRunQualityLineage.coverage.reviewExpected}` : ""}`,
    `- [gate:archive] archive: ${gates.archive || "not ready"}`,
    `- [gate:true-harness] true harness: ${gates.true_harness || result.currentRunTrueHarnessFreshness?.status || "not ready"}`
  ];
}

function agentProgressLines(result: StatusResult): string[] {
  const progress = result.currentRunAgentProgress;
  if (!progress) return ["- none"];
  return [
    `- Architect: ${progress.architect}`,
    `- Task Planner: ${progress.taskPlanner}`,
    `- Dev: ${progress.devCompleted}/${progress.devTotal} completed`,
    `- QA: ${progress.qaPassed}/${progress.qaTotal} passed`,
    `- Review: ${progress.reviewApproved}/${progress.reviewTotal} approved`
  ];
}

function gatePhaseLines(result: StatusResult): string[] {
  const gates = result.currentRunGates || null;
  const standardEvidence = result.currentRunStandardEvidence
    ? result.currentRunStandardEvidence.missing.length === 0 ? "pass" : "blocked"
    : "not ready";
  const qualityLineage = result.currentRunQualityLineage
    ? [result.currentRunQualityLineage.qa, result.currentRunQualityLineage.review, result.currentRunQualityLineage.recheckFixLoop].every((status) => status === "pass") ? "pass" : "blocked"
    : "not ready";
  const finalGates = gates
    ? Object.values(gates).every((status) => status === "pass") ? "pass" : "blocked"
    : "not ready";
  return [
    `1. [runtime] collect standard evidence: ${standardEvidence}`,
    `2. [runtime] quality lineage: ${qualityLineage}`,
    `3. [gate:role-purity] role purity: ${gates?.role_purity || "not ready"}`,
    `4. [gate:true-harness] true harness evidence: ${gates?.true_harness || result.currentRunTrueHarnessFreshness?.status || "not ready"}`,
    `5. [gate:final-gates] final gates: ${finalGates}`
  ];
}

function agentAuthoredEvidence(result: StatusResult): string[] {
  const fromMap = result.currentRunAgentNameMap?.mappings
    .map((item) => item.handoffPath)
    .filter((item): item is string => Boolean(item)) || [];
  const quality = result.currentRunQualityLineage?.latest
    .map((item) => item.latestHandoff)
    .filter((item): item is string => Boolean(item)) || [];
  return Array.from(new Set([...fromMap, ...quality, ...result.currentRunHandoffFiles])).sort();
}

function runtimeDerivedEvidence(result: StatusResult): string[] {
  const entries = [
    result.currentRunDispatch
      ? `dispatch contracts: ${result.currentRunDispatch.missingCompletedWaveActionIds.length === 0 ? "pass" : "blocked"}`
      : "",
    result.currentRunProviderReceipts
      ? `provider receipts: ${result.currentRunProviderReceipts.validReceiptCount}/${Math.max(result.currentRunProviderReceipts.validReceiptCount + result.currentRunProviderReceipts.missingProviderReceiptActionIds.length, result.currentRunProviderReceipts.receiptCount)}`
      : "",
    result.currentRunTrueHarnessFreshness ? `true harness evidence: ${result.currentRunTrueHarnessFreshness.status}` : "",
    result.currentRunGates
      ? `final gates: ${Object.values(result.currentRunGates).every((status) => status === "pass") ? "pass" : "blocked"}`
      : "",
    result.currentRunRuntimeRequirements ? `runtime requirements: ${result.currentRunRuntimeRequirements.status}` : "",
    result.currentRunSandboxVerification?.present ? `sandbox verification: ${result.currentRunSandboxVerification.status}` : "",
    result.currentRunHarnessComponents ? `harness components: ${result.currentRunHarnessComponents.componentCount}` : ""
  ].filter((item) => item.length > 0);
  return Array.from(new Set(entries));
}

function blockingReason(result: StatusResult): string {
  if (result.currentRunBlockers?.firstReason) {
    return result.currentRunBlockers.firstReason;
  }
  if (result.currentRunNextOwner && result.currentRunNextOwner.reason !== "no blocking next action detected") {
    return `${result.currentRunNextOwner.owner}: ${result.currentRunNextOwner.reason}`;
  }
  if (result.currentRunBlockers && result.currentRunBlockers.status !== "clear") {
    return `${result.currentRunBlockers.items} blocker(s); ${result.currentRunBlockers.nextAction || "see blocker summary"}`;
  }
  return "none";
}

function rootCauseLines(result: StatusResult): string[] {
  const reason = blockingReason(result);
  const downstream: string[] = [];
  if (result.currentRunDispatch?.contractCount === 0) downstream.push("dispatch contracts");
  if (result.currentRunProviderReceipts?.validReceiptCount === 0) downstream.push("provider receipts");
  if (!result.currentRunQualityLineage || [result.currentRunQualityLineage.qa, result.currentRunQualityLineage.review, result.currentRunQualityLineage.recheckFixLoop].some((status) => status !== "pass")) {
    downstream.push("quality lineage");
  }
  if (!result.currentRunGates || result.currentRunGates.role_purity !== "pass") downstream.push("role purity");
  if (!result.currentRunGates || !Object.values(result.currentRunGates).every((status) => status === "pass")) downstream.push("final gates");
  return [
    `- root cause: ${reason}`,
    `- not evaluated or blocked downstream: ${downstream.length > 0 ? Array.from(new Set(downstream)).join(", ") : "none"}`
  ];
}

function nextAction(result: StatusResult): string {
  if (result.currentRunNextOwner && result.currentRunNextOwner.reason !== "no blocking next action detected") {
    return `${result.currentRunNextOwner.owner} next action: ${result.currentRunNextOwner.reason}`;
  }
  if (result.currentRunActions) {
    if (result.currentRunActions.ready > 0) return `orchestrator dispatches ${result.currentRunActions.ready} ready action(s)`;
    if (result.currentRunActions.waiting > 0) return "waiting for provider-origin agent handoff";
    if (result.currentRunActions.blocked > 0) return "blocked actions need replan or remediation dispatch";
  }
  return result.currentRunStatus === "completed" ? "archive complete" : "none";
}

function formatStatusSummary(result: StatusResult): string {
  const agentEvidence = agentAuthoredEvidence(result);
  const runtimeEvidence = runtimeDerivedEvidence(result);
  return [
    "[runtime] context materialized",
    `Run: ${result.currentRunId || "none"}`,
    `State: ${result.currentRunStatus || "none"}`,
    `Execution: ${result.currentRunExecutionMode || "none"}`,
    ...(result.currentRunDemoWarnings.length > 0 ? ["", "Warnings:", ...result.currentRunDemoWarnings.map((warning) => `- ${warning}`)] : []),
    "",
    "Agent progress:",
    ...agentProgressLines(result),
    "",
    "Evidence Origin",
    "Agent-authored:",
    ...(agentEvidence.length > 0 ? agentEvidence.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Runtime-derived:",
    ...(runtimeEvidence.length > 0 ? runtimeEvidence.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Gate phase:",
    ...gatePhaseLines(result),
    "",
    "Root cause:",
    ...rootCauseLines(result),
    "",
    "Gates:",
    ...compactGateLines(result),
    "",
    "Blocked:",
    `- ${blockingReason(result)}`,
    "",
    "Next:",
    `- ${nextAction(result)}`,
    ""
  ].join("\n");
}

function formatStatusStory(result: StatusResult): string {
  const actions = result.currentRunActions;
  const receipts = result.currentRunProviderReceipts;
  const currentWave = actions
    ? [
      `- ready: ${actions.ready}`,
      `- waiting: ${actions.waiting}`,
      `- blocked: ${actions.blocked}`,
      `- groups: ${actions.currentParallelGroups.join(",") || "none"}`
    ]
    : ["- none"];
  return [
    `Run: ${result.currentRunId || "none"}`,
    `State: ${result.currentRunStatus || "none"}`,
    "",
    "Current wave:",
    ...currentWave,
    "",
    "Agent progress:",
    ...agentProgressLines(result),
    "",
    "Evidence:",
    `- provider receipts: ${receipts ? `${receipts.validReceiptCount}/${Math.max(receipts.validReceiptCount + receipts.missingProviderReceiptActionIds.length, receipts.receiptCount)}` : "none"}`,
    `- handoffs: ${agentAuthoredEvidence(result).length}`,
    `- role purity: ${result.currentRunGates?.role_purity || "not ready"}`,
    "",
    "Gate phase:",
    ...gatePhaseLines(result),
    "",
    "Root cause:",
    ...rootCauseLines(result),
    "",
    "Gates:",
    ...compactGateLines(result),
    "",
    "Blocked:",
    `- ${blockingReason(result)}`,
    "",
    "Next:",
    `- ${nextAction(result)}`,
    ""
  ].join("\n");
}

function formatStatusDebug(result: StatusResult): string {
  const gates = result.currentRunGates
    ? Object.entries(result.currentRunGates).map(([key, value]) => `${key}=${value}`).join(", ")
    : "none";
  const actions = result.currentRunActions
    ? `ready=${result.currentRunActions.ready}, waiting=${result.currentRunActions.waiting}, blocked=${result.currentRunActions.blocked}, groups=${result.currentRunActions.currentParallelGroups.join(",") || "none"}`
    : "none";
  const dispatch = result.currentRunDispatch
    ? `contracts=${result.currentRunDispatch.contractCount}, waves=${result.currentRunDispatch.waveCount}, missing_completed_waves=${result.currentRunDispatch.missingCompletedWaveActionIds.join(",") || "none"}`
    : "none";
  const receipts = result.currentRunProviderReceipts
    ? `receipts=${result.currentRunProviderReceipts.receiptCount}, valid=${result.currentRunProviderReceipts.validReceiptCount}, missing=${result.currentRunProviderReceipts.missingProviderReceiptActionIds.join(",") || "none"}, invalid=${result.currentRunProviderReceipts.invalidProviderReceiptActionIds.join(",") || "none"}`
    : "none";
  const observations = result.currentRunProviderObservations
    ? `present=${result.currentRunProviderObservations.present ? "yes" : "no"}, count=${result.currentRunProviderObservations.observationCount}, names=${result.currentRunProviderObservations.observedAgentNames.join(",") || "none"}, closed=${result.currentRunProviderObservations.observedClosedCount}, screenshots=${result.currentRunProviderObservations.screenshots.join(",") || "none"}, boundary=${result.currentRunProviderObservations.proofBoundary}`
    : "none";
  const nameMap = result.currentRunAgentNameMap
    ? `present=${result.currentRunAgentNameMap.present ? "yes" : "no"}, mappings=${result.currentRunAgentNameMap.mappings.map((item) => `${item.providerDisplayName}->${item.actionId}/${item.dispatchContractId}`).join(",") || "none"}`
    : "none";
  const freshness = result.currentRunTrueHarnessFreshness
    ? `${result.currentRunTrueHarnessFreshness.status}, stale_sources=${result.currentRunTrueHarnessFreshness.staleSources.join(" | ") || "none"}`
    : "none";
  const quality = result.currentRunQualityLineage
    ? `qa=${result.currentRunQualityLineage.qa}, review=${result.currentRunQualityLineage.review}, recheck=${result.currentRunQualityLineage.recheckFixLoop}, latest=${result.currentRunQualityLineage.latest.map((item) => `${item.role}/${item.taskId}:${item.status}:${item.latestStatus}`).join(",") || "none"}`
    : "none";
  const standardEvidence = result.currentRunStandardEvidence
    ? `missing=${result.currentRunStandardEvidence.missing.join(",") || "none"}, records=${result.currentRunStandardEvidence.records.map((item) => `${item.id}:${item.exists ? "present" : "missing"}`).join(",") || "none"}`
    : "none";
  const runtimeRequirements = result.currentRunRuntimeRequirements
    ? `status=${result.currentRunRuntimeRequirements.status}, declared=${result.currentRunRuntimeRequirements.declaredLanguages.join(",") || "none"}, files=${result.currentRunRuntimeRequirements.declarationFiles.join(",") || "none"}, blocked=${result.currentRunRuntimeRequirements.blockedChecks.join(",") || "none"}`
    : "none";
  const sandboxVerification = result.currentRunSandboxVerification
    ? `present=${result.currentRunSandboxVerification.present ? "yes" : "no"}, status=${result.currentRunSandboxVerification.status}, commands=${result.currentRunSandboxVerification.commandCount}, failed=${result.currentRunSandboxVerification.failedCommands.join(",") || "none"}, mismatch=${result.currentRunSandboxVerification.environmentMismatch ? "yes" : "no"}`
    : "none";
  const harnessComponents = result.currentRunHarnessComponents
    ? `components=${result.currentRunHarnessComponents.componentCount}, issue_coverage=${result.currentRunHarnessComponents.issueCoverageCount}, file=${result.currentRunHarnessComponents.file}`
    : "none";
  const blockerTrace = result.currentRunRecentBlockerTrace.length > 0
    ? result.currentRunRecentBlockerTrace.map((item) => `${item.actionId}/${item.componentId}: ${item.reason}`).join(" | ")
    : "none";
  const debuggerReport = result.currentRunHarnessDebugger
    ? `overview=${result.currentRunHarnessDebugger.overview}, detail=${result.currentRunHarnessDebugger.detail}, primary=${result.currentRunHarnessDebugger.primaryBlocker || "none"}`
    : "none";
  const nextOwner = result.currentRunNextOwner
    ? `${result.currentRunNextOwner.owner}: ${result.currentRunNextOwner.reason}; evidence=${result.currentRunNextOwner.evidence.join(",") || "none"}`
    : "none";
  const blockers = result.currentRunBlockers
    ? `${result.currentRunBlockers.status}, items=${result.currentRunBlockers.items}, first=${result.currentRunBlockers.firstReason || "none"}, file=${result.currentRunBlockers.file}, next=${result.currentRunBlockers.nextAction || "none"}, doc=${result.currentRunBlockers.diagnosticDoc || "none"}`
    : "none";
  const checkpoint = result.currentRunLatestCheckpoint
    ? `${result.currentRunLatestCheckpoint.actionId}:${result.currentRunLatestCheckpoint.status} (${result.currentRunLatestCheckpoint.detail})`
    : "none";
  return [
    `imfine status: ${result.cwd}`,
    `initialized: ${result.initialized ? "yes" : "no"}`,
    `workspace: ${result.workspace}`,
    `current run: ${result.currentRunId || "none"}`,
    `current run status: ${result.currentRunStatus || "none"}`,
    `current run execution mode: ${result.currentRunExecutionMode || "none"}`,
    `current run branch: ${result.currentRunBranch || "none"}`,
    `current run consistency: ${result.currentRunConsistency || "none"}`,
    `current run gates: ${gates}`,
    `current run dispatch: ${dispatch}`,
    `current run provider receipts: ${receipts}`,
    `current run provider observations: ${observations}`,
    `current run agent name map: ${nameMap}`,
    `current run true harness freshness: ${freshness}`,
    `current run quality lineage: ${quality}`,
    `current run standard evidence: ${standardEvidence}`,
    `current run runtime requirements: ${runtimeRequirements}`,
    `current run sandbox verification: ${sandboxVerification}`,
    `current run harness components: ${harnessComponents}`,
    `current run blocker trace: ${blockerTrace}`,
    `current run harness debugger: ${debuggerReport}`,
    `current run next owner: ${nextOwner}`,
    `current run actions: ${actions}`,
    `current run blockers: ${blockers}`,
    `current run latest checkpoint: ${checkpoint}`,
    `runs: ${result.runs.length === 0 ? "none" : result.runs.map((run) => `${run.runId}(${run.relation}:${run.status})`).join(", ")}`,
    `reports: ${result.reports.length === 0 ? "none" : result.reports.join(", ")}`,
    ""
  ].join("\n");
}

export function formatStatus(result: StatusResult, view: StatusFormatView = "summary"): string {
  if (view === "debug") return formatStatusDebug(result);
  if (view === "story") return formatStatusStory(result);
  return formatStatusSummary(result);
}

export function formatReport(result: ReportResult): string {
  if (!result.exists) {
    return `report not found: ${result.file}\n`;
  }
  return result.content || "";
}

export function formatReportDemoSummary(result: ReportResult, statusResult: StatusResult): string {
  if (!result.exists) return `report not found: ${result.file}\n`;
  const title = (result.content || "").split("\n").find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") || "Report";
  return [
    `[runtime] report summarized for demo`,
    `Run: ${result.runId}`,
    `Report: ${title}`,
    "",
    "Evidence Origin",
    "Agent-authored:",
    ...(agentAuthoredEvidence(statusResult).length > 0 ? agentAuthoredEvidence(statusResult).map((item) => `- ${item}`) : ["- see archive report"]),
    "",
    "Runtime-derived:",
    ...(runtimeDerivedEvidence(statusResult).length > 0 ? runtimeDerivedEvidence(statusResult).map((item) => `- ${item}`) : ["- final report"]),
    "",
    "Gate phase:",
    ...gatePhaseLines(statusResult),
    "",
    "Root cause:",
    ...rootCauseLines(statusResult),
    "",
    "Gates:",
    ...compactGateLines(statusResult),
    "",
    "Blocked:",
    `- ${blockingReason(statusResult)}`,
    ""
  ].join("\n");
}

export function formatDeliveryRun(result: DeliveryRunResult): string {
  return [
    `[runtime] created run context`,
    `Run: ${result.runId}`,
    `State: ${result.status}`,
    `Execution: ${result.executionMode}`,
    `[orchestrator] dispatch mode: current session launches independent native subagents`,
    `[runtime] artifacts materialized: ${result.artifacts.length}`,
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
    `audit: ${result.audit}`,
    ""
  ].join("\n");
}

export function formatRecovery(result: RecoveryResult): string {
  return [
    `recovered task ${result.runId}/${result.taskId}`,
    `task state: ${result.fromTaskState} -> ${result.toTaskState}`,
    `run state: ${result.fromRunState} -> ${result.toRunState}`,
    `audit: ${result.audit}`,
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
    `audit: ${result.audit}`,
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
    `archive run ${result.runId}: ${result.status}`,
    `archive report: ${result.archiveReport}`,
    `user report: ${result.userReport}`,
    `project updates: ${result.projectUpdates}`,
    `final summary: ${result.finalSummary}`,
    `agent: ${result.agent}`,
    `blocked items: ${result.blockedItems.length}`,
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
  const agentActions = result.nextActions.filter((action) => action.kind === "agent");
  const runtimeActions = result.nextActions.filter((action) => action.kind === "runtime");
  const readyAgents = agentActions.filter((action) => action.status === "ready");
  const waitingAgents = agentActions.filter((action) => action.status === "waiting");
  const blockedAgents = agentActions.filter((action) => action.status === "blocked");
  return [
    `[orchestrator] ${result.mode === "resume" ? "resumed" : "planned"} run ${result.runId}`,
    `State: ${result.status}`,
    `Execution: ${result.executionMode}`,
    "",
    "Current wave:",
    `- agent ready: ${readyAgents.length}`,
    `- agent waiting: ${waitingAgents.length}`,
    `- agent blocked: ${blockedAgents.length}`,
    `- runtime checkpoints: ${runtimeActions.length}`,
    `- parallel groups: ${result.parallelGroups.length}`,
    "",
    "Dispatch:",
    ...(readyAgents.length > 0
      ? readyAgents.map((action) => `- [orchestrator] dispatch ${action.role}${action.taskId ? `/${action.taskId}` : ""} (${action.id})`)
      : ["- none"]),
    "",
    "Runtime:",
    `- [runtime] dispatch contracts: ${result.dispatchContracts.length}`,
    ...formatSessionSummary(result),
    ""
  ].join("\n");
}

export function formatAutoOrchestrator(result: AutoOrchestratorResult | SessionSummarizedAutoOrchestratorResult): string {
  const runtimeSteps = result.steps.filter((step) => step.kind === "runtime");
  const agentSteps = result.steps.filter((step) => step.kind === "agent");
  const lastStep = result.steps.at(-1);
  return [
    `[orchestrator] auto orchestration run ${result.runId}`,
    `State: ${result.status}`,
    `Iterations: ${result.iterations}`,
    "",
    "Runtime checkpoints:",
    `- ${runtimeSteps.length}`,
    "",
    "Agent events:",
    ...(agentSteps.length > 0
      ? agentSteps.map((step) => `- [agent:${step.actionId}] ${step.status}`)
      : ["- none"]),
    "",
    "Gates:",
    `- [gate:last-event] last event: ${lastStep ? `${lastStep.status} (${lastStep.detail})` : "none"}`,
    ...formatSessionSummary(result),
    ""
  ].join("\n");
}
