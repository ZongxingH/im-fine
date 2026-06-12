# imfine demo 20260612 问题整改方案

## 整改状态

状态：已完成（2026-06-12）。

完成范围：

- runtime deterministic 修复已落地：`status` 默认只读、诊断刷新显式化、诊断失败不吞 `run.json` 基础状态、dispatch action-agent 精确映射、blocker summary 不在只读路径写入、缺报告 demo summary 输出 root cause / gates / next action、task graph `edges` 与 `depends_on` 一致性校验。
- Agent/Skill 契约修复已落地：Orchestrator、Parallel Dispatch、Dev、QA、Reviewer、Committer、Archive、Task Planner 的输出约束已补充，要求 action_id 精确绑定、provider-origin receipt 闭环、标准 handoff evidence、final gates / archive 边界和 canonical task graph。
- 回归测试已落地：覆盖 status 只读错误降级、dispatch 同 role/action_id 精确映射、缺 report demo summary、task graph mixed dependency fixture，以及 demo replay / implementation optimization / harness debugger 相关路径。
- 补充核查已落地：审计报告中的问题逐项核对后，继续修复了预期 handoff 被误算为实际 evidence、多子项目 runtime manifest 识别、orchestrator consistency 对重复 action/receipt 仍 pass 三个 deterministic runtime 缺陷。

验证证据：

```bash
npm test
```

结果：通过。

说明：历史 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo` 输出仍应视作整改 fixture；其中缺失的 provider-origin completion receipt 不能由 runtime 伪造。更新后的 Agent/Skill 重新执行后，才会产生新的 provider-origin receipt、标准 handoff、final gates 和 archive report 闭环。

补充核查结论：验证 demo 中 `agents/**/handoff.json` 实际为 0 个，当前 runtime 已不再把 `agent-name-map.json` 的预期 handoff path 当作 agent-authored evidence；只读 `status --story` 显示 `handoffs: 0`。`backend/pom.xml` / `frontend/package.json` 这类多子项目 manifest 已可被 runtime requirements 扫描到，但缺少 Node 版本声明和标准 `evidence/test-results.md` 时仍会保持 blocked。旧 demo 目录中的 `dispatch-contracts.json`、`agent-name-map.json`、`orchestrator-runtime-consistency.json` 属于整改前派生产物，需通过刷新/重新执行工作流重建，runtime 不应伪造 provider-origin completion。

## 背景

本文针对 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo` 这次 demo 输出和当前 runtime 实现之间暴露的问题，给出独立整改方案。

本轮观察结论是：业务交付产物已经较丰富，但 `.imfine` 下的 runtime 可验证证据链没有闭合；同时 `status` 展示会在部分环境中隐藏真实 blocked 状态。因此该 demo 当前不能作为 true-harness 成功样例，只能作为整改 fixture。

## 整改目标

- `imfine-status` / `status --story` 在只读观察场景下稳定展示真实 run 状态，不因诊断产物写失败退化为 `none`。
- `.imfine/runs/<run-id>/` 中 `run.json`、`orchestration/state.json`、`session-validation.json`、`blocker-summary.json` 表达同一个当前事实。
- dispatch contract 与 agent run 一一对应，不出现 action 错配、receipt 路径复用或重复 contract。
- provider-origin receipt、agent handoff、quality lineage、final gates、archive report 形成单条可验证链路。
- demo 下 `tasks/*` 的人工可读业务证据由 Agent 标准 `agents/*/handoff.json` 引用，runtime 只负责校验、索引和报告缺口。

## 整改原则

本轮整改必须遵守 Agent/Skill 与 deterministic runtime 的职责边界：

- 如果问题来自 Agent 不会规划、不知道该写什么、不理解交付证据、不会调用后续步骤，优先优化 Agent prompt、Skill workflow、handoff 模板和 orchestrator 操作规程。
- 如果问题来自 runtime 确定性读写、schema 校验、状态机同步、路径映射、唯一性检查、报告格式化、错误降级，才通过编码修复。
- runtime 只能校验、物化、索引和拒绝不合规证据，不能替 Agent 做产品判断、架构判断、QA 结论、review 结论或 archive 结论。
- legacy demo 产物可以用于诊断和迁移，但迁移结果必须标明来源；不能把 runtime 迁移产物伪装成 provider-origin Agent 输出。
- 每个整改项都要先判定归属：`agent/skill`、`runtime deterministic` 或 `mixed`。`mixed` 项必须把 Agent 输出契约和 runtime 校验逻辑分开实现。

## P0：修复 status 只读观察和错误吞没

归属：`runtime deterministic`。

### 问题

当前 `status()` 会在读取状态时触发写入：

- `orchestration/runtime-requirements.json`
- `orchestration/harness-components.json`
- `analysis/harness-debug-detail.json`
- `orchestration/run-trace.jsonl`
- `orchestration/blocker-summary.json`

当目标 demo 目录不在可写根、文件只读、或权限受限时，写入失败会被大 `catch` 吞掉，最终把已读到的 `run.json.status=blocked` 展示成 `currentRunStatus=null`。

相关位置：

- `src/core/status.ts`：`status()` 主读取流程
- `src/core/status.ts`：`catch { currentRunStatus = null; currentRunExecutionMode = null; }`

### 方案

1. 将 `status()` 拆成两个阶段：
   - `readStatusSnapshot(cwd, runId)`：纯读取，不写任何文件。
   - `refreshStatusDiagnostics(cwd, runId)`：显式写诊断产物，可失败、可降级。
2. CLI 默认 `status` / `status --story` / `status --debug` 使用纯读快照。
3. 需要更新诊断产物时增加显式选项，例如 `status --refresh`，或只在内部 runtime 命令中调用。
4. 对每个诊断写入单独捕获错误，把错误放入 `currentRunDemoWarnings` 或 `currentRunDiagnosticsErrors`，不要清空 run 基础状态。
5. 即使 diagnostics 全部失败，也必须保留：
   - `currentRunId`
   - `currentRunStatus`
   - `currentRunExecutionMode`
   - `runs[]`
   - 已能读取的 blocker / dispatch / receipt 信息

Agent/Skill 不需要为该项承担补救逻辑；这是 runtime 展示和错误处理的确定性缺陷。

### 验收

- 在只读副本或非 workspace 可写目录运行：

```bash
node dist/cli/imfine-runtime.js status --cwd /Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo --story
```

期望：

- `State: blocked`
- 不再出现 `State: none`
- 如果诊断写入失败，显示 warning，而不是清空状态。

新增测试建议：

- 构造只读 demo fixture，断言 `status()` 不抛错且保留 `run.json.status`。
- 构造 `runtimeRequirementsStatus()` 写入失败，断言 `currentRunStatus` 仍为 `blocked`。

## P0：统一 `.imfine` 状态事实源

归属：`mixed`。

### 问题

当前 demo 中同一 run 同时存在互相矛盾的事实：

- `run.json`：`status=blocked`，blocked reason 是旧的 schema validation failed。
- `orchestration/session-validation.json`：`status=pass`。
- `orchestration/orchestrator-runtime-consistency.json`：`status=pass`。
- `orchestration/state.json`：`status=blocked`，但没有 blocker。
- `orchestration/blocker-summary.json`：仍保留旧的 session validation errors。

这种状态会让 demo 观感变成“系统自己也不知道卡在哪里”。

### 方案

Agent/Skill 侧：

1. 优化 `imfine-agent-orchestrator` 和 `imfine-archive`，要求每次状态推进后明确写出当前 blocker、next owner 和预期补证路径。
2. Orchestrator 不应在 session 已通过后继续引用旧的 schema blocker；如果 blocker 变化，必须在 handoff 或 orchestrator session 中说明新的 blocker 来源。

Runtime deterministic 侧：

1. 定义 run 当前状态优先级：
   - `run.json` 是外部展示状态事实源。
   - `orchestration/state.json` 是 runtime 内部状态机镜像，必须与 `run.json` 同步。
   - `blocker-summary.json` 是派生诊断，不能保留过期 blocker。
2. 每次 session validation 或 orchestrator ingest 成功后：
   - 如果 `session-validation.json=pass`，清除 `run.json.session_validation_errors`。
   - 如果仍 blocked，`blocked_reason` 必须改为当前未闭合的最高优先级 blocker，例如 `provider-origin receipts missing` 或 `dispatch waves incomplete`。
3. `blocker-summary` 重新生成时不得合并旧 JSON 中的 blocker；只从当前文件状态派生。
4. 增加 stale blocker 检测：
   - 如果 `blocker-summary` 指向的 source 已经 pass，则标记为 `stale_blocker_summary`。
   - `status --debug` 必须显示 stale source。

### 验收

对 demo fixture 执行状态刷新后：

- `session-validation.json=pass` 时，`blocker-summary.json` 不再包含 unknown skill / unsupported role 旧错误。
- `run.json.blocked_reason` 指向当前 blocker，例如 provider receipt 或 dispatch completion，而不是旧 schema error。
- `status --debug` 中 `current run blockers` 与 `blocker-summary.json` 数量一致。

## P0：修复 dispatch action-agent 错配

归属：`mixed`，以 runtime deterministic 修复为主，Agent 输出契约同步收紧。

### 问题

`buildDispatchContracts()` 当前用 `role + taskId + parallelGroup` 匹配 action 和 agent。demo 中多个 action 没有 `taskId`，且存在同 role、同 parallelGroup 的 action，因此后写 action 覆盖先写 action。

已观察到的错误：

- `backend-dev-1` 被映射到 `frontend-implementation`。
- `task-planner-1` 和 `implementation-readiness-1` 共享 `implementation-readiness` receipt 路径。
- 多个 contract 的 `depends_on` 被写空，真实 action dependencies 丢失。

相关位置：

- `src/core/dispatch.ts`：`actionByRoleTask`
- `src/core/dispatch.ts`：`const action = actionByRoleTask.get(...) || actionByAgentId.get(agent.id)`

### 方案

Agent/Skill 侧：

1. 优化 `imfine-agent-orchestrator` 输出契约，要求每个 `agent_runs[]` 都必须声明 `action_id`，且 `action_id` 精确对应 `next_actions[].id`。
2. 同一 `role + parallelGroup` 下存在多个 action 时，Agent 必须提供可区分的 `id`、`action_id` 或 `taskId`，不能让 runtime 猜测。
3. `imfine-parallel-agent-dispatch` skill 示例中补充同 role 多 Agent 的写法，避免生成无 taskId、无 action_id 的模糊 action。

Runtime deterministic 侧：

1. 匹配优先级调整为：
   - `agent.action_id` 精确匹配 `action.id`。
   - `agent.dispatchContractId` 精确匹配 contract id。
   - `agent.id` 匹配 action 派生 id。
   - 最后才允许 `role + taskId + parallelGroup` fallback。
2. 当 fallback 命中多个 action 时，不要静默选择；生成 blocked contract：
   - `blocked_reason=ambiguous action-agent mapping`
   - `candidate_action_ids=[...]`
3. `expected_provider_receipt_path` 必须以最终 `action_id` 生成，且同一个 run 内唯一。
4. `buildDispatchContracts()` 后增加唯一性校验：
   - `contract.id` 唯一。
   - `action_id` 不重复，除非显式允许一个 action 有多个 agent，并记录 `fanout_group`。
   - `expected_provider_receipt_path` 不重复。
5. 对 `depends_on` 做保真：优先使用 action 的 `dependsOn/dependencies`，不能被空 agent fields 覆盖。

runtime 只负责确定性匹配和拒绝模糊映射；不根据 action 名称语义推断哪个是 backend、哪个是 frontend。

### 验收

对当前 demo session fixture 生成 dispatch 后：

- `backend-dev-1.action_id=backend-implementation`
- `frontend-dev-1.action_id=frontend-implementation`
- `task-planner-1.action_id=task-planning`
- `implementation-readiness-1.action_id=implementation-readiness`
- provider receipt 路径无重复。
- `parallel-execution.wave_history` 包含完整依赖关系，不能把后续 waiting action 全部当成已 dispatch。

新增测试建议：

- 增加同 role、同 parallelGroup、无 taskId 的多 action fixture。
- 断言 `agent.action_id` 优先级高于 role fallback。
- 断言 ambiguous mapping 会 blocked，而不是错配。

## P0：补齐 provider-origin receipt 闭环

归属：`agent/skill` 为主，runtime deterministic 只做校验和落盘。

### 问题

demo 中 `orchestration/provider-receipts/*.json` 存在，但都是 runtime dispatch record：

- `provider=unknown`
- `origin=runtime_dispatch_record`
- `receipt_type=dispatch_requested`
- `status=waiting_for_agent_output`

这些只能证明 runtime 发起了 dispatch 请求，不能证明 native subagent 完成了工作。

### 方案

Agent/Skill 侧：

1. 优化 `imfine-agent-orchestrator`、`imfine-parallel-agent-dispatch` 和各角色 Agent skill：每个 native agent 完成后，Orchestrator 必须调用 `agent complete` 写入 provider-origin receipt。
2. Agent handoff 模板必须把 `agent complete` 所需 output path、action id、角色和覆盖任务写清楚。
3. 如果当前 provider 不能提供 native subagent 元数据，Orchestrator 必须显式降级为 blocked 或 single-session fallback，并披露 `not_true_harness_proof`，不能让 demo 看起来通过。

Runtime deterministic 侧：

1. `agent complete` 接收并校验 receipt 必填字段：
   - `provider=codex|claude`
   - `origin=provider_native_subagent`
   - `receipt_type=provider_completed`
   - `provider_agent_id`
   - `provider_session_id`
   - `provider_task_handle` 或 `provider_trace_id`
   - `output_path` 指向 provider output snapshot
   - `integrity.output_sha256`
2. 不允许使用 `unknown` provider 或 synthetic id 伪造 true-harness 证明。
3. receipt 写入后同步：
   - `agent-runs.json`
   - `parallel-execution.json`
   - `quality-lineage.json`
   - `true-harness-evidence.json`
   - `blocker-summary.json`

### 验收

`status --debug` 期望：

- `current run provider receipts: receipts=N, valid=N`
- `missing=none`
- `invalid=none`
- provider capability 从 receipt resolution 更新为 supported 或至少不再用 unknown receipt 当证明。

## P1：把 `tasks/*` 业务证据纳入标准 handoff

归属：`agent/skill` 为主，runtime deterministic 只做 schema 校验和 legacy 诊断。

### 问题

当前 demo 业务产物主要在：

- `tasks/*/evidence.md`
- `tasks/QA-*/qa-report.md`
- `tasks/QA-30-acceptance-flow/acceptance-report.md`
- `tasks/REVIEW-10-code-review/review-report.md`
- `tasks/COMMIT-10-commit-readiness/commit-readiness.md`

但 runtime 质量链路只扫描 `agents/*/handoff.json`。结果是人能看懂 demo 做了很多事，runtime 却看不到 QA / review / remediation 通过证据。

### 方案

优先优化 Agent/Skill 输出，而不是让 runtime 任意扫描 markdown：

Agent/Skill 侧：

1. `imfine-agent-dev`、`imfine-agent-qa`、`imfine-agent-reviewer`、`imfine-agent-committer`、`imfine-agent-archive` 必须在完成工作时写标准 `agents/<agent-id>/handoff.json`。
2. 如果还需要保留 `tasks/*` 下的人类可读报告，handoff 中引用这些报告作为 evidence，而不是让 report 自己成为 runtime 事实源。
3. QA 和 Reviewer handoff 必须声明覆盖范围：
   - `covered_task_ids`
   - `status`
   - `findings`
   - `resolves`
   - `supersedes`
   - `evidence`

Runtime deterministic 侧：

1. `quality-lineage` 继续只消费标准 handoff，避免从自由文本 markdown 中推断 QA/review 结论。
2. 可以增加 legacy 诊断：发现 `tasks/*/qa-report.md` 存在但没有对应 `agents/*/handoff.json` 时，输出明确 blocker 和 suggested agent。
3. 如果为了兼容历史 demo 提供 migration/reconcile 工具，只能生成带来源标记的辅助 handoff：
   - `origin=runtime_migrated_legacy_task_report`
   - 不能伪装成 provider-origin receipt。

### 标准 handoff 示例

```json
{
  "run_id": "<run-id>",
  "task_id": "run",
  "role": "qa",
  "from": "qa",
  "to": "reviewer",
  "status": "pass",
  "summary": "Backend and frontend verification passed with documented environment workaround.",
  "covered_task_ids": ["BE-10-supplier", "QA-10-backend-verification"],
  "commands": ["cd backend && mvn test -DargLine=..."],
  "evidence": [
    "tasks/QA-10-backend-verification/qa-report.md",
    "backend/target/surefire-reports/TEST-*.xml"
  ],
  "next_state": "reviewing"
}
```

### 验收

- `quality-lineage.json.summary.qa=pass`
- `quality-lineage.json.summary.review=pass`
- QA/review coverage 不再是 `0/22`。
- `status --story` 中 handoff 数量不再为 0。

## P1：final gates、archive report 和 demo report 闭环

归属：`mixed`，Agent/Skill 负责交付结论，runtime deterministic 负责 gate 校验和报告落盘。

### 问题

当前 demo：

- `.imfine/reports` 为空。
- `report <run-id> --demo-summary` 找不到报告。
- 缺 `orchestration/final-gates.json`。
- 缺 `orchestration/true-harness-evidence.json`。
- 缺 `orchestration/standard-evidence.json`。

这会导致 demo 即便业务实现完成，也不能被 runtime 判定为完成交付。

### 方案

Agent/Skill 侧：

1. 优化 `imfine-agent-archive` 和 `imfine-archive-confirmation`：archive 前必须检查 provider receipt、handoff、QA/review lineage、commit/push policy 和 project knowledge closure。
2. Archive Agent 必须输出 archive handoff，明确：
   - 已采信的 Agent evidence
   - 未闭合 gate
   - 是否允许 archive
   - next owner
3. 如果任一 gate 缺证，Archive Agent 应返回 blocked，不写“完成”口径的总结。

Runtime deterministic 侧：

1. `archive` 前强制运行 reconcile/finalize：
   - 生成 `standard-evidence.json`
   - 生成 `quality-lineage.json`
   - 生成 `true-harness-evidence.json`
   - 生成 `final-gates.json`
2. `archiveRun()` 生成：
   - `archive/archive-report.md`
   - `.imfine/reports/<run-id>.md`
3. `report --demo-summary` 如果报告不存在，应输出可执行 next action，而不是只有 `report not found`：
   - 当前缺什么 gate
   - 哪个 owner 应补
   - 预期文件路径

### 验收

```bash
node dist/cli/imfine-runtime.js report <run-id> --demo-summary --cwd <demo>
```

期望：

- 成功输出 demo summary。
- 显示 agent-authored evidence 和 runtime-derived evidence。
- 如果 blocked，blocked reason 与 `final-gates.json` 或 `blocker-summary.json` 一致。

## P1：task graph schema 兼容和依赖保真

归属：`mixed`，Task Planner skill 负责产出正确计划，runtime deterministic 负责 schema 校验和依赖读取。

### 问题

当前 `planning/task-graph.json` 的任务里有 `depends_on`，但顶层 `edges` 是 0。如果 runtime 后续消费 `edges` 或 `dependsOn`，会丢失真实依赖关系。

### 方案

Agent/Skill 侧：

1. 优化 `imfine-agent-task-planner` 和 `imfine-write-delivery-plan`，要求输出唯一 canonical task graph schema。
2. Task Planner 必须显式表达任务依赖、owner、可并行边界和冻结路径，不能只在 markdown 叙述中描述。
3. 对同一依赖关系不要混用 `depends_on`、`dependsOn`、`edges`，除非模板明确要求双写。

Runtime deterministic 侧：

1. 统一 task graph schema：
   - `tasks[].depends_on` 作为 canonical 字段，或
   - `edges[]` 作为 canonical 字段。
2. 如果保留两者，runtime 生成时必须互相派生并校验一致。
3. 所有消费者统一走 helper：
   - `taskDependencies(taskGraph, taskId)`
   - 禁止散落读取 `edges`、`depends_on`、`dependsOn`。
4. schema validation 要求：
   - 每个 dependency 指向存在的 task。
   - 不允许循环依赖。
   - runtime task 与 agent task 的过滤规则明确。

### 验收

- 当前 demo 的 22 个任务依赖可以完整复原。
- dispatch wave 不会把依赖未满足的 action 提前标为 dispatched。
- `plan-validation` 增加 `depends_on` 与 `edges` 混合 fixture。

## P2：demo fixture 和回归测试

归属：`runtime deterministic`，用于防止 Agent/Skill 契约和 runtime 校验再次分叉。

### 方案

把这次 demo 收敛成最小 replay fixture，不要直接纳入完整业务源码：

```text
test/fixtures/imfine-demo-20260612/
  .imfine/runs/<run-id>/run.json
  .imfine/runs/<run-id>/orchestration/orchestrator-session.json
  .imfine/runs/<run-id>/orchestration/session-validation.json
  .imfine/runs/<run-id>/orchestration/dispatch-contracts.json
  .imfine/runs/<run-id>/planning/task-graph.json
  .imfine/runs/<run-id>/tasks/QA-10-backend-verification/qa-report.md
  .imfine/runs/<run-id>/tasks/REVIEW-10-code-review/review-report.md
```

新增测试覆盖：

- status 只读模式不会写文件。
- status 写诊断失败不吞 run 状态。
- dispatch 同 role/no taskId 不错配。
- stale blocker-summary 可被识别并刷新。
- legacy task report 缺少标准 handoff 时会产生明确 blocker；如提供迁移工具，迁移产物不会生成 provider-origin receipt。
- report demo summary 对缺 report 的 blocked run 给出 next action。

### 验收命令

```bash
npm test
```

如果只验证 runtime 相关最小集合，可先跑：

```bash
npm run build
node test/demo-replay.mjs
node test/replay-coverage.mjs
node test/harness-debugger.mjs
node test/runtime-trace.mjs
```

## 推荐实施顺序

1. 修 `status()` 纯读化和错误降级，先保证 demo 输出可信。归属：runtime deterministic。
2. 优化 Orchestrator / dispatch skill 的 action-agent 输出契约，同时修 runtime 确定性匹配。归属：mixed。
3. 优化各角色 Agent handoff 模板和 `agent complete` 操作规程，补 provider-origin completion。归属：agent/skill 为主。
4. 统一 current run 状态和 blocker 派生逻辑，清除 stale blocker。归属：mixed。
5. 优化 QA / Review / Archive Agent，把 `tasks/*` 报告作为 handoff evidence，而不是替代 handoff。归属：agent/skill 为主。
6. 补 true-harness evidence、final gates、archive report 的 deterministic 校验和落盘。归属：runtime deterministic。
7. 固化 replay fixture，防止相同问题再次回归。

## 完成定义

整改完成后，针对该 demo 或等价 fixture，应满足：

- `status --story` 显示明确 state、root cause、next owner，不出现 `none` 掩盖 blocked。
- `status --debug` 中 dispatch、receipt、handoff、quality lineage、final gates 的 blocked 原因一致。
- `blocker-summary.json` 不包含已修复的旧 blocker。
- 所有 agent contract 均能映射到唯一 action、唯一 provider receipt path、唯一 handoff path。
- QA/review coverage 与 task graph 任务数一致。
- `report --demo-summary` 可输出报告或明确可执行的补证路径。
