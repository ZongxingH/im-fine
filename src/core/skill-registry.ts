import { isRuntimeRole, type RuntimeRole } from "./role-registry.js";

export interface SkillContract {
  id: string;
  roles: RuntimeRole[];
  requiredInputs: string[];
  expectedOutputs: string[];
  requiredEvidence: string[];
  failureHandling: string;
}

const ALL_ROLES: RuntimeRole[] = [
  "architect",
  "task-planner",
  "intake",
  "project-analyzer",
  "product-planner",
  "dev",
  "qa",
  "reviewer",
  "merge-agent",
  "archive",
  "committer",
  "risk-reviewer",
  "technical-writer",
  "project-knowledge-updater"
];

const SKILLS: Record<string, SkillContract> = {
  clarify: {
    id: "clarify",
    roles: ["intake", "product-planner", "orchestrator" as RuntimeRole].filter(isRuntimeRole),
    requiredInputs: ["request"],
    expectedOutputs: ["normalized requirement or blocked reason"],
    requiredEvidence: ["request/normalized.md"],
    failureHandling: "block or request requirement reanalysis"
  },
  "project-analysis": {
    id: "project-analysis",
    roles: ["project-analyzer", "architect", "task-planner"],
    requiredInputs: ["project files"],
    expectedOutputs: ["project context"],
    requiredEvidence: ["analysis/project-context.md"],
    failureHandling: "block or request infrastructure action"
  },
  "write-delivery-plan": {
    id: "write-delivery-plan",
    roles: ["task-planner", "architect"],
    requiredInputs: ["design", "requirement"],
    expectedOutputs: ["task graph"],
    requiredEvidence: ["planning/task-graph.json"],
    failureHandling: "request task replan"
  },
  "execute-task-plan": {
    id: "execute-task-plan",
    roles: ["dev", "merge-agent", "committer"],
    requiredInputs: ["task graph", "agent input"],
    expectedOutputs: ["patch or commit evidence"],
    requiredEvidence: ["agents/*/handoff.json"],
    failureHandling: "block or create fix task"
  },
  tdd: {
    id: "tdd",
    roles: ["dev", "qa"],
    requiredInputs: ["acceptance", "test plan"],
    expectedOutputs: ["failing/passing test evidence or exemption"],
    requiredEvidence: ["evidence/test-results.md"],
    failureHandling: "block without test evidence or exemption"
  },
  "systematic-debugging": {
    id: "systematic-debugging",
    roles: ["dev", "qa", "reviewer"],
    requiredInputs: ["failure evidence"],
    expectedOutputs: ["root cause and verification"],
    requiredEvidence: ["evidence/test-results.md"],
    failureHandling: "create fix task or request design update"
  },
  "parallel-agent-dispatch": {
    id: "parallel-agent-dispatch",
    roles: ["task-planner", "dev", "qa", "reviewer", "merge-agent"],
    requiredInputs: ["parallel group", "dispatch contract"],
    expectedOutputs: ["handoff per agent"],
    requiredEvidence: ["orchestration/parallel-execution.json"],
    failureHandling: "wait for agent output or block"
  },
  "code-review": {
    id: "code-review",
    roles: ["reviewer", "risk-reviewer"],
    requiredInputs: ["patch", "QA evidence"],
    expectedOutputs: ["findings or approval"],
    requiredEvidence: ["evidence/review.md"],
    failureHandling: "request changes or block"
  },
  "archive-confirmation": {
    id: "archive-confirmation",
    roles: ["archive", "technical-writer", "project-knowledge-updater"],
    requiredInputs: ["final gates", "archive evidence"],
    expectedOutputs: ["archive report"],
    requiredEvidence: ["archive/archive-report.md"],
    failureHandling: "block archive"
  },
  implementation: {
    id: "implementation",
    roles: ["dev"],
    requiredInputs: ["task input"],
    expectedOutputs: ["patch"],
    requiredEvidence: ["agents/*/patch.diff"],
    failureHandling: "block or mark patch invalid"
  },
  verification: {
    id: "verification",
    roles: ["qa"],
    requiredInputs: ["patch", "test plan"],
    expectedOutputs: ["QA handoff"],
    requiredEvidence: ["evidence/test-results.md"],
    failureHandling: "create fix task or block"
  },
  "risk-review": {
    id: "risk-review",
    roles: ["reviewer", "risk-reviewer"],
    requiredInputs: ["patch risk evidence"],
    expectedOutputs: ["risk decision"],
    requiredEvidence: ["evidence/review.md"],
    failureHandling: "request changes or block"
  },
  merge: {
    id: "merge",
    roles: ["merge-agent"],
    requiredInputs: ["approved task"],
    expectedOutputs: ["merged files"],
    requiredEvidence: ["agents/*/handoff.json"],
    failureHandling: "block commit"
  },
  "scope-control": {
    id: "scope-control",
    roles: ["merge-agent", "committer", "risk-reviewer"],
    requiredInputs: ["write scope"],
    expectedOutputs: ["scope decision"],
    requiredEvidence: ["agents/*/handoff.json"],
    failureHandling: "block on scope violation"
  },
  documentation: {
    id: "documentation",
    roles: ["technical-writer"],
    requiredInputs: ["archive evidence"],
    expectedOutputs: ["documentation handoff"],
    requiredEvidence: ["agents/technical-writer/handoff.json"],
    failureHandling: "block or mark not needed"
  },
  "project-knowledge": {
    id: "project-knowledge",
    roles: ["project-knowledge-updater"],
    requiredInputs: ["archive report"],
    expectedOutputs: ["project knowledge handoff"],
    requiredEvidence: ["agents/project-knowledge-updater/handoff.json"],
    failureHandling: "block archive"
  },
  archive: {
    id: "archive",
    roles: ["archive"],
    requiredInputs: ["final gates"],
    expectedOutputs: ["archive report"],
    requiredEvidence: ["archive/archive-report.md"],
    failureHandling: "block archive"
  }
};

export function skillContract(id: string): SkillContract | null {
  return SKILLS[id] || null;
}

export function skillContracts(): SkillContract[] {
  return Object.values(SKILLS);
}

export function validateAgentSkills(role: string, skills: string[]): string[] {
  const errors: string[] = [];
  if (!isRuntimeRole(role)) return errors;
  for (const skill of skills) {
    const contract = skillContract(skill);
    if (!contract) {
      errors.push(`unknown skill for ${role}: ${skill}`);
      continue;
    }
    if (!contract.roles.includes(role)) {
      const roleAllowedByBroadContract = contract.roles.length === ALL_ROLES.length;
      if (!roleAllowedByBroadContract) errors.push(`skill ${skill} is not allowed for role ${role}`);
    }
  }
  return errors;
}

export function skillEvidenceRequirements(skills: string[]): string[] {
  return Array.from(new Set(skills.flatMap((skill) => skillContract(skill)?.requiredEvidence || []))).sort();
}
