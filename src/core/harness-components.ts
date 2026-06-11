import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

export type HarnessComponentType =
  | "orchestration"
  | "dispatch"
  | "evidence"
  | "gate"
  | "lineage"
  | "policy"
  | "status"
  | "test"
  | "evolution"
  | "experiment"
  | "config"
  | "verification";

export type HarnessOwnerLayer = "runtime" | "orchestrator" | "provider" | "agent" | "project_code" | "test";

export interface HarnessComponent {
  id: string;
  name: string;
  type: HarnessComponentType;
  owner_layer: HarnessOwnerLayer;
  source_files: string[];
  artifacts: string[];
  depends_on: string[];
  failure_modes: string[];
}

export interface HarnessIssueCoverage {
  issue_id: string;
  component_ids: string[];
}

export interface HarnessComponentManifest {
  schema_version: 1;
  generated_at: string;
  components: HarnessComponent[];
  issue_coverage: HarnessIssueCoverage[];
}

export const HARNESS_COMPONENTS: HarnessComponent[] = [
  {
    id: "runtime.planning-materialization",
    name: "Planning Materialization",
    type: "orchestration",
    owner_layer: "runtime",
    source_files: ["src/core/run.ts", "src/core/plan.ts"],
    artifacts: ["analysis/project-context.md", "orchestration/context.json", "planning/task-graph.json"],
    depends_on: [],
    failure_modes: ["missing_context", "missing_task_graph", "invalid_task_graph"]
  },
  {
    id: "runtime.ingest-orchestrator-session",
    name: "Orchestrator Session Ingest",
    type: "orchestration",
    owner_layer: "runtime",
    source_files: ["src/core/orchestrator.ts"],
    artifacts: ["orchestration/orchestrator-session.json", "orchestration/orchestrator-runtime-consistency.json"],
    depends_on: ["runtime.dispatch-contracts"],
    failure_modes: ["session_not_ingested", "session_runtime_split", "invalid_session_schema"]
  },
  {
    id: "runtime.dispatch-contracts",
    name: "Dispatch Contracts and Waves",
    type: "dispatch",
    owner_layer: "runtime",
    source_files: ["src/core/dispatch.ts", "src/core/orchestrator.ts"],
    artifacts: ["orchestration/dispatch-contracts.json", "orchestration/parallel-execution.json", "orchestration/agent-runs.json"],
    depends_on: ["runtime.ingest-orchestrator-session"],
    failure_modes: ["missing_dispatch_contract", "missing_wave_history", "missing_completed_wave"]
  },
  {
    id: "provider.origin-receipts",
    name: "Provider Origin Receipts",
    type: "evidence",
    owner_layer: "provider",
    source_files: ["src/core/provider-evidence.ts", "src/core/agent-complete.ts"],
    artifacts: ["orchestration/provider-receipts/*.json", "orchestration/provider-outputs/*.json"],
    depends_on: ["runtime.dispatch-contracts"],
    failure_modes: ["missing_provider_receipt", "invalid_provider_receipt", "synthetic_receipt"]
  },
  {
    id: "runtime.true-harness-evidence",
    name: "True Harness Evidence",
    type: "evidence",
    owner_layer: "runtime",
    source_files: ["src/core/true-harness-evidence.ts"],
    artifacts: ["orchestration/true-harness-evidence.json", "orchestration/true-harness-evidence.md"],
    depends_on: ["runtime.dispatch-contracts", "provider.origin-receipts", "runtime.handoff-validation"],
    failure_modes: ["false_true_harness", "stale_evidence", "missing_source_artifact"]
  },
  {
    id: "runtime.handoff-validation",
    name: "Handoff Validation",
    type: "evidence",
    owner_layer: "runtime",
    source_files: ["src/core/handoff-evidence.ts", "src/core/handoff-validator.ts", "src/core/orchestrator.ts"],
    artifacts: ["agents/*/handoff.json", "orchestration/handoff-validation.json"],
    depends_on: ["runtime.dispatch-contracts"],
    failure_modes: ["missing_handoff", "invalid_handoff_schema", "missing_handoff_evidence"]
  },
  {
    id: "runtime.quality-lineage",
    name: "QA and Review Quality Lineage",
    type: "lineage",
    owner_layer: "runtime",
    source_files: ["src/core/quality-lineage.ts", "src/core/archive.ts", "src/core/reconcile.ts", "src/core/status.ts"],
    artifacts: ["orchestration/quality-lineage.json", "agents/qa-*/handoff.json", "agents/reviewer-*/handoff.json"],
    depends_on: ["runtime.handoff-validation"],
    failure_modes: ["unresolved_quality_finding", "invalid_recheck_lineage", "missing_recheck_evidence"]
  },
  {
    id: "runtime.final-gates",
    name: "Runtime Final Gates",
    type: "gate",
    owner_layer: "runtime",
    source_files: ["src/core/final-gates.ts", "src/core/archive.ts", "src/core/reconcile.ts"],
    artifacts: ["orchestration/final-gates.json"],
    depends_on: ["runtime.true-harness-evidence", "runtime.quality-lineage", "runtime.runtime-requirements"],
    failure_modes: ["missing_required_gate", "forged_final_gates", "run_completed_without_gates"]
  },
  {
    id: "runtime.acceptance-matrix",
    name: "Acceptance Matrix",
    type: "gate",
    owner_layer: "agent",
    source_files: ["src/core/reconcile.ts"],
    artifacts: ["orchestration/agent-acceptance-matrix.json", "orchestration/acceptance-matrix.json"],
    depends_on: ["runtime.handoff-validation"],
    failure_modes: ["missing_acceptance_matrix", "blocked_required_item", "unaccepted_deviation"]
  },
  {
    id: "runtime.commit-push-policy",
    name: "Commit and Push Policy",
    type: "policy",
    owner_layer: "runtime",
    source_files: ["src/core/gitflow.ts", "src/core/reconcile.ts", "src/core/archive.ts"],
    artifacts: ["evidence/commits.md", "evidence/push.md", "run.json"],
    depends_on: ["runtime.quality-lineage"],
    failure_modes: ["missing_commit_hash", "non_git_repository", "push_blocked_no_remote"]
  },
  {
    id: "runtime.status-dashboard",
    name: "Status Dashboard",
    type: "status",
    owner_layer: "runtime",
    source_files: ["src/core/status.ts", "src/core/format.ts"],
    artifacts: ["orchestration/queue.json", "orchestration/final-gates.json", "orchestration/blocker-summary.json"],
    depends_on: ["runtime.final-gates", "runtime.true-harness-evidence"],
    failure_modes: ["file_existence_status", "missing_next_owner", "hidden_blocker"]
  },
  {
    id: "runtime.standard-evidence",
    name: "Standard Evidence Collector",
    type: "evidence",
    owner_layer: "runtime",
    source_files: ["src/core/reconcile.ts"],
    artifacts: ["orchestration/standard-evidence.json", "evidence/test-results.md", "evidence/review.md", "evidence/risk-review.md"],
    depends_on: ["runtime.handoff-validation"],
    failure_modes: ["missing_standard_evidence", "scattered_evidence", "unindexed_handoff_source"]
  },
  {
    id: "runtime.provider-observations",
    name: "Provider Observations",
    type: "evidence",
    owner_layer: "runtime",
    source_files: ["src/core/provider-observation.ts", "src/core/true-harness-evidence.ts", "src/core/status.ts"],
    artifacts: ["orchestration/provider-observations/*.json"],
    depends_on: ["provider.origin-receipts"],
    failure_modes: ["observation_used_as_proof", "missing_observation_boundary", "incomplete_provider_diagnostics"]
  },
  {
    id: "runtime.agent-name-map",
    name: "Agent Name Map",
    type: "dispatch",
    owner_layer: "runtime",
    source_files: ["src/core/orchestrator.ts", "src/core/status.ts"],
    artifacts: ["orchestration/agent-name-map.json"],
    depends_on: ["runtime.dispatch-contracts", "provider.origin-receipts"],
    failure_modes: ["display_name_unmapped", "receipt_unlinked_to_action", "handoff_unlinked_to_contract"]
  },
  {
    id: "runtime.runtime-requirements",
    name: "Runtime Requirements",
    type: "gate",
    owner_layer: "project_code",
    source_files: ["src/core/runtime-requirements.ts", "src/core/archive.ts", "src/core/reconcile.ts", "src/core/status.ts"],
    artifacts: ["orchestration/runtime-requirements.json", "orchestration/runtime-requirements.md", "evidence/test-results.md"],
    depends_on: ["runtime.standard-evidence"],
    failure_modes: ["missing_runtime_declaration", "missing_runtime_version_output", "missing_test_command_output"]
  },
  {
    id: "runtime.project-knowledge",
    name: "Project Knowledge Freshness",
    type: "evidence",
    owner_layer: "runtime",
    source_files: ["src/core/archive.ts", "src/core/reconcile.ts", "src/core/trace.ts"],
    artifacts: [".imfine/project/*.md", ".imfine/project/project-knowledge-freshness.json"],
    depends_on: ["runtime.final-gates"],
    failure_modes: ["stale_project_knowledge", "missing_project_knowledge", "untraced_project_update"]
  },
  {
    id: "test.replay-coverage",
    name: "Replay Coverage",
    type: "test",
    owner_layer: "test",
    source_files: ["test/replay-coverage.mjs", "test/demo-replay.mjs", "test/reconcile.mjs", "test/implementation-optimization.mjs"],
    artifacts: ["test/replay-coverage.mjs"],
    depends_on: [],
    failure_modes: ["missing_replay_fixture", "undocumented_closed_issue", "untracked_repeated_failure"]
  },
  {
    id: "runtime.harness-evolution",
    name: "Harness Evolution Record",
    type: "evolution",
    owner_layer: "runtime",
    source_files: ["test/harness-evolution.mjs", "test/harness-evolution-outcomes.mjs", "docs/IMFINE_IMPLEMENTATION.md"],
    artifacts: ["docs/IMFINE_IMPLEMENTATION.md"],
    depends_on: ["test.replay-coverage", "runtime.harness-experiments"],
    failure_modes: ["missing_evolution_record", "unverified_harness_change", "unmapped_affected_component"]
  },
  {
    id: "runtime.harness-experiments",
    name: "Harness Experiment Workspace",
    type: "experiment",
    owner_layer: "runtime",
    source_files: ["src/core/harness-experiments.ts"],
    artifacts: [".imfine/harness-experiments/<experiment-id>/"],
    depends_on: ["test.replay-coverage"],
    failure_modes: ["missing_experiment_workspace", "missing_baseline_commit", "missing_verification_result"]
  },
  {
    id: "runtime.harness-config",
    name: "Harness Config Overlay",
    type: "config",
    owner_layer: "runtime",
    source_files: ["src/core/harness-config.ts", "configs/harness/**/*.json"],
    artifacts: ["configs/harness/base.json", "configs/harness/experiments/*.json"],
    depends_on: ["runtime.harness-experiments"],
    failure_modes: ["missing_base_config", "invalid_experiment_overlay", "missing_config_id"]
  },
  {
    id: "runtime.sandbox-verification",
    name: "Sandbox Verification Adapter",
    type: "verification",
    owner_layer: "runtime",
    source_files: ["src/core/sandbox-runner.ts", "src/core/archive.ts", "src/core/status.ts"],
    artifacts: ["orchestration/sandbox-verification.json"],
    depends_on: ["runtime.runtime-requirements"],
    failure_modes: ["sandbox_command_failed", "qa_sandbox_mismatch", "missing_sandbox_result"]
  }
];

export const HARNESS_ISSUE_COVERAGE: HarnessIssueCoverage[] = [
  { issue_id: "H-001", component_ids: ["runtime.ingest-orchestrator-session", "runtime.status-dashboard"] },
  { issue_id: "H-002", component_ids: ["runtime.dispatch-contracts"] },
  { issue_id: "H-003", component_ids: ["provider.origin-receipts", "runtime.true-harness-evidence"] },
  { issue_id: "H-004", component_ids: ["runtime.true-harness-evidence"] },
  { issue_id: "H-005", component_ids: ["runtime.handoff-validation", "runtime.standard-evidence"] },
  { issue_id: "H-006", component_ids: ["runtime.quality-lineage"] },
  { issue_id: "H-007", component_ids: ["runtime.final-gates"] },
  { issue_id: "H-008", component_ids: ["runtime.acceptance-matrix"] },
  { issue_id: "H-009", component_ids: ["runtime.commit-push-policy"] },
  { issue_id: "H-010", component_ids: ["runtime.status-dashboard"] },
  { issue_id: "H-011", component_ids: ["runtime.standard-evidence"] },
  { issue_id: "H-012", component_ids: ["runtime.provider-observations"] },
  { issue_id: "H-013", component_ids: ["runtime.agent-name-map", "runtime.dispatch-contracts"] },
  { issue_id: "H-014", component_ids: ["runtime.runtime-requirements"] },
  { issue_id: "H-015", component_ids: ["test.replay-coverage"] },
  { issue_id: "H-016", component_ids: ["runtime.harness-evolution", "runtime.harness-experiments", "runtime.harness-config", "runtime.sandbox-verification"] }
];

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

export function harnessComponents(): HarnessComponent[] {
  return HARNESS_COMPONENTS.map((component) => ({
    ...component,
    source_files: [...component.source_files],
    artifacts: [...component.artifacts],
    depends_on: [...component.depends_on],
    failure_modes: [...component.failure_modes]
  }));
}

export function harnessComponentIds(): Set<string> {
  return new Set(HARNESS_COMPONENTS.map((component) => component.id));
}

export function componentIdsForIssue(issueId: string): string[] {
  return HARNESS_ISSUE_COVERAGE.find((item) => item.issue_id === issueId)?.component_ids || [];
}

export function validateHarnessComponentIds(ids: string[]): string[] {
  const known = harnessComponentIds();
  return ids.filter((id) => !known.has(id));
}

export function harnessComponentManifest(): HarnessComponentManifest {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    components: harnessComponents(),
    issue_coverage: HARNESS_ISSUE_COVERAGE.map((item) => ({
      issue_id: item.issue_id,
      component_ids: [...item.component_ids]
    }))
  };
}

export function writeHarnessComponents(cwd: string, runId: string): string {
  const file = path.join(runDir(cwd, runId), "orchestration", "harness-components.json");
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify(harnessComponentManifest(), null, 2)}\n`);
  return file;
}
