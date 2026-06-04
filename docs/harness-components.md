# Harness 组件注册表

本文是 imfine harness component registry 的人工可读版本。机器可校验版本位于 `src/core/harness-components.ts`，每个 run 会写出 `orchestration/harness-components.json`。

## 组件清单

| 组件 ID | 名称 | 层级 | 类型 | 主要产物 |
| --- | --- | --- | --- | --- |
| `runtime.planning-materialization` | Planning Materialization | runtime | orchestration | `analysis/project-context.md`、`orchestration/context.json`、`planning/task-graph.json` |
| `runtime.ingest-orchestrator-session` | Orchestrator Session Ingest | runtime | orchestration | `orchestration/orchestrator-session.json`、`orchestration/orchestrator-runtime-consistency.json` |
| `runtime.dispatch-contracts` | Dispatch Contracts and Waves | runtime | dispatch | `orchestration/dispatch-contracts.json`、`orchestration/parallel-execution.json`、`orchestration/agent-runs.json` |
| `provider.origin-receipts` | Provider Origin Receipts | provider | evidence | `orchestration/provider-receipts/*.json`、`orchestration/provider-outputs/*.json` |
| `runtime.true-harness-evidence` | True Harness Evidence | runtime | evidence | `orchestration/true-harness-evidence.json`、`orchestration/true-harness-evidence.md` |
| `runtime.handoff-validation` | Handoff Validation | runtime | evidence | `agents/*/handoff.json`、`orchestration/handoff-validation.json` |
| `runtime.quality-lineage` | QA and Review Quality Lineage | runtime | lineage | `orchestration/quality-lineage.json` |
| `runtime.final-gates` | Runtime Final Gates | runtime | gate | `orchestration/final-gates.json` |
| `runtime.acceptance-matrix` | Acceptance Matrix | agent | gate | `orchestration/agent-acceptance-matrix.json`、`orchestration/acceptance-matrix.json` |
| `runtime.commit-push-policy` | Commit and Push Policy | runtime | policy | `evidence/commits.md`、`evidence/push.md`、`run.json` |
| `runtime.status-dashboard` | Status Dashboard | runtime | status | `orchestration/queue.json`、`orchestration/final-gates.json`、`orchestration/blocker-summary.json` |
| `runtime.standard-evidence` | Standard Evidence Collector | runtime | evidence | `orchestration/standard-evidence.json`、`evidence/*.md` |
| `runtime.provider-observations` | Provider Observations | runtime | evidence | `orchestration/provider-observations/*.json` |
| `runtime.agent-name-map` | Agent Name Map | runtime | dispatch | `orchestration/agent-name-map.json` |
| `runtime.runtime-requirements` | Runtime Requirements | project_code | gate | `orchestration/runtime-requirements.json`、`orchestration/runtime-requirements.md` |
| `runtime.project-knowledge` | Project Knowledge Freshness | runtime | evidence | `.imfine/project/*.md`、`.imfine/project/project-knowledge-freshness.json` |
| `test.replay-coverage` | Replay Coverage | test | test | `test/replay-coverage.mjs` |
| `runtime.harness-evolution` | Harness Evolution Record | runtime | evolution | `docs/harness-evolution/*.json` |
| `runtime.harness-experiments` | Harness Experiment Workspace | runtime | experiment | `.imfine/harness-experiments/<experiment-id>/` |
| `runtime.harness-config` | Harness Config Overlay | runtime | config | `configs/harness/base.json`、`configs/harness/experiments/*.json` |
| `runtime.sandbox-verification` | Sandbox Verification Adapter | runtime | verification | `orchestration/sandbox-verification.json` |

## H-001 到 H-016 映射

| 问题 | 组件 ID |
| --- | --- |
| H-001 | `runtime.ingest-orchestrator-session`、`runtime.status-dashboard` |
| H-002 | `runtime.dispatch-contracts` |
| H-003 | `provider.origin-receipts`、`runtime.true-harness-evidence` |
| H-004 | `runtime.true-harness-evidence` |
| H-005 | `runtime.handoff-validation`、`runtime.standard-evidence` |
| H-006 | `runtime.quality-lineage` |
| H-007 | `runtime.final-gates` |
| H-008 | `runtime.acceptance-matrix` |
| H-009 | `runtime.commit-push-policy` |
| H-010 | `runtime.status-dashboard` |
| H-011 | `runtime.standard-evidence` |
| H-012 | `runtime.provider-observations` |
| H-013 | `runtime.agent-name-map`、`runtime.dispatch-contracts` |
| H-014 | `runtime.runtime-requirements` |
| H-015 | `test.replay-coverage` |
| H-016 | `runtime.harness-evolution`、`runtime.harness-experiments`、`runtime.harness-config`、`runtime.sandbox-verification` |

## 使用规则

- 后续 `docs/harness-evolution/*.json` 的 `affected_components` 必须使用组件 ID。
- 后续新增 H-xxx 时，必须同步更新 `HARNESS_ISSUE_COVERAGE`。
- 后续 run 的 `orchestration/harness-components.json` 是该 run 使用的组件注册快照。
