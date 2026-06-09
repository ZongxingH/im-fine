export type RuntimeRole =
  | "architect"
  | "task-planner"
  | "intake"
  | "project-analyzer"
  | "product-planner"
  | "dev"
  | "qa"
  | "reviewer"
  | "merge-agent"
  | "archive"
  | "committer"
  | "risk-reviewer"
  | "technical-writer"
  | "project-knowledge-updater";

export type RoleLevel = "run" | "task" | "both";

export interface RoleContract {
  role: RuntimeRole;
  level: RoleLevel;
  handoffSchema: string;
  allowedTransitions: string[];
  statuses: string[];
  requiredEvidence: string[];
  requiredFields: string[];
  requiredArrayFields: string[];
  requiredStringFields: string[];
}

const DEFAULT_HANDOFF_SCHEMA = "library/templates/handoff.schema.json";
const COMMON_REQUIRED_FIELDS = [
  "run_id",
  "task_id",
  "role",
  "from",
  "to",
  "status",
  "summary",
  "commands",
  "evidence",
  "next_state"
];

const ROLE_CONTRACTS: Record<RuntimeRole, RoleContract> = {
  architect: {
    role: "architect",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["designed", "needs_design_update", "blocked"],
    statuses: ["ready", "blocked", "needs_design_update"],
    requiredEvidence: ["design/design.md"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "design_files"],
    requiredArrayFields: ["commands", "evidence", "design_files"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  "task-planner": {
    role: "task-planner",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["planned", "needs_task_replan", "blocked"],
    statuses: ["ready", "blocked", "needs_replan"],
    requiredEvidence: ["planning/task-graph.json"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "task_graph", "parallel_groups", "serial_tasks"],
    requiredArrayFields: ["commands", "evidence", "parallel_groups", "serial_tasks"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state", "task_graph"]
  },
  intake: {
    role: "intake",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["requirement_analyzed", "blocked"],
    statuses: ["ready", "blocked"],
    requiredEvidence: ["request/normalized.md"],
    requiredFields: COMMON_REQUIRED_FIELDS,
    requiredArrayFields: ["commands", "evidence"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  "project-analyzer": {
    role: "project-analyzer",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["project_analyzed", "blocked"],
    statuses: ["ready", "blocked"],
    requiredEvidence: ["analysis/project-context.md"],
    requiredFields: COMMON_REQUIRED_FIELDS,
    requiredArrayFields: ["commands", "evidence"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  "product-planner": {
    role: "product-planner",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["planned", "blocked"],
    statuses: ["ready", "blocked"],
    requiredEvidence: ["request/normalized.md"],
    requiredFields: COMMON_REQUIRED_FIELDS,
    requiredArrayFields: ["commands", "evidence"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  dev: {
    role: "dev",
    level: "task",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["implementing", "patch_validated", "blocked"],
    statuses: ["ready", "blocked"],
    requiredEvidence: ["agents/*/patch.diff"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "files_changed", "verification"],
    requiredArrayFields: ["commands", "evidence", "files_changed", "verification"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  qa: {
    role: "qa",
    level: "task",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["qa_passed", "qa_failed", "blocked"],
    statuses: ["pass", "fail", "blocked"],
    requiredEvidence: ["evidence/test-results.md"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "failures"],
    requiredArrayFields: ["commands", "evidence", "failures"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  reviewer: {
    role: "reviewer",
    level: "task",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["review_approved", "review_changes_requested", "blocked"],
    statuses: ["approved", "changes_requested", "blocked"],
    requiredEvidence: ["evidence/review.md"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "findings"],
    requiredArrayFields: ["commands", "evidence", "findings"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  "merge-agent": {
    role: "merge-agent",
    level: "task",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["committing", "blocked"],
    statuses: ["ready", "blocked"],
    requiredEvidence: ["agents/*/handoff.json"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "merged_files"],
    requiredArrayFields: ["commands", "evidence", "merged_files"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  archive: {
    role: "archive",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["completed", "blocked"],
    statuses: ["completed", "blocked"],
    requiredEvidence: ["archive/archive-report.md"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "archive_report", "project_updates", "blocked_items"],
    requiredArrayFields: ["commands", "evidence", "project_updates", "blocked_items"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state", "archive_report"]
  },
  committer: {
    role: "committer",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["committing", "blocked"],
    statuses: ["ready", "blocked"],
    requiredEvidence: ["evidence/commits.md", "evidence/push.md"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "commit_mode"],
    requiredArrayFields: ["commands", "evidence"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state", "commit_mode"]
  },
  "risk-reviewer": {
    role: "risk-reviewer",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["planned", "implementing", "blocked"],
    statuses: ["ready", "blocked", "needs_replan"],
    requiredEvidence: ["evidence/review.md"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "risks", "required_changes"],
    requiredArrayFields: ["commands", "evidence", "risks", "required_changes"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  },
  "technical-writer": {
    role: "technical-writer",
    level: "both",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["archiving", "blocked"],
    statuses: ["ready", "not_needed", "blocked"],
    requiredEvidence: ["agents/technical-writer/handoff.json"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "docs_changed", "reason"],
    requiredArrayFields: ["commands", "evidence", "docs_changed"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state", "reason"]
  },
  "project-knowledge-updater": {
    role: "project-knowledge-updater",
    level: "run",
    handoffSchema: DEFAULT_HANDOFF_SCHEMA,
    allowedTransitions: ["archiving", "blocked"],
    statuses: ["ready", "blocked"],
    requiredEvidence: ["agents/project-knowledge-updater/handoff.json"],
    requiredFields: [...COMMON_REQUIRED_FIELDS, "updated_files"],
    requiredArrayFields: ["commands", "evidence", "updated_files"],
    requiredStringFields: ["run_id", "task_id", "role", "from", "to", "status", "summary", "next_state"]
  }
};

export const RUNTIME_ROLES = Object.freeze(Object.keys(ROLE_CONTRACTS) as RuntimeRole[]);

const ROLE_ALIASES: Record<string, RuntimeRole> = {
  architect: "architect",
  "architecture-agent": "architect",
  "task planner": "task-planner",
  task_planner: "task-planner",
  taskplanner: "task-planner",
  planner: "task-planner",
  intake: "intake",
  "project analyzer": "project-analyzer",
  project_analyzer: "project-analyzer",
  "product planner": "product-planner",
  product_planner: "product-planner",
  dev: "dev",
  developer: "dev",
  "backend dev": "dev",
  backend_dev: "dev",
  "backend-dev": "dev",
  backend: "dev",
  "dev backend": "dev",
  dev_backend: "dev",
  "dev-backend": "dev",
  "dev backend remediation": "dev",
  dev_backend_remediation: "dev",
  "dev-backend-remediation": "dev",
  "frontend dev": "dev",
  frontend_dev: "dev",
  "frontend-dev": "dev",
  frontend: "dev",
  "dev frontend": "dev",
  dev_frontend: "dev",
  "dev-frontend": "dev",
  "dev frontend verification": "dev",
  dev_frontend_verification: "dev",
  "dev-frontend-verification": "dev",
  qa: "qa",
  tester: "qa",
  "qa revalidation": "qa",
  qa_revalidation: "qa",
  "qa-revalidation": "qa",
  reviewer: "reviewer",
  review: "reviewer",
  "code reviewer": "reviewer",
  code_reviewer: "reviewer",
  "reviewer revalidation": "reviewer",
  reviewer_revalidation: "reviewer",
  "reviewer-revalidation": "reviewer",
  "risk reviewer": "risk-reviewer",
  risk_reviewer: "risk-reviewer",
  risk: "risk-reviewer",
  "merge agent": "merge-agent",
  merge_agent: "merge-agent",
  merge: "merge-agent",
  archive: "archive",
  archiver: "archive",
  committer: "committer",
  commit: "committer",
  "technical writer": "technical-writer",
  technical_writer: "technical-writer",
  writer: "technical-writer",
  "project knowledge updater": "project-knowledge-updater",
  project_knowledge_updater: "project-knowledge-updater",
  knowledge_updater: "project-knowledge-updater"
};

export function isRuntimeRole(role: string): role is RuntimeRole {
  return Object.prototype.hasOwnProperty.call(ROLE_CONTRACTS, role);
}

export function normalizeRuntimeRole(role: string): RuntimeRole | null {
  const normalized = role.trim().toLowerCase().replace(/\s+/g, " ");
  const hyphenated = normalized.replaceAll("_", "-").replaceAll(" ", "-");
  if (isRuntimeRole(hyphenated)) return hyphenated;
  return ROLE_ALIASES[normalized] || ROLE_ALIASES[hyphenated] || null;
}

export function roleContract(role: RuntimeRole): RoleContract {
  return ROLE_CONTRACTS[role];
}

export function allowedTransitionsForRole(role: string): string[] {
  return isRuntimeRole(role) ? [...roleContract(role).allowedTransitions] : ["implementing", "patch_validated", "blocked"];
}

export function handoffSchemaForRole(role: string): string {
  return isRuntimeRole(role) ? roleContract(role).handoffSchema : DEFAULT_HANDOFF_SCHEMA;
}

export function evidenceRequirementsForRole(role: string): string[] {
  return isRuntimeRole(role) ? [...roleContract(role).requiredEvidence] : [];
}

export function runtimeRoleContracts(): RoleContract[] {
  return RUNTIME_ROLES.map((role) => roleContract(role));
}
