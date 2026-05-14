import { archiveRun } from "./archive.js";
import { parseArgs, readBooleanFlag, readStringFlag } from "./args.js";
import { runAutoOrchestrator } from "./auto-orchestrator.js";
import { doctor } from "./doctor.js";
import { formatArchive, formatAutoOrchestrator, formatCommit, formatDeliveryRun, formatDesignRework, formatDoctor, formatInit, formatInstall, formatLibraryList, formatLibrarySync, formatOrchestrator, formatPatchCollect, formatPatchValidation, formatPush, formatRecovery, formatReplan, formatReport, formatReview, formatStatus, formatVerification, formatWorktreePrepare } from "./format.js";
import { commitRun, commitTask, pushRun, type CommitMode } from "./gitflow.js";
import { initProject } from "./init.js";
import { install } from "./install.js";
import { listLibrary, parseKind, readLibrary, syncLibrary } from "./library.js";
import { resumeRun } from "./orchestrator.js";
import { resolveCwd } from "./paths.js";
import { requestDesignRework, type ReviewDecision, type VerificationStatus, reviewTask, verifyTask } from "./quality.js";
import { requestTaskPlannerReplan } from "./replan.js";
import { recoverTask } from "./recovery.js";
import { createDeliveryRun } from "./run.js";
import { summarizeAutoOrchestratorSession, summarizeOrchestratorSession } from "./session-summary.js";
import { readReport, status } from "./status.js";
import { collectPatch, prepareWorktrees, validatePatch } from "./worktree.js";

function help(program: string): string {
  return `${program}

Usage:
  npx github:<owner>/<repo> install [--target codex|claude|all] [--lang zh|en] [--dry-run] [--json]
  ${program} init [--cwd path] [--json]
  ${program} run <requirement text|requirement-file> [--plan-only] [--max-iterations n] [--cwd path] [--json]
  ${program} status [--cwd path] [--json]
  ${program} help

Public slash-command surface is intentionally limited to init, run, and status.
All planning materialization, orchestration, QA, review, commit, push, archive, recovery, and agent-dispatch commands remain internal runtime actions.
Outside init-time environment inspection and deterministic runtime materialization, delivery work is expected to be handled by the current session's Orchestrator launching independent native subagents with model-led multi-role multi-agent + skill execution.
Install is intended to be invoked through npx github:<owner>/<repo>. It defaults to --target all and --lang zh so one command enables Chinese /imfine entries for both Codex and Claude.
`;
}

function parseReviewDecision(value: string | undefined): ReviewDecision {
  if (value === "approved" || value === "changes_requested" || value === "blocked") return value;
  throw new Error("Invalid review --status. Expected approved, changes_requested, or blocked.");
}

function parseVerificationStatus(value: string | undefined): VerificationStatus | undefined {
  if (!value) return undefined;
  if (value === "pass" || value === "fail" || value === "blocked") return value;
  throw new Error("Invalid verify --status. Expected pass, fail, or blocked.");
}

function parseCommitMode(value: string | undefined): CommitMode {
  if (!value || value === "task") return "task";
  if (value === "integration") return value;
  throw new Error("Invalid commit --mode. Expected task or integration.");
}

function parseMaxIterations(value: string | undefined): number {
  if (!value) return 20;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) throw new Error("Invalid --max-iterations. Expected a positive integer.");
  return parsed;
}

function print(value: unknown, json: boolean, textFormatter: () => string): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    process.stdout.write(textFormatter());
  }
}

function installInvocationAllowed(): boolean {
  const userAgent = process.env.npm_config_user_agent || "";
  const execPath = process.env.npm_execpath || "";
  return /\bnpx\b/i.test(userAgent) || execPath.length > 0;
}

export async function runCli(program: string, argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const command = args.positional[0] || "help";
  const json = readBooleanFlag(args, "json");
  const cwd = resolveCwd(readStringFlag(args, "cwd"));

  try {
    if (command === "help" || command === "--help" || command === "-h") {
      process.stdout.write(help(program));
      return;
    }

    if (command === "install") {
      if (!installInvocationAllowed()) {
        throw new Error("Install entry is only supported through npx github:<owner>/<repo> install ...");
      }
      const result = install(readStringFlag(args, "target"), readStringFlag(args, "lang"), readBooleanFlag(args, "dryRun"));
      print(result, json, () => formatInstall(result));
      return;
    }

    if (command === "init") {
      const result = initProject(cwd);
      print(result, json, () => formatInit(result));
      return;
    }

    if (command === "run") {
      const result = createDeliveryRun(cwd, args.positional.slice(1));
      if (readBooleanFlag(args, "planOnly")) {
        const orchestration = summarizeOrchestratorSession(cwd, resumeRun(cwd, result.runId));
        print(orchestration, json, () => formatOrchestrator(orchestration));
        return;
      }
      const auto = summarizeAutoOrchestratorSession(cwd, await runAutoOrchestrator(cwd, result.runId, {
        dryRun: readBooleanFlag(args, "dryRun"),
        maxIterations: parseMaxIterations(readStringFlag(args, "maxIterations"))
      }));
      print(auto, json, () => formatAutoOrchestrator(auto));
      return;
    }

    if (command === "orchestrate") {
      const runId = args.positional[1];
      if (!runId) throw new Error("Expected orchestrate <run-id>.");
      const result = summarizeAutoOrchestratorSession(cwd, await runAutoOrchestrator(cwd, runId, {
        dryRun: readBooleanFlag(args, "dryRun"),
        maxIterations: parseMaxIterations(readStringFlag(args, "maxIterations"))
      }));
      print(result, json, () => formatAutoOrchestrator(result));
      return;
    }

    if (command === "task-planner") {
      if (args.positional[1] !== "replan") throw new Error("Expected task-planner replan <run-id>.");
      const runId = args.positional[2];
      if (!runId) throw new Error("Missing <run-id> for task-planner replan.");
      const result = requestTaskPlannerReplan(cwd, runId, readStringFlag(args, "summary") || "");
      print(result, json, () => formatReplan(result));
      return;
    }

    if (command === "task") {
      if (args.positional[1] === "planner" && args.positional[2] === "replan") {
        const runId = args.positional[3];
        if (!runId) throw new Error("Missing <run-id> for task planner replan.");
        const result = requestTaskPlannerReplan(cwd, runId, readStringFlag(args, "summary") || "");
        print(result, json, () => formatReplan(result));
        return;
      }
      throw new Error("Expected task planner replan <run-id>.");
    }

    if (command === "worktree") {
      if (args.positional[1] !== "prepare") throw new Error("Expected worktree prepare <run-id>.");
      const runId = args.positional[2];
      if (!runId) throw new Error("Missing <run-id> for worktree prepare.");
      const result = prepareWorktrees(cwd, runId);
      print(result, json, () => formatWorktreePrepare(result));
      return;
    }

    if (command === "patch") {
      const action = args.positional[1];
      const runId = args.positional[2];
      const taskId = args.positional[3];
      if (!runId || !taskId) throw new Error("Expected patch collect|validate <run-id> <task-id>.");
      if (action === "collect") {
        const result = collectPatch(cwd, runId, taskId);
        print(result, json, () => formatPatchCollect(result));
        return;
      }
      if (action === "validate") {
        const result = validatePatch(cwd, runId, taskId);
        print(result, json, () => formatPatchValidation(result));
        return;
      }
      throw new Error("Expected patch collect|validate <run-id> <task-id>.");
    }

    if (command === "verify") {
      const runId = args.positional[1];
      const taskId = args.positional[2];
      if (!runId || !taskId) throw new Error("Expected verify <run-id> <task-id>.");
      const result = verifyTask(cwd, runId, taskId, parseVerificationStatus(readStringFlag(args, "status")), readStringFlag(args, "summary") || "");
      print(result, json, () => formatVerification(result));
      return;
    }

    if (command === "review") {
      const runId = args.positional[1];
      const taskId = args.positional[2];
      if (!runId || !taskId) throw new Error("Expected review <run-id> <task-id> --status approved|changes_requested|blocked.");
      const result = reviewTask(cwd, runId, taskId, parseReviewDecision(readStringFlag(args, "status")), readStringFlag(args, "summary") || "");
      print(result, json, () => formatReview(result));
      return;
    }

    if (command === "rework") {
      if (args.positional[1] !== "design") throw new Error("Expected rework design <run-id> <task-id>.");
      const runId = args.positional[2];
      const taskId = args.positional[3];
      if (!runId || !taskId) throw new Error("Expected rework design <run-id> <task-id>.");
      const result = requestDesignRework(cwd, runId, taskId, readStringFlag(args, "summary") || "");
      print(result, json, () => formatDesignRework(result));
      return;
    }

    if (command === "recover") {
      if (args.positional[1] !== "task") throw new Error("Expected recover task <run-id> <task-id>.");
      const runId = args.positional[2];
      const taskId = args.positional[3];
      if (!runId || !taskId) throw new Error("Expected recover task <run-id> <task-id>.");
      const result = recoverTask(cwd, runId, taskId);
      print(result, json, () => formatRecovery(result));
      return;
    }

    if (command === "commit") {
      const scope = args.positional[1];
      const runId = args.positional[2];
      if (scope === "task") {
        const taskId = args.positional[3];
        if (!runId || !taskId) throw new Error("Expected commit task <run-id> <task-id>.");
        const result = commitTask(cwd, runId, taskId);
        print(result, json, () => formatCommit(result));
        return;
      }
      if (scope === "run") {
        if (!runId) throw new Error("Expected commit run <run-id> [--mode task|integration].");
        const result = commitRun(cwd, runId, parseCommitMode(readStringFlag(args, "mode")));
        print(result, json, () => formatCommit(result));
        return;
      }
      throw new Error("Expected commit task <run-id> <task-id> or commit run <run-id> [--mode task|integration].");
    }

    if (command === "push") {
      const runId = args.positional[1];
      if (!runId) throw new Error("Expected push <run-id>.");
      const result = pushRun(cwd, runId);
      print(result, json, () => formatPush(result));
      return;
    }

    if (command === "archive") {
      const runId = args.positional[1];
      if (!runId) throw new Error("Expected archive <run-id>.");
      const result = archiveRun(cwd, runId);
      print(result, json, () => formatArchive(result));
      return;
    }

    if (command === "doctor") {
      const result = doctor(cwd);
      print(result, json, () => formatDoctor(result));
      return;
    }

    if (command === "status") {
      const result = status(cwd);
      print(result, json, () => formatStatus(result));
      return;
    }

    if (command === "report") {
      const runId = args.positional[1];
      if (!runId) throw new Error("Missing <run-id>.");
      const result = readReport(cwd, runId);
      print(result, json, () => formatReport(result));
      return;
    }

    if (command === "agents" || command === "skills" || command === "templates" || command === "workflows") {
      const kind = parseKind(command);
      const action = args.positional[1] || "list";
      if (action === "list") {
        const result = listLibrary(kind);
        print(result, json, () => formatLibraryList(kind, result));
        return;
      }
      if (action === "show") {
        const id = args.positional[2];
        if (!id) throw new Error(`Missing <id> for ${command} show.`);
        const content = readLibrary(kind, id);
        print({ kind, id, content }, json, () => content);
        return;
      }
      throw new Error(`Unknown ${command} action: ${action}`);
    }

    if (command === "library") {
      const action = args.positional[1];
      if (action !== "sync") throw new Error("Expected library sync.");
      const result = syncLibrary(cwd);
      print(result, json, () => formatLibrarySync(result));
      return;
    }

    if (command === "resume") {
      const runId = args.positional[1];
      if (!runId) throw new Error("Expected resume <run-id>.");
      const result = summarizeOrchestratorSession(cwd, resumeRun(cwd, runId));
      print(result, json, () => formatOrchestrator(result));
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.error(JSON.stringify({ error: message }, null, 2));
    } else {
      console.error(`imfine error: ${message}`);
    }
    process.exitCode = 1;
  }
}
