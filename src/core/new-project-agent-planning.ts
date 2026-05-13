import fs from "node:fs";
import path from "node:path";
import type { DispatchContract } from "./dispatch.js";
import { writeText } from "./fs.js";
import { type DeliveryRunResult } from "./run.js";
import { assertTransitionAccepted, transitionRunState } from "./state-machine.js";
import { workflowState } from "./workflows.js";

export interface NewProjectAgentPlanningResult {
  runId: string;
  runDir: string;
  projectKind: "new_project";
  source: DeliveryRunResult["source"];
  status: "planned" | "waiting_for_model" | "blocked";
  stackDecision: string;
  taskGraph: string;
  contracts: DispatchContract[];
  dispatchContractsFile: string;
  report: string;
  errors: string[];
}

interface Options {
  executor?: string;
  dryRun: boolean;
}

interface NewProjectWaitingWorkflow {
  roles: Record<string, {
    status: "ready" | "waiting";
    action_id: string;
    parallel_group: string;
    depends_on?: string[];
    skills: string[];
    allowed_transitions: string[];
    ready_reason?: string;
    blocked_reason?: string;
  }>;
  notes: string[];
}

type NewProjectRoleId = "architect" | "task-planner";

interface NewProjectRoleFiles {
  readScope: string[];
  writeScope: string[];
  inputs: string[];
  requiredOutputs: string[];
}

function handoffSchemaPath(cwd: string): string {
  return path.relative(cwd, path.join("library", "templates", "handoff.schema.json")) || "library/templates/handoff.schema.json";
}

function roleFiles(cwd: string, run: DeliveryRunResult, role: NewProjectRoleId): NewProjectRoleFiles {
  const runRoot = run.runDir;
  const contextFile = path.join(runRoot, "orchestration", "context.json");
  const normalized = path.join(runRoot, "request", "normalized.md");
  const projectContext = path.join(runRoot, "analysis", "project-context.md");
  const stackDecision = path.join(runRoot, "design", "stack-decision.json");
  const technicalSolution = path.join(runRoot, "design", "technical-solution.md");
  const architectureDecisions = path.join(runRoot, "design", "architecture-decisions.md");
  const taskGraph = path.join(runRoot, "planning", "task-graph.json");
  const ownership = path.join(runRoot, "planning", "ownership.json");
  const executionPlan = path.join(runRoot, "planning", "execution-plan.md");
  const commitPlan = path.join(runRoot, "planning", "commit-plan.md");
  if (role === "architect") {
    return {
      readScope: [`.imfine/runs/${run.runId}/request/**`, `.imfine/runs/${run.runId}/analysis/**`, `.imfine/project/**`],
      writeScope: [
        `.imfine/runs/${run.runId}/design/stack-decision.json`,
        `.imfine/runs/${run.runId}/design/technical-solution.md`,
        `.imfine/runs/${run.runId}/design/architecture-decisions.md`,
        `.imfine/runs/${run.runId}/agents/architect/handoff.json`
      ],
      inputs: [
        path.relative(cwd, normalized),
        path.relative(cwd, projectContext),
        path.relative(cwd, contextFile)
      ],
      requiredOutputs: [
        path.relative(cwd, stackDecision),
        path.relative(cwd, technicalSolution),
        path.relative(cwd, architectureDecisions),
        path.relative(cwd, path.join(runRoot, "agents", "architect", "handoff.json"))
      ]
    };
  }

  return {
    readScope: [`.imfine/runs/${run.runId}/request/**`, `.imfine/runs/${run.runId}/analysis/**`, `.imfine/runs/${run.runId}/design/**`, `.imfine/project/**`],
    writeScope: [
      `.imfine/runs/${run.runId}/planning/task-graph.json`,
      `.imfine/runs/${run.runId}/planning/ownership.json`,
      `.imfine/runs/${run.runId}/planning/execution-plan.md`,
      `.imfine/runs/${run.runId}/planning/commit-plan.md`,
      `.imfine/runs/${run.runId}/agents/task-planner/handoff.json`
    ],
    inputs: [
      path.relative(cwd, normalized),
      path.relative(cwd, projectContext),
      path.relative(cwd, contextFile),
      path.relative(cwd, technicalSolution),
      path.relative(cwd, architectureDecisions)
    ],
    requiredOutputs: [
      path.relative(cwd, taskGraph),
      path.relative(cwd, ownership),
      path.relative(cwd, executionPlan),
      path.relative(cwd, commitPlan),
      path.relative(cwd, path.join(runRoot, "agents", "task-planner", "handoff.json"))
    ]
  };
}

function buildNewProjectContract(
  cwd: string,
  run: DeliveryRunResult,
  workflow: NewProjectWaitingWorkflow,
  role: NewProjectRoleId
): DispatchContract {
  const files = roleFiles(cwd, run, role);
  const roleWorkflow = workflow.roles[role];
  const schema = handoffSchemaPath(cwd);

  return {
    id: role,
    role,
    workflow_state: "waiting_for_model",
    run_id: run.runId,
    action_id: roleWorkflow.action_id,
    status: roleWorkflow.status,
    kind: "agent",
    depends_on: roleWorkflow.depends_on || [],
    read_scope: files.readScope,
    write_scope: files.writeScope,
    inputs: files.inputs,
    required_outputs: files.requiredOutputs,
    skills: roleWorkflow.skills,
    handoff_schema: schema,
    allowed_transitions: roleWorkflow.allowed_transitions,
    parallel_group: roleWorkflow.parallel_group,
    ready_reason: roleWorkflow.ready_reason,
    blocked_reason: roleWorkflow.blocked_reason
  };
}

function newProjectContracts(cwd: string, run: DeliveryRunResult): DispatchContract[] {
  const workflow = workflowState<NewProjectWaitingWorkflow>("new-project-delivery", "waiting_for_model");
  return [
    buildNewProjectContract(cwd, run, workflow, "architect"),
    buildNewProjectContract(cwd, run, workflow, "task-planner")
  ];
}

export function runNewProjectAgentPlanning(cwd: string, run: DeliveryRunResult, options: Options): NewProjectAgentPlanningResult {
  void options;
  const stackDecision = path.join(run.runDir, "design", "stack-decision.json");
  const taskGraph = path.join(run.runDir, "planning", "task-graph.json");
  const report = path.join(run.runDir, "orchestration", "new-project-agent-planning.md");
  const dispatchContractsFile = path.join(run.runDir, "orchestration", "dispatch-contracts.json");
  const contracts = newProjectContracts(cwd, run);
  const workflow = workflowState<NewProjectWaitingWorkflow>("new-project-delivery", "waiting_for_model");
  const errors = workflow.notes;

  assertTransitionAccepted(transitionRunState(cwd, run.runId, "waiting_for_model", {
    waiting_for_model_at: new Date().toISOString(),
    waiting_for_model_reason: "new_project requires Architect and Task Planner model outputs before runtime planning"
  }), `run ${run.runId} waiting for model`);

  writeText(dispatchContractsFile, `${JSON.stringify({
    schema_version: 1,
    run_id: run.runId,
    contracts
  }, null, 2)}\n`);

  const stateFile = path.join(run.runDir, "orchestration", "state.json");
  if (fs.existsSync(stateFile)) {
    const current = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, unknown>;
    current.ready_roles = contracts.filter((item) => item.status === "ready").map((item) => item.role);
    current.waiting_roles = contracts.filter((item) => item.status === "waiting").map((item) => item.role);
    current.last_completed_role = "runtime";
    current.updated_at = new Date().toISOString();
    writeText(stateFile, `${JSON.stringify(current, null, 2)}\n`);
  }

  writeText(report, [
    "# New Project Agent Planning",
    "",
    "- status: waiting_for_model",
    `- dispatch contracts: ${dispatchContractsFile}`,
    `- stack decision: ${stackDecision}`,
    `- task graph: ${taskGraph}`,
    "",
    "## Contracts",
    "",
    ...contracts.map((item) => `- ${item.role}: ${item.status}`),
    "",
    "## Waiting On",
    "",
    ...errors.map((error) => `- ${error}`)
  ].join("\n"));

  return {
    runId: run.runId,
    runDir: run.runDir,
    projectKind: "new_project",
    source: run.source,
    status: "waiting_for_model",
    stackDecision,
    taskGraph,
    contracts,
    dispatchContractsFile,
    report,
    errors
  };
}
