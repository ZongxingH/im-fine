import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { readLibrary } from "./library.js";
import { resumeRun, type AgentRun, type OrchestratorResult } from "./orchestrator.js";
import { acquireLock, releaseLock, writeCheckpoint } from "./reliability.js";

export interface AgentExecutionPackage {
  id: string;
  role: string;
  taskId?: string;
  status: AgentRun["status"];
  prompt: string;
  agentContract: string;
  skillBundle: string;
  execution: string;
  outputDir: string;
}

export interface AgentExecutionResult {
  id: string;
  role: string;
  taskId?: string;
  status: "prepared" | "dry_run" | "executed" | "failed";
  prompt: string;
  outputDir: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export interface AgentPrepareResult {
  runId: string;
  runDir: string;
  dispatch: string;
  packages: AgentExecutionPackage[];
  orchestration: OrchestratorResult;
}

export interface AgentExecuteResult {
  runId: string;
  executor: string;
  dryRun: boolean;
  dispatch: string;
  results: AgentExecutionResult[];
}

interface ExecuteOptions {
  dryRun: boolean;
  executor?: string;
  limit?: number;
}

function readTextIfExists(file: string): string {
  if (!fs.existsSync(file)) return "";
  if (!fs.statSync(file).isFile()) return "";
  return fs.readFileSync(file, "utf8");
}

function libraryAgentId(role: string): string {
  if (role === "technical-writer") return "technical-writer";
  if (role === "conflict-resolver") return "conflict-resolver";
  if (role === "qa") return "qa";
  if (role === "reviewer") return "reviewer";
  if (role === "archive") return "archive";
  if (role === "architect") return "architect";
  if (role === "task-planner") return "task-planner";
  if (role === "intake") return "intake";
  if (role === "project-analyzer") return "project-analyzer";
  if (role === "product-planner") return "product-planner";
  if (role === "risk-reviewer") return "risk-reviewer";
  if (role === "project-knowledge-updater") return "project-knowledge-updater";
  if (role === "committer") return "committer";
  return "dev";
}

function existingSkillIds(skillIds: string[]): string[] {
  const fallbackById: Record<string, string[]> = {
    implementation: ["execute-task-plan"],
    verification: ["tdd", "systematic-debugging"],
    "test-architecture": ["tdd"],
    "risk-review": ["code-review"],
    documentation: ["execute-task-plan"],
    archive: ["archive-confirmation"],
    "project-knowledge": ["archive-confirmation"],
    "conflict-resolution": ["systematic-debugging"],
    "scope-control": ["execute-task-plan"]
  };
  const result = new Set<string>();
  for (const id of skillIds) {
    const mapped = fallbackById[id] || [id];
    for (const item of mapped) result.add(item);
  }
  return Array.from(result);
}

function relative(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function materializePrompt(cwd: string, runId: string, agent: AgentRun, agentContract: string, skillBundle: string): string {
  const inputSections = agent.inputs.map((input) => {
    const file = path.resolve(cwd, input);
    const content = readTextIfExists(file);
    return `### ${input}\n\n${content ? `\`\`\`\n${content.trim()}\n\`\`\`` : "- file not found or intentionally external"}`;
  }).join("\n\n");
  const worktreeIndex = path.join(cwd, ".imfine", "runs", runId, "worktrees", "index.json");
  let runWorktreeSection = "";
  if (agent.role === "technical-writer" && !agent.taskId && fs.existsSync(worktreeIndex)) {
    const index = JSON.parse(fs.readFileSync(worktreeIndex, "utf8")) as { run_worktree?: string; worktree_root?: string };
    const worktree = index.run_worktree || (index.worktree_root ? path.join(index.worktree_root, "_run") : "");
    if (worktree) runWorktreeSection = `\n## Worktree\n\n${worktree}\n`;
  }

  return `# imfine Model Agent Execution

## Assignment

- run: ${runId}
- agent: ${agent.id}
- role: ${agent.role}
- task: ${agent.taskId || "run-level"}
- status: ${agent.status}
- parallel group: ${agent.parallelGroup}

## Agent Contract

${agentContract.trim()}

## Skill Discipline

${skillBundle.trim()}
${runWorktreeSection}

## Boundaries

### Read Scope

${agent.readScope.length > 0 ? agent.readScope.map((item) => `- ${item}`).join("\n") : "- none"}

### Write Scope

${agent.writeScope.length > 0 ? agent.writeScope.map((item) => `- ${item}`).join("\n") : "- no business-code writes; evidence and handoff only"}

### Dependencies

${agent.dependsOn.length > 0 ? agent.dependsOn.map((item) => `- ${item}`).join("\n") : "- none"}

## Inputs

${inputSections || "- none"}

## Required Outputs

${agent.outputs.length > 0 ? agent.outputs.map((item) => `- ${item}`).join("\n") : "- write a structured handoff in the agent directory"}

## Execution Rules

- Use the agent contract and skills as the source of behavior.
- Do not invent project facts without file evidence.
- Do not expand write boundaries without Orchestrator approval.
- If blocked, write the blocked reason and exact missing evidence.
- Runtime owns commit, push, archive materialization, and deterministic evidence checks.
`;
}

function packageAgent(cwd: string, runId: string, runDir: string, agent: AgentRun): AgentExecutionPackage {
  const agentDir = path.join(runDir, "agents", agent.id);
  const executionDir = path.join(agentDir, "execution");
  ensureDir(executionDir);

  const agentContractContent = readLibrary("agents", libraryAgentId(agent.role));
  const skillIds = existingSkillIds(agent.skills);
  const skillBundleContent = skillIds.map((skill) => readLibrary("skills", skill)).join("\n\n---\n\n");
  const prompt = materializePrompt(cwd, runId, agent, agentContractContent, skillBundleContent);

  const files = {
    prompt: path.join(executionDir, "model-input.md"),
    agentContract: path.join(executionDir, "agent-contract.md"),
    skillBundle: path.join(executionDir, "skill-bundle.md"),
    execution: path.join(executionDir, "execution.json")
  };

  writeText(files.prompt, prompt);
  writeText(files.agentContract, agentContractContent);
  writeText(files.skillBundle, skillBundleContent);
  writeText(files.execution, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    agent_id: agent.id,
    role: agent.role,
    task_id: agent.taskId,
    status: "prepared",
    prepared_at: new Date().toISOString(),
    prompt: files.prompt,
    output_dir: executionDir,
    skills: skillIds,
    inputs: agent.inputs,
    outputs: agent.outputs
  }, null, 2)}\n`);

  return {
    id: agent.id,
    role: agent.role,
    taskId: agent.taskId,
    status: agent.status,
    prompt: files.prompt,
    agentContract: files.agentContract,
    skillBundle: files.skillBundle,
    execution: files.execution,
    outputDir: executionDir
  };
}

export function prepareAgentExecutions(cwd: string, runId: string): AgentPrepareResult {
  const orchestration = resumeRun(cwd, runId);
  const packages = orchestration.agentRuns.map((agent) => packageAgent(cwd, runId, orchestration.runDir, agent));
  const dispatch = path.join(orchestration.runDir, "orchestration", "model-dispatch.json");
  writeText(dispatch, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    prepared_at: new Date().toISOString(),
    packages: packages.map((item) => ({
      id: item.id,
      role: item.role,
      task_id: item.taskId,
      status: item.status,
      prompt: relative(cwd, item.prompt),
      output_dir: relative(cwd, item.outputDir)
    }))
  }, null, 2)}\n`);

  return {
    runId,
    runDir: orchestration.runDir,
    dispatch,
    packages,
    orchestration
  };
}

export function executeAgentBatch(cwd: string, runId: string, options: ExecuteOptions): AgentExecuteResult {
  const prepared = prepareAgentExecutions(cwd, runId);
  const ready = prepared.packages.filter((item) => item.status === "ready");
  const selected = typeof options.limit === "number" && options.limit >= 0 ? ready.slice(0, options.limit) : ready;
  const executor = options.executor || "";
  const results: AgentExecutionResult[] = [];

  if (!options.dryRun && !executor) {
    throw new Error("Missing internal executor. Pass --executor for non-interactive testing, or use --dry-run to only prepare model prompts.");
  }

  for (const item of selected) {
    const lock = acquireLock(cwd, runId, "action", `agent-run-${item.id}`);
    if (!lock.acquired) {
      results.push({
        id: item.id,
        role: item.role,
        taskId: item.taskId,
        status: "failed",
        prompt: item.prompt,
        outputDir: item.outputDir,
        stderr: lock.reason || "agent-run lock is held"
      });
      writeCheckpoint(cwd, runId, `agent-run-${item.id}`, "after", "blocked", lock.reason || "agent-run lock is held", [lock.file]);
      continue;
    }

    try {
      writeCheckpoint(cwd, runId, `agent-run-${item.id}`, "before", "started", `prepare model execution for ${item.id}`, [item.prompt]);
    if (options.dryRun) {
      const statusFile = path.join(item.outputDir, "execution-status.json");
      writeText(statusFile, `${JSON.stringify({
        schema_version: 1,
        run_id: runId,
        agent_id: item.id,
        status: "dry_run",
        prompt: item.prompt,
        updated_at: new Date().toISOString()
      }, null, 2)}\n`);
      results.push({ id: item.id, role: item.role, taskId: item.taskId, status: "dry_run", prompt: item.prompt, outputDir: item.outputDir });
      writeCheckpoint(cwd, runId, `agent-run-${item.id}`, "after", "waiting_for_model", "dry-run model dispatch prepared", [statusFile]);
      continue;
    }

    const prompt = fs.readFileSync(item.prompt, "utf8");
    const executed = spawnSync(executor, {
      cwd,
      shell: true,
      input: prompt,
      encoding: "utf8",
      timeout: 30 * 60 * 1000,
      env: {
        ...process.env,
        IMFINE_RUN_ID: runId,
        IMFINE_AGENT_ID: item.id,
        IMFINE_AGENT_ROLE: item.role,
        IMFINE_AGENT_PROMPT: item.prompt,
        IMFINE_AGENT_OUTPUT_DIR: item.outputDir
      }
    });
    const stdout = executed.stdout || "";
    const stderr = executed.stderr || executed.error?.message || "";
    writeText(path.join(item.outputDir, "stdout.md"), stdout);
    writeText(path.join(item.outputDir, "stderr.md"), stderr);
    writeText(path.join(item.outputDir, "execution-status.json"), `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      agent_id: item.id,
      status: executed.status === 0 ? "executed" : "failed",
      exit_code: executed.status,
      executor,
      stdout: path.join(item.outputDir, "stdout.md"),
      stderr: path.join(item.outputDir, "stderr.md"),
      updated_at: new Date().toISOString()
    }, null, 2)}\n`);
    results.push({
      id: item.id,
      role: item.role,
      taskId: item.taskId,
      status: executed.status === 0 ? "executed" : "failed",
      prompt: item.prompt,
      outputDir: item.outputDir,
      exitCode: executed.status,
      stdout,
      stderr
    });
    writeCheckpoint(
      cwd,
      runId,
      `agent-run-${item.id}`,
      "after",
      executed.status === 0 ? "completed" : "failed",
      executed.status === 0 ? "model executor completed" : "model executor failed",
      [path.join(item.outputDir, "execution-status.json")]
    );
    } finally {
      releaseLock(cwd, lock);
    }
  }

  return {
    runId,
    executor: options.dryRun ? "dry-run" : executor,
    dryRun: options.dryRun,
    dispatch: prepared.dispatch,
    results
  };
}
