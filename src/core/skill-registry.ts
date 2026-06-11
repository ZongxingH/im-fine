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
  "project-knowledge-updater",
  "ux-designer"
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
  brainstorming: {
    id: "brainstorming",
    roles: ["intake", "product-planner", "ux-designer"],
    requiredInputs: ["request", "project context"],
    expectedOutputs: ["brainstorming direction and decision log"],
    requiredEvidence: ["analysis/brainstorming.md"],
    failureHandling: "block planning until direction is explicit"
  },
  "product-brief": {
    id: "product-brief",
    roles: ["intake", "product-planner", "ux-designer"],
    requiredInputs: ["normalized requirement", "accepted brainstorming direction"],
    expectedOutputs: ["product scope, non-goals, acceptance candidates"],
    requiredEvidence: ["analysis/product-brief.md"],
    failureHandling: "request requirement clarification or block architecture"
  },
  "validate-requirement": {
    id: "validate-requirement",
    roles: ["intake", "product-planner", "architect", "task-planner"],
    requiredInputs: ["requirement", "product brief", "known unknowns"],
    expectedOutputs: ["validated requirement or blocked clarification list"],
    requiredEvidence: ["analysis/requirement-validation.md"],
    failureHandling: "block planning when ambiguity remains"
  },
  "implementation-readiness": {
    id: "implementation-readiness",
    roles: ["product-planner", "architect", "task-planner", "qa", "risk-reviewer", "ux-designer"],
    requiredInputs: ["requirement", "architecture", "task graph", "provider capability", "acceptance candidates"],
    expectedOutputs: ["readiness verdict and required fixes"],
    requiredEvidence: ["orchestration/implementation-readiness.md"],
    failureHandling: "block Dev dispatch until readiness is restored"
  },
  "correct-course": {
    id: "correct-course",
    roles: ["product-planner", "architect", "task-planner", "dev", "qa", "reviewer", "risk-reviewer", "ux-designer"],
    requiredInputs: ["material change", "current run artifacts", "failed evidence"],
    expectedOutputs: ["course correction decision and replan requirements"],
    requiredEvidence: ["orchestration/course-correction.md"],
    failureHandling: "request replan, revalidation, or block run"
  },
  retrospective: {
    id: "retrospective",
    roles: ["archive", "technical-writer", "project-knowledge-updater", "risk-reviewer"],
    requiredInputs: ["final report", "gates", "blockers", "trace evidence"],
    expectedOutputs: ["lessons, project knowledge, harness evolution candidates"],
    requiredEvidence: ["archive/retrospective.md"],
    failureHandling: "record follow-up without changing completed or blocked verdict"
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
  },
  "harness-audit": {
    id: "harness-audit",
    roles: ALL_ROLES,
    requiredInputs: ["run artifacts", "runtime status", "demo summary"],
    expectedOutputs: ["demo observation report"],
    requiredEvidence: ["analysis/demo-observation.md"],
    failureHandling: "mark demo blocked or misleading when evidence is missing"
  }
};

const SKILL_ALIASES: Record<string, string> = {
  "imfine-product-planning": "clarify",
  "imfine-architecture": "project-analysis",
  "imfine-task-planning": "write-delivery-plan",
  "imfine-dev": "execute-task-plan",
  "imfine-qa": "verification",
  "imfine-review": "code-review",
  "imfine-risk-review": "risk-review",
  "imfine-merge": "merge",
  "imfine-technical-writing": "documentation",
  "imfine-project-knowledge": "project-knowledge",
  "imfine-commit": "scope-control",
  "imfine-archive": "archive",
  "imfine-harness-audit": "harness-audit",
  "imfine-brainstorming": "brainstorming",
  "imfine-product-brief": "product-brief",
  "imfine-validate-requirement": "validate-requirement",
  "imfine-implementation-readiness": "implementation-readiness",
  "imfine-correct-course": "correct-course",
  "imfine-retrospective": "retrospective",
  "demo-observability": "harness-audit",
  "demo-audit": "harness-audit"
};

export function normalizeSkillId(id: string): string {
  const normalized = id.trim().toLowerCase().replaceAll("_", "-").replace(/\s+/g, "-");
  return SKILL_ALIASES[normalized] || normalized;
}

export function normalizeSkillIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map(normalizeSkillId).filter((id) => id.length > 0)));
}

export function skillContract(id: string): SkillContract | null {
  return SKILLS[normalizeSkillId(id)] || null;
}

export function skillContracts(): SkillContract[] {
  return Object.values(SKILLS);
}

export function validateAgentSkills(role: string, skills: string[]): string[] {
  const errors: string[] = [];
  if (!isRuntimeRole(role)) return errors;
  for (const skill of normalizeSkillIds(skills)) {
    const contract = SKILLS[skill];
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
  return Array.from(new Set(normalizeSkillIds(skills).flatMap((skill) => skillContract(skill)?.requiredEvidence || []))).sort();
}
