# Harness 后续优化方案

本文结合当前 imfine harness 已完成的 H-001 到 H-016 实现，以及 `china-qijizhifeng/agentic-harness-engineering` 中值得借鉴的工程思想，整理下一阶段优化方向。

当前 imfine 已经解决了“run 不能伪 completed”的核心问题：

- Orchestrator session 会被 runtime ingest。
- dispatch contract、wave history、agent handoff、provider-origin receipt、true harness evidence、final gates 都已进入可审计链路。
- QA / Review recheck lineage、acceptance matrix、commit/push policy、runtime requirements、replay coverage、harness evolution record 已经落地。

下一阶段不应继续堆单点 gate，而应把 harness 升级为“可观测、可归因、可实验、可演进”的系统。

## 总体目标

让每次 harness 行为都能回答四个问题：

1. 这次 run 发生了什么？
2. 哪个 harness 组件影响了结果？
3. 本次修改是否真的修复了目标失败？
4. 修改是否引入了新的回归风险？

## O-017 Harness 组件注册表

状态：已完成。

### 优化什么

当前代码已有多个 harness 能力模块，例如：

- `orchestrator.ts`
- `dispatch.ts`
- `provider-evidence.ts`
- `true-harness-evidence.ts`
- `quality-lineage.ts`
- `final-gates.ts`
- `runtime-requirements.ts`
- `reconcile.ts`
- `archive.ts`
- `status.ts`

但缺少统一的 component registry。现在 evolution record 只能写 affected files，不能稳定表达“改的是哪个 harness 能力”。

### 怎么做

新增：

- `docs/harness-components.md`
- `src/core/harness-components.ts`
- `orchestration/harness-components.json`

组件字段建议：

```json
{
  "id": "runtime.final-gates",
  "name": "Runtime Final Gates",
  "type": "gate",
  "owner_layer": "runtime",
  "source_files": ["src/core/final-gates.ts", "src/core/archive.ts", "src/core/reconcile.ts"],
  "artifacts": ["orchestration/final-gates.json"],
  "depends_on": ["runtime.true-harness-evidence", "runtime.quality-lineage"],
  "failure_modes": ["forged_final_gates", "missing_required_gate"]
}
```

`status`、`reconcile`、`harness-evolution` 都应引用 component id，而不是只引用文件路径。

### 验收标准

- 每个 H-001 到 H-016 的完成记录能映射到至少一个 component id。
- `docs/harness-evolution/*.json` 的 `affected_components` 改为 component id，并能校验 id 存在。
- `npm test` 包含 component registry 校验。

### 完成记录

- 新增 `src/core/harness-components.ts`：
  - 定义 `HarnessComponent`、`HarnessIssueCoverage`、`HarnessComponentManifest`。
  - 维护 `HARNESS_COMPONENTS` 和 `HARNESS_ISSUE_COVERAGE`。
  - 提供 `harnessComponents()`、`harnessComponentIds()`、`componentIdsForIssue()`、`validateHarnessComponentIds()`、`harnessComponentManifest()`、`writeHarnessComponents()`。
- 新增 `docs/harness-components.md`：
  - 列出所有 component id。
  - 列出 H-001 到 H-016 的组件映射。
  - 说明后续 evolution record 必须使用 component id。
- `reconcileRun()` 已写出 `.imfine/runs/<run-id>/orchestration/harness-components.json`。
- `status()` 已写出并展示当前 run 的 harness component manifest 摘要。
- `true-harness-evidence` freshness source 已包含 `harness_components`。
- `docs/harness-evolution/2026-06-02-h001-h015-runtime-gates.json` 的 `affected_components` 已改为 component id，并把原文件列表放入 `affected_source_files`。
- `test/harness-evolution.mjs` 已校验 evolution record 中的 component id 必须存在于 registry。
- 新增 `test/harness-components.mjs`：
  - 校验 component id 唯一。
  - 校验 component dependency 全部存在。
  - 校验 H-001 到 H-016 全部有组件映射。
  - 校验 `docs/harness-components.md` 包含所有 component id。
  - 校验 run-local `harness-components.json` 能写出完整 manifest。
- `package.json` 的 `npm test` 已纳入 `node test/harness-components.mjs`。
- 验证：`npm test` 通过。

## O-018 Runtime Trace JSONL

状态：已完成。

### 优化什么

当前 runtime artifact 很完整，但大多是最终状态文件。缺少统一事件流，导致复盘时要从多个 JSON 和 markdown 里拼接过程。

需要从 artifact-first 升级为 trace-first。

### 怎么做

新增：

- `src/core/trace-events.ts`
- `.imfine/runs/<run-id>/orchestration/run-trace.jsonl`
- `.imfine/runs/<run-id>/orchestration/gate-trace.jsonl`

每条 trace 记录包含：

```json
{
  "schema_version": 1,
  "event_id": "evt_...",
  "parent_event_id": null,
  "run_id": "20260603-demo",
  "timestamp": "2026-06-03T10:00:00.000+08:00",
  "source": "runtime.reconcile",
  "component_id": "runtime.final-gates",
  "action_id": "runtime-archive-finalize",
  "event_type": "gate_evaluated",
  "status": "blocked",
  "reason": "runtime_requirements gate is blocked",
  "input_artifacts": ["orchestration/runtime-requirements.json"],
  "output_artifacts": ["orchestration/final-gates.json"]
}
```

接入点：

- `ingestOrchestratorSession`
- `writeTrueHarnessEvidence`
- `writeQualityLineage`
- `writeRuntimeRequirements`
- `finalizeRun`
- `archiveRun`
- `status`

### 验收标准

- 每次 `reconcileRun` 至少写入 ingest、evidence、gate、finalization 事件。
- blocked gate 必须有对应 trace event。
- `status` 能显示最近 3 条 blocker trace。
- stale evidence 能指出导致 stale 的 trace source。

### 完成记录

- 新增 `src/core/trace-events.ts`：
  - 写入 `.imfine/runs/<run-id>/orchestration/run-trace.jsonl`。
  - 写入 `.imfine/runs/<run-id>/orchestration/gate-trace.jsonl`。
  - 提供 `appendRuntimeTraceEvent()`、`appendRuntimeTraceEvents()`、`readRuntimeTraceEvents()`、`latestBlockerTrace()`、`latestTraceSourceForArtifact()`。
- `ingestOrchestratorSession()` 已在 orchestrator persist 阶段写入 ingest trace。
- `writeQualityLineage()` 已写入 quality lineage artifact trace。
- `writeRuntimeRequirements()` 已写入 runtime requirements artifact trace。
- `writeTrueHarnessEvidence()` 与 `writePreArchiveHarnessEvidence()` 已写入 evidence artifact trace。
- `finalizeRun()` 已写入：
  - orchestrator ingest trace。
  - harness component manifest trace。
  - standard evidence trace。
  - runtime requirements trace。
  - true harness evidence trace。
  - 每个 final gate 的 `gate_evaluated` trace。
  - reconcile finalization trace。
- `archiveRun()` 已写入：
  - pre-archive evidence trace。
  - archive start trace。
  - archive gate/check trace。
  - archive finalization trace。
- `status()` 已读取最近 3 条 blocked gate trace，并通过 CLI formatter 输出 `current run blocker trace`。
- `staleTrueHarnessEvidence()` 已在 stale source 后附加 `trace_source`、`component`、`action`、`event`。
- 新增 `test/runtime-trace.mjs`：
  - 校验 reconcile 写出 run/gate JSONL。
  - 校验 blocked gate 必有 trace。
  - 校验 status 返回最近 blocker trace。
  - 校验 stale evidence 能指向导致变化的 trace source。
- `package.json` 的 `npm test` 已纳入 `node test/runtime-trace.mjs`。
- 验证：`npm test` 通过。

## O-019 Harness Debugger Report

状态：已完成。

### 优化什么

当前 `status` 可以显示下一 owner，但缺少跨 artifact 的解释报告。用户看到 blocked 时，仍需要读多个文件。

需要一个自动生成的 harness debugger 报告，把 gate、trace、receipt、handoff、recheck、commit/push、runtime requirements 汇总成可读诊断。

### 怎么做

新增：

- `src/core/harness-debugger.ts`
- `.imfine/runs/<run-id>/analysis/harness-debug-overview.md`
- `.imfine/runs/<run-id>/analysis/harness-debug-detail.json`

overview 示例结构：

```md
# Harness Debug Overview

## 当前结论

- run status: blocked
- next owner: provider
- primary blocker: missing provider-origin receipt for agent-dev-T1

## 证据链

- dispatch contract: pass
- wave history: pass
- handoff: pass
- provider receipt: blocked
- true harness evidence: blocked

## 建议动作

1. 当前 provider session 补写 provider-origin receipt。
2. 重新运行 reconcile。
```

detail JSON 保留可机器分析字段。

### 验收标准

- `status` 可输出 debugger report 路径。
- `reconcileRun` blocked 时必须生成 debugger report。
- report 中每个 claim 都有 artifact 或 trace 引用。

### 完成记录

- 新增 `src/core/harness-debugger.ts`：
  - 生成 `.imfine/runs/<run-id>/analysis/harness-debug-overview.md`。
  - 生成 `.imfine/runs/<run-id>/analysis/harness-debug-detail.json`。
  - 汇总 final gates、true harness evidence、quality lineage、runtime requirements、provider receipts、handoff 与最近 blocker trace。
  - 每个 claim 都写入 `artifact_refs` 或 `trace_refs`。
  - detail JSON 写入 `claim_integrity`，用于校验 claim 证据引用完整性。
- `reconcileRun()` 在 blocked 时已自动生成 debugger overview/detail，并把路径纳入返回文件列表。
- `status()` 已生成或刷新 debugger report，并返回 overview/detail/primary blocker。
- `formatStatus()` 已输出 `current run harness debugger`。
- 新增 `test/harness-debugger.mjs`：
  - 校验 blocked reconcile 自动生成 debugger report。
  - 校验 status 返回 debugger report 路径。
  - 校验 detail 中所有 claim 都带 artifact 或 trace 引用。
  - 校验 overview 包含当前结论、证据链、建议动作。
- `package.json` 的 `npm test` 已纳入 `node test/harness-debugger.mjs`。
- 验证：`npm test` 通过。

## O-020 Change Evaluation / 可证伪演进记录

状态：已完成。

### 优化什么

当前 H-016 已有 harness evolution record，但它更多是“本轮修改记录”。还缺 AHE 式的可证伪评估：预测哪些失败会翻转，实际是否翻转。

### 怎么做

扩展 `docs/harness-evolution/*.json`：

```json
{
  "predicted_outcomes": [
    {
      "fixture": "imfine-runtime-requirements-reconcile-blocked",
      "before": "completed_or_unclassified",
      "expected_after": "blocked_runtime_requirements",
      "component_id": "runtime.runtime-requirements"
    }
  ],
  "observed_outcomes": [
    {
      "fixture": "imfine-runtime-requirements-reconcile-blocked",
      "actual_after": "blocked_runtime_requirements",
      "matched_prediction": true
    }
  ],
  "falsified_predictions": [],
  "rollback_required": false
}
```

新增：

- `test/harness-evolution-outcomes.mjs`

该测试读取 evolution record，确认每个 predicted outcome 都有 observed outcome。

### 验收标准

- 非平凡 harness 修改必须声明 predicted outcomes。
- 每个 predicted outcome 必须绑定 fixture。
- 若 `falsified_predictions` 非空，record 不能是 `verified`。

### 完成记录

- 新增 `test/harness-evolution-outcomes.mjs`：
  - 校验每个 evolution record 必须有 `predicted_outcomes`。
  - 校验每个 prediction 必须绑定 `fixture`、`expected_after` 和有效 `component_id`。
  - 校验每个 prediction 必须有对应 observed outcome。
  - 校验 `matched_prediction` 必须与实际结果一致。
  - 校验 `falsified_predictions` 非空时 record 不能是 `verified`，且必须 `rollback_required=true`。
- 更新 `docs/harness-evolution/2026-06-02-h001-h015-runtime-gates.json`：
  - 补充 `predicted_outcomes`。
  - 补充 `observed_outcomes`。
  - 补充 `falsified_predictions` 和 `rollback_required`。
- 新增 `docs/harness-evolution/2026-06-04-o017-o019-observability.json`：
  - 记录 O-017 component registry、O-018 runtime trace、O-019 debugger report 的预测和观测结果。
  - 绑定 `harness-components`、`runtime-trace`、`harness-debugger`、`harness-evolution-outcomes` fixtures。
- `package.json` 的 `npm test` 已纳入 `node test/harness-evolution-outcomes.mjs`。
- 验证：`npm test` 通过。

## O-021 Harness Experiment Workspace

状态：已完成。

### 优化什么

当前修改直接发生在主工作区，验证依赖 `npm test`。缺少“候选 harness 修改”的实验隔离区。

需要支持一轮 harness experiment 有 input、evolve、result 三段。

### 怎么做

新增目录结构：

```text
.imfine/harness-experiments/<experiment-id>/
  input/
    baseline-commit.txt
    source-failures.json
    replay-fixtures.json
  evolve/
    changed-components.json
    patch.diff
  result/
    verification.json
    change-evaluation.json
```

新增命令或内部 API：

- `createHarnessExperiment(cwd, issueIds)`
- `recordHarnessExperimentPatch(cwd, experimentId)`
- `finalizeHarnessExperiment(cwd, experimentId, verification)`

### 验收标准

- 每个 evolution record 能关联一个 experiment id。
- experiment 记录 baseline commit、changed files、verification command 和 result。
- 后续可以比较两个 experiment 的 verification result。

### 完成记录

- 新增 `src/core/harness-experiments.ts`：
  - `createHarnessExperiment(cwd, issueIds)` 创建 `.imfine/harness-experiments/<experiment-id>/input|evolve|result`。
  - `recordHarnessExperimentPatch(cwd, experimentId)` 写入 `evolve/patch.diff` 和 `evolve/changed-files.json`。
  - `finalizeHarnessExperiment(cwd, experimentId, verification)` 写入 `result/verification.json` 和 `result/change-evaluation.json`。
  - experiment 记录 baseline commit、source failures、replay fixtures、changed components、changed files、verification commands、verification result。
- 新增 component id `runtime.harness-experiments`，并加入 `docs/harness-components.md` 与 H-016 映射。
- `docs/harness-evolution/*.json` 已增加 `experiment_id`。
- `test/harness-evolution.mjs` 已校验每条 evolution record 必须关联 experiment id。
- 新增 `test/harness-experiments.mjs`：
  - 校验 experiment 三段目录结构。
  - 校验 baseline/source/replay/changed-components/patch 文件。
  - 校验 changed files 能记录实际 patch 文件。
  - 校验 verification 与 change-evaluation 结果可写入并可比较。
- `package.json` 的 `npm test` 已纳入 `node test/harness-experiments.mjs`。
- 验证：`npm test` 通过。

## O-022 Config Overlay 实验配置

状态：已完成。

### 优化什么

当前验证流水线固定写在 `package.json`，不利于比较不同 harness 策略。

需要支持 base config + experiment overlay。

### 怎么做

新增：

```text
configs/harness/base.json
configs/harness/experiments/strict-runtime-requirements.json
configs/harness/experiments/provider-receipt-debug.json
```

示例：

```json
{
  "extends": "../base.json",
  "enabled_gates": [
    "dispatch",
    "provider_receipts",
    "quality_lineage",
    "runtime_requirements",
    "final_gates"
  ],
  "trace": {
    "enabled": true,
    "include_artifact_hash": true
  },
  "verification": {
    "commands": ["npm test"]
  }
}
```

### 验收标准

- runtime 能读取 base config。
- experiment config 能覆盖 trace、gate、verification 设置。
- `harness-evolution` record 记录使用的 config id。

### 完成记录

- 新增配置文件：
  - `configs/harness/base.json`
  - `configs/harness/experiments/strict-runtime-requirements.json`
  - `configs/harness/experiments/provider-receipt-debug.json`
- 新增 `src/core/harness-config.ts`：
  - `loadHarnessConfig(cwd, configId)` 读取 base 或 experiment config。
  - 支持 `extends` 继承并合并 trace、gate、verification 设置。
  - `listHarnessConfigIds(cwd)` 列出 base 与 experiment config。
- 新增 component id `runtime.harness-config`，并加入 `docs/harness-components.md` 与 H-016 映射。
- `docs/harness-evolution/*.json` 已增加 `config_id`。
- `test/harness-evolution.mjs` 已校验每条 evolution record 必须记录 config id。
- 新增 `test/harness-config.mjs`：
  - 校验 base config 可读取。
  - 校验 experiment config 能覆盖 trace、enabled gates、verification commands。
  - 校验 config id 列表可读取。
  - 校验 `runtime.harness-config` 已进入 component registry。
- `package.json` 的 `npm test` 已纳入 `node test/harness-config.mjs`。
- 验证：`npm test` 通过。

## O-023 Sandbox Verification Adapter

状态：已完成。

### 优化什么

H-014 已要求 runtime requirements，但测试仍在当前机器运行。环境声明和实际可复现运行之间还缺一道隔离验证。

### 怎么做

先实现本地 sandbox adapter，不急着上远端沙箱：

- `src/core/sandbox-runner.ts`
- `.imfine/runs/<run-id>/orchestration/sandbox-verification.json`

本地 adapter 流程：

1. 创建临时目录。
2. 复制当前项目，排除 `.git`、`.imfine/runs` 中非当前 run 的内容、`node_modules`、build 产物。
3. 根据 runtime requirements 执行安装和测试命令。
4. 记录 stdout、stderr、exit code、runtime version。
5. 将结果作为 archive gate 输入。

后续再抽象 E2B、Docker、remote runner adapter。

### 验收标准

- sandbox verification 失败时 archive blocked。
- sandbox result 进入 true harness freshness source。
- QA evidence 与 sandbox output 不一致时 status 显示 environment / verification mismatch。

### 完成记录

- 新增 `src/core/sandbox-runner.ts`：
  - `runSandboxVerification(cwd, runId, options)` 创建本地临时 sandbox。
  - 复制当前项目并排除 `.git`、`node_modules`、`dist`、非当前 run 的 `.imfine/runs`、`.imfine/harness-experiments`。
  - 执行 runtime version commands、install commands、test commands。
  - 写入 `.imfine/runs/<run-id>/orchestration/sandbox-verification.json`。
  - 提供 `readSandboxVerification()` 和 `sandboxVerificationFile()`。
- `archiveRun()` 已读取 sandbox verification；若结果为 blocked，`run-level.sandbox-verification` check 失败并阻断 archive。
- `true-harness-evidence` freshness source 已加入 `sandbox_verification`。
- `status()` 已读取 sandbox verification，并在 QA evidence 声称通过但 sandbox 失败时显示 `environment / verification mismatch between QA evidence and sandbox output`。
- `formatStatus()` 已输出 `current run sandbox verification`。
- 新增 component id `runtime.sandbox-verification`，并加入 `docs/harness-components.md` 与 H-016 映射。
- 新增 `test/sandbox-runner.mjs`：
  - 校验 sandbox pass 写入结果。
  - 校验 sandbox blocked 进入 true harness stale source。
  - 校验 QA evidence 与 sandbox output 不一致时 status 显示 mismatch。
  - 校验 archive 读取 failing sandbox result 并阻断。
- `package.json` 的 `npm test` 已纳入 `node test/sandbox-runner.mjs`。
- 验证：`npm test` 通过。

## 推荐实施顺序

### 第一阶段：提升可追踪性

1. O-017 Harness 组件注册表
2. O-018 Runtime Trace JSONL
3. O-019 Harness Debugger Report

先解决“发生了什么、哪个组件导致”的问题。

### 第二阶段：提升演进质量

4. O-020 Change Evaluation / 可证伪演进记录
5. O-021 Harness Experiment Workspace

让每次 harness 修改都能被预测、验证、反证和回滚。

### 第三阶段：提升实验能力

6. O-022 Config Overlay 实验配置
7. O-023 Sandbox Verification Adapter

让不同 harness 策略可以被隔离比较，并补齐真实可复现验证。

## 下一步建议

优先做 O-017 到 O-019。

原因：

- 改动面适中。
- 不改变现有 gate 语义。
- 能立刻提升后续 H-xxx 的定位效率。
- 能为 O-020 到 O-023 提供稳定的数据基础。

建议新增 backlog：

- H-017 Harness component registry
- H-018 Runtime trace jsonl
- H-019 Harness debugger report
- H-020 Evolution predicted outcome evaluation
- H-021 Harness experiment workspace
- H-022 Harness config overlay
- H-023 Sandbox verification adapter
