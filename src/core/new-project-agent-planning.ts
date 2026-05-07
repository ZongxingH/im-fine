import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { readLibrary } from "./library.js";
import { type DeliveryRunResult } from "./run.js";
import { validateRunTaskGraph } from "./plan.js";

export interface NewProjectAgentPlanningResult {
  runId: string;
  status: "planned" | "waiting_for_model" | "blocked";
  stackDecision: string;
  taskGraph: string;
  packages: Array<{
    id: string;
    role: "architect" | "task-planner";
    prompt: string;
    outputDir: string;
    status: "prepared" | "executed" | "failed" | "dry_run";
  }>;
  report: string;
  errors: string[];
}

interface Options {
  executor?: string;
  dryRun: boolean;
}

function readSkill(id: string): string {
  return readLibrary("skills", id);
}

function packagePrompt(run: DeliveryRunResult, role: "architect" | "task-planner", outputDir: string): string {
  const agent = readLibrary("agents", role);
  const skills = role === "architect"
    ? [readSkill("project-analysis"), readSkill("clarify")]
    : [readSkill("write-delivery-plan"), readSkill("parallel-agent-dispatch")];
  const normalized = fs.readFileSync(path.join(run.runDir, "request", "normalized.md"), "utf8");
  const projectContext = fs.readFileSync(path.join(run.runDir, "analysis", "project-context.md"), "utf8");
  const requiredOutputs = role === "architect"
    ? [
      path.join(run.runDir, "design", "stack-decision.json"),
      path.join(run.runDir, "design", "technical-solution.md"),
      path.join(run.runDir, "design", "architecture-decisions.md")
    ]
    : [
      path.join(run.runDir, "planning", "task-graph.json"),
      path.join(run.runDir, "planning", "ownership.json"),
      path.join(run.runDir, "planning", "execution-plan.md"),
      path.join(run.runDir, "planning", "commit-plan.md")
    ];

  return `# imfine New Project ${role} Execution

## Assignment

- run: ${run.runId}
- project kind: new_project
- role: ${role}
- output dir: ${outputDir}

## Agent Contract

${agent}

## Skill Discipline

${skills.join("\n\n---\n\n")}

## Requirement

\`\`\`
${normalized.trim()}
\`\`\`

## Project Context

\`\`\`
${projectContext.trim()}
\`\`\`

## Required Outputs

${requiredOutputs.map((item) => `- ${item}`).join("\n")}

## Rules

- You, the model Agent, decide the stack and task graph from the requirement.
- Runtime must not choose framework, language, directory structure, or verification strategy for you.
- Do not create external infrastructure, cloud resources, paid services, production credentials, or real third-party accounts.
- Keep all paths relative to the project root unless writing the required absolute output files.
- If blocked, write a blocked handoff under ${outputDir}.
`;
}

function executePackage(cwd: string, run: DeliveryRunResult, role: "architect" | "task-planner", executor: string, dryRun: boolean): NewProjectAgentPlanningResult["packages"][number] {
  const outputDir = path.join(run.runDir, "agents", role, "execution");
  ensureDir(outputDir);
  const prompt = path.join(outputDir, "model-input.md");
  writeText(prompt, packagePrompt(run, role, outputDir));
  writeText(path.join(outputDir, "execution.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: run.runId,
    role,
    status: dryRun ? "dry_run" : "prepared",
    prompt,
    output_dir: outputDir,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`);

  if (dryRun) {
    writeText(path.join(outputDir, "execution-status.json"), `${JSON.stringify({ run_id: run.runId, role, status: "dry_run", prompt }, null, 2)}\n`);
    return { id: role, role, prompt, outputDir, status: "dry_run" };
  }

  const result = spawnSync(executor, {
    cwd,
    shell: true,
    input: fs.readFileSync(prompt, "utf8"),
    encoding: "utf8",
    timeout: 30 * 60 * 1000,
    env: {
      ...process.env,
      IMFINE_RUN_ID: run.runId,
      IMFINE_AGENT_ID: role,
      IMFINE_AGENT_ROLE: role,
      IMFINE_AGENT_PROMPT: prompt,
      IMFINE_AGENT_OUTPUT_DIR: outputDir
    }
  });
  writeText(path.join(outputDir, "stdout.md"), result.stdout || "");
  writeText(path.join(outputDir, "stderr.md"), result.stderr || result.error?.message || "");
  const status = result.status === 0 ? "executed" : "failed";
  writeText(path.join(outputDir, "execution-status.json"), `${JSON.stringify({
    run_id: run.runId,
    role,
    status,
    exit_code: result.status,
    prompt,
    updated_at: new Date().toISOString()
  }, null, 2)}\n`);
  return { id: role, role, prompt, outputDir, status };
}

function validateStackDecision(file: string): string[] {
  const errors: string[] = [];
  if (!fs.existsSync(file)) return [`Missing stack decision: ${file}`];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const key of ["language", "runtime", "package_manager", "project_type", "rationale"]) {
      if (typeof parsed[key] !== "string" || !parsed[key]) errors.push(`stack-decision.json missing string field: ${key}`);
    }
    if (!parsed.scripts || typeof parsed.scripts !== "object") errors.push("stack-decision.json missing scripts object");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

export function runNewProjectAgentPlanning(cwd: string, run: DeliveryRunResult, options: Options): NewProjectAgentPlanningResult {
  const executor = options.executor || "";
  const stackDecision = path.join(run.runDir, "design", "stack-decision.json");
  const taskGraph = path.join(run.runDir, "planning", "task-graph.json");
  const report = path.join(run.runDir, "orchestration", "new-project-agent-planning.md");
  const errors: string[] = [];
  const packages: NewProjectAgentPlanningResult["packages"] = [];

  if (!options.dryRun && !executor) {
    errors.push("New-project Architect and Task Planner packages are waiting for the current model session");
    packages.push(executePackage(cwd, run, "architect", "", true));
    packages.push(executePackage(cwd, run, "task-planner", "", true));
    writeText(report, `# New Project Agent Planning\n\n- status: waiting_for_model\n- error: ${errors[0]}\n`);
    return { runId: run.runId, status: "waiting_for_model", stackDecision, taskGraph, packages, report, errors };
  }

  packages.push(executePackage(cwd, run, "architect", executor, options.dryRun));
  if (!options.dryRun && packages[0].status === "executed") {
    packages.push(executePackage(cwd, run, "task-planner", executor, options.dryRun));
  } else if (options.dryRun) {
    packages.push(executePackage(cwd, run, "task-planner", executor, true));
  }

  if (options.dryRun) {
    writeText(report, `# New Project Agent Planning\n\n- status: waiting_for_model\n- packages: ${packages.length}\n`);
    return { runId: run.runId, status: "waiting_for_model", stackDecision, taskGraph, packages, report, errors };
  }

  for (const item of packages) {
    if (item.status !== "executed") errors.push(`${item.role} model execution failed`);
  }
  errors.push(...validateStackDecision(stackDecision));
  const validation = validateRunTaskGraph(cwd, run.runId);
  if (!validation.passed) errors.push(...validation.errors);

  const status = errors.length === 0 ? "planned" : "blocked";
  writeText(report, [
    "# New Project Agent Planning",
    "",
    `- status: ${status}`,
    `- stack decision: ${stackDecision}`,
    `- task graph: ${taskGraph}`,
    "",
    "## Packages",
    "",
    ...packages.map((item) => `- ${item.role}: ${item.status}`),
    "",
    "## Validation",
    "",
    errors.length > 0 ? errors.map((error) => `- ${error}`).join("\n") : "- pass"
  ].join("\n"));

  return { runId: run.runId, status, stackDecision, taskGraph, packages, report, errors };
}
