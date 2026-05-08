import { archiveRun } from "./archive.js";
import { executeAgentBatch, prepareAgentExecutions } from "./agent-execution.js";
import { parseArgs, readBooleanFlag, readStringFlag } from "./args.js";
import { runAutoOrchestrator } from "./auto-orchestrator.js";
import { doctor } from "./doctor.js";
import { formatAgentExecute, formatAgentPrepare, formatArchive, formatAutoOrchestrator, formatCommit, formatDeliveryRun, formatDesignRework, formatDoctor, formatInit, formatInstall, formatLibraryList, formatLibrarySync, formatNewProjectDelivery, formatOrchestrator, formatPatchCollect, formatPatchValidation, formatPlan, formatPush, formatReport, formatReview, formatStatus, formatVerification, formatWorktreePrepare } from "./format.js";
import { commitResolvedRun, commitRun, commitTask, pushRun, type CommitMode } from "./gitflow.js";
import { initProject } from "./init.js";
import { install } from "./install.js";
import { listLibrary, parseKind, readLibrary, syncLibrary } from "./library.js";
import { runNewProjectAgentPlanning } from "./new-project-agent-planning.js";
import { completeNewProjectDelivery, deliverNewProject, ensureGitRepository } from "./new-project.js";
import { resumeRun } from "./orchestrator.js";
import { planRun, validateRunTaskGraph } from "./plan.js";
import { resolveCwd } from "./paths.js";
import { requestDesignRework, type ReviewDecision, type VerificationStatus, reviewTask, verifyTask } from "./quality.js";
import { createDeliveryRun } from "./run.js";
import { readReport, status } from "./status.js";
import { collectPatch, prepareWorktrees, validatePatch } from "./worktree.js";

function help(program: string): string {
  return `${program}

Usage:
  npx github:<owner>/<repo> install [--target codex|claude|all] [--lang zh|en] [--dry-run] [--json]
  ${program} init [--cwd path] [--json]
  ${program} run <requirement text|requirement-file> [--plan-only] [--max-iterations n] [--deliver] [--cwd path] [--json]
  ${program} resume <run-id> [--cwd path] [--json]
  ${program} orchestrate <run-id> [--executor command] [--max-iterations n] [--dry-run] [--cwd path] [--json]
  ${program} plan <run-id> [--cwd path] [--json]
  ${program} plan validate <run-id> [--cwd path] [--json]
  ${program} task graph validate <run-id> [--cwd path] [--json]
  ${program} worktree prepare <run-id> [--cwd path] [--json]
  ${program} patch collect <run-id> <task-id> [--cwd path] [--json]
  ${program} patch validate <run-id> <task-id> [--cwd path] [--json]
  ${program} verify <run-id> <task-id> [--status pass|fail|blocked] [--summary text] [--cwd path] [--json]
  ${program} review <run-id> <task-id> --status approved|changes_requested|blocked [--summary text] [--cwd path] [--json]
  ${program} rework design <run-id> <task-id> [--summary text] [--cwd path] [--json]
  ${program} commit task <run-id> <task-id> [--cwd path] [--json]
  ${program} commit run <run-id> [--mode task|integration] [--cwd path] [--json]
  ${program} commit resolved <run-id> [task-id...] [--cwd path] [--json]
  ${program} push <run-id> [--cwd path] [--json]
  ${program} archive <run-id> [--cwd path] [--json]
  ${program} doctor [--cwd path] [--json]
  ${program} status [--cwd path] [--json]
  ${program} report <run-id> [--cwd path] [--json]
  ${program} agents list|show <id> [--json]
  ${program} agents prepare <run-id> [--cwd path] [--json]
  ${program} agents execute <run-id> [--executor command] [--limit n] [--dry-run] [--cwd path] [--json]
  ${program} skills list|show <id> [--json]
  ${program} templates list|show <id> [--json]
  ${program} library sync [--cwd path] [--json]
  ${program} help

Phase 1 implements installation, workspace initialization, and infrastructure doctor checks.
Phase 2 adds source-level imfine agents, skills, and artifact templates.
Phase 3 adds requirement-to-design delivery run creation.
Phase 4 adds task graph and execution planning.
Phase 5 adds git worktree preparation and patch collection/validation.
Phase 6 adds QA verification evidence, reviewer decisions, repeated fix-task creation, and design rework routing.
Phase 7 adds task/integration commits and push evidence for origin imfine/<run-id>.
Phase 8 adds Archive Agent confirmation, run archive reports, user reports, and long-term project knowledge updates.
Phase 9 adds new-project full delivery through the internal --deliver debug path. Use --plan-only to stop at planning.
Orchestrator recovery adds resume <run-id>, queue persistence, infrastructure gate persistence, agent run registry, parallel plan, and Conflict Resolver routing.
Model agent execution adds agents prepare to create skill-backed prompts for the current Codex/Claude session to execute or dispatch. agents execute --executor remains an internal/testing bridge for non-interactive runners, not a normal /imfine prerequisite.
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

function parseLimit(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) throw new Error("Invalid --limit. Expected a non-negative integer.");
  return parsed;
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
      if (readBooleanFlag(args, "deliver")) {
        const result = deliverNewProject(cwd, args.positional.slice(1));
        print(result, json, () => formatNewProjectDelivery(result));
        return;
      }
      const result = createDeliveryRun(cwd, args.positional.slice(1));
      if (readBooleanFlag(args, "planOnly")) {
        print(result, json, () => formatDeliveryRun(result));
        return;
      }
      if (result.projectKind === "new_project") {
        const planning = runNewProjectAgentPlanning(cwd, result, {
          executor: readStringFlag(args, "executor"),
          dryRun: readBooleanFlag(args, "dryRun")
        });
        if (planning.status !== "planned") {
          print(planning, json, () => `new-project agent planning: ${planning.status}\nreport: ${planning.report}\n`);
          return;
        }
        ensureGitRepository(cwd);
        const auto = await runAutoOrchestrator(cwd, result.runId, {
          executor: readStringFlag(args, "executor"),
          dryRun: readBooleanFlag(args, "dryRun"),
          maxIterations: parseMaxIterations(readStringFlag(args, "maxIterations"))
        });
        print(auto, json, () => formatAutoOrchestrator(auto));
        return;
      }
      const auto = await runAutoOrchestrator(cwd, result.runId, {
        executor: readStringFlag(args, "executor"),
        dryRun: readBooleanFlag(args, "dryRun"),
        maxIterations: parseMaxIterations(readStringFlag(args, "maxIterations"))
      });
      print(auto, json, () => formatAutoOrchestrator(auto));
      return;
    }

    if (command === "orchestrate") {
      const runId = args.positional[1];
      if (!runId) throw new Error("Expected orchestrate <run-id>.");
      const result = await runAutoOrchestrator(cwd, runId, {
        executor: readStringFlag(args, "executor"),
        dryRun: readBooleanFlag(args, "dryRun"),
        maxIterations: parseMaxIterations(readStringFlag(args, "maxIterations"))
      });
      print(result, json, () => formatAutoOrchestrator(result));
      return;
    }

    if (command === "plan") {
      const actionOrRunId = args.positional[1];
      if (!actionOrRunId) throw new Error("Missing <run-id>.");
      if (actionOrRunId === "validate") {
        const runId = args.positional[2];
        if (!runId) throw new Error("Missing <run-id> for plan validate.");
        const validation = validateRunTaskGraph(cwd, runId);
        print(validation, json, () => `${validation.passed ? "pass" : "fail"}\n${validation.errors.map((error) => `- ${error}`).join("\n")}\n`);
        return;
      }
      const result = planRun(cwd, actionOrRunId);
      print(result, json, () => formatPlan(result));
      return;
    }

    if (command === "task") {
      if (args.positional[1] !== "graph" || args.positional[2] !== "validate") {
        throw new Error("Expected task graph validate <run-id>.");
      }
      const runId = args.positional[3];
      if (!runId) throw new Error("Missing <run-id> for task graph validate.");
      const validation = validateRunTaskGraph(cwd, runId);
      print(validation, json, () => `${validation.passed ? "pass" : "fail"}\n${validation.errors.map((error) => `- ${error}`).join("\n")}\n`);
      return;
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
      if (scope === "resolved") {
        if (!runId) throw new Error("Expected commit resolved <run-id> [task-id...].");
        const result = commitResolvedRun(cwd, runId, args.positional.slice(3));
        print(result, json, () => formatCommit(result));
        return;
      }
      throw new Error("Expected commit task <run-id> <task-id>, commit run <run-id> [--mode task|integration], or commit resolved <run-id> [task-id...].");
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

    if (command === "agents" || command === "skills" || command === "templates") {
      const kind = parseKind(command);
      const action = args.positional[1] || "list";
      if (command === "agents" && action === "prepare") {
        const runId = args.positional[2];
        if (!runId) throw new Error("Expected agents prepare <run-id>.");
        const result = prepareAgentExecutions(cwd, runId);
        print(result, json, () => formatAgentPrepare(result));
        return;
      }
      if (command === "agents" && action === "execute") {
        const runId = args.positional[2];
        if (!runId) throw new Error("Expected agents execute <run-id>.");
        const result = await executeAgentBatch(cwd, runId, {
          dryRun: readBooleanFlag(args, "dryRun"),
          executor: readStringFlag(args, "executor"),
          limit: parseLimit(readStringFlag(args, "limit"))
        });
        print(result, json, () => formatAgentExecute(result));
        return;
      }
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
      const result = resumeRun(cwd, runId);
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
