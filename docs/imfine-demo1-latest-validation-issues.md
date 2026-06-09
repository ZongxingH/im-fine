# imfine-demo1 最新验证输出问题与处理方案

本文基于 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo1` 的最新验证输出和本地运行数据整理。结论是：之前的部分展示噪声和 Git ignore 问题已经改善，但 true harness 的 runtime 闭环仍未完成，当前主要卡在 `orchestrator-session.json` 不符合 runtime schema，导致 runtime 无法生成有效 dispatch、provider evidence、quality lineage 和 final report。

## runtime schema 是什么

runtime schema 指 imfine runtime 能够稳定读取、校验和推进的结构化数据契约。它不是业务系统的数据表 schema，而是 harness 内部产物的格式约定。

以 `orchestration/orchestrator-session.json` 为例，runtime schema 会约束：

- 顶层 `status` 必须是 runtime 认可的 run state。
- `next_actions[].status` 只能是 `ready`、`waiting`、`blocked`、`done`。
- `next_actions[].role` 必须是 runtime 支持的角色，例如 `dev`、`qa`、`reviewer`、`merge-agent`、`committer`、`technical-writer`、`project-knowledge-updater`、`archive` 等。
- `agent_runs[].status` 只能是 `ready`、`waiting`、`planned`、`completed`。
- `agent_runs[].id` 不能重复，并且需要能匹配到对应 action。

如果模型写了 `Dev Backend`、`qa-revalidation`、`running`、`ready_for_commit` 这类 runtime schema 之外的值，业务语义上可能看得懂，但 runtime 不能确定地处理，因此不会生成合法 dispatch contract，也无法继续收敛到 final gates。

## 1. 当前 run 已唯一，但仍处于 blocked

**问题**

当前 `.imfine/state/current.json` 只指向一个 run，之前“多个 run / current 指向不完整 run”的混乱已经改善。但当前 run 的 `run.json` 仍是 `blocked`，不是 `completed`。

**证据**

- current run: `20260609-搭建生鲜进销存管理系统-包含供应商档案管理-商品品类与商品档案维护-采购入库单据-销售开单出库-`
- `run.status=blocked`
- `queue.actions=0`
- `dispatch.contracts=0`

**处理方案**

- 保留单 run/current 的准备方式。
- 继续修复 runtime schema，使 runtime 能重建 dispatch contracts、agent runs、quality lineage、final gates。
- blocked 状态要来自唯一当前 blocker，而不是旧 session-validation/provider-capability 噪声。

## 2. orchestrator-session 不符合 runtime schema

**问题**

`orchestration/session-validation.json` 显示大量 schema 错误。当前 `orchestrator-session.json` 中使用了 runtime 不支持的状态和角色，例如：

- `status=in_progress`
- action status: `running`、`changes_requested`、`ready_for_commit`、`completed_blocked_required_frontend_verification`
- role: `Dev Backend`、`Dev Frontend`、`dev-backend-remediation`、`dev-frontend-verification`、`qa-revalidation`、`reviewer-revalidation`
- `agent_runs` 里存在重复 id，并且 `dev-backend`、`dev-frontend` 没有匹配 action

**影响**

- runtime 无法通过 session validation。
- `dispatch-contracts.json` 被清空为 0 contracts。
- `agent-name-map.json` mappings 为 0。
- 后续 provider receipts、quality lineage、final gates 都无法形成闭环。

**处理方案**

- 将领域细分角色放到 `id`、`taskId`、`reason`、`metadata` 或 task title 中，不要放进 `role`。
- role 统一映射为 runtime 支持角色：
  - `Dev Backend` -> `dev`
  - `Dev Frontend` -> `dev`
  - `dev-backend-remediation` -> `dev`
  - `dev-frontend-verification` -> `dev` 或 `qa`
  - `qa-revalidation` -> `qa`
  - `reviewer-revalidation` -> `reviewer`
- action status 统一映射为 runtime 支持状态：
  - 已完成 -> `done`
  - 等模型/Agent 输出 -> `ready` 或 `waiting`
  - 阻塞 -> `blocked`
- 去掉重复 `agent_runs[].id`，确保每个 agent run 能和一个 action 对应。
- 修复后重新运行 runtime ingest/status/reconcile，让 dispatch contracts 和 queue 从合法 session 派生。

## 3. provider receipts 仍为 0，provider capability 仍 blocked

**问题**

当前 `orchestration/provider-receipts/` 没有 provider-origin completed receipt，`provider-capability.json` 仍显示：

- `provider=unknown`
- `subagent_supported=unknown`
- `blocked=true`
- `resolved_receipt_count=0`

**影响**

- runtime 无法证明这些 handoff 是由当前 provider 的原生子 Agent 完成的。
- true harness evidence 不能通过。
- blocker-summary 仍保留 provider capability blocker。

**处理方案**

- 对每个已完成的 native Agent，记录 provider-origin completion receipt。
- receipt 需要包含真实 provider、provider agent id、session id、task handle/trace id、output path 和完整性摘要。
- receipt 记录后重新生成 provider capability resolution，允许 `resolved_by_receipts=true`。

## 4. quality-lineage 覆盖率仍为 0/11

**问题**

`quality-lineage.json` 已正确不再误报 pass，但当前结果是：

- QA: `blocked`, coverage `0/11`
- Review: `blocked`, coverage `0/11`
- Recheck loop: `blocked`

task graph 中有 11 个 expected task，但 QA/Reviewer lineages 没有按 task 进入 runtime 认可的 lineage。

**影响**

- final gates 不能通过。
- demo 虽然有 `qa-revalidation`、`reviewer-revalidation` handoff，但 runtime 不能把它们映射成 11 个 task 的 QA/Review 证据链。

**处理方案**

- QA 和 Reviewer handoff 需要使用 runtime 支持的 `role=qa` / `role=reviewer`。
- 每个 required task 都需要可追踪的 QA/Review coverage，至少要明确覆盖关系：
  - 单个 QA run 覆盖全部任务时，要在 runtime 可解析字段中列出 covered task ids。
  - 或者为每个 task 输出独立 QA/Reviewer handoff。
- 修复 quality-lineage 读取聚合型 QA/Review handoff 的能力，或调整 demo 输出为逐 task handoff。

## 5. final gates 和 final report 仍未形成 runtime 闭环

**问题**

当前存在 run 根目录下的 `final-gates.json`，但它是 committer 风格的 `ready_for_commit` 文件，不是 runtime final gates。runtime 期望的 `orchestration/final-gates.json` 不存在。

同时：

- `.imfine/reports` 只有 `.gitkeep`
- run 内缺少 `archive/final-report.md`
- run 内只有 `archive/summary.md`

**影响**

- 用户仍看不到 runtime 生成的最终交付报告。
- status/reconcile 无法以 runtime final gates 判断 completed。
- true harness 的最终可信证据没有落地。

**处理方案**

- 不要让 Agent 手写 runtime final gates。
- Agent 可写 acceptance/final readiness evidence，但最终 `orchestration/final-gates.json` 必须由 runtime reconcile 生成。
- runtime reconcile 成功或 blocked 后必须生成：
  - `.imfine/runs/<run-id>/archive/final-report.md`
  - `.imfine/reports/<run-id>.md`
  - `.imfine/runs/<run-id>/orchestration/final-gates.json`

## 6. blocker-summary 仍有大量 current blockers

**问题**

`blocker-summary.json` 当前仍为 `blocked`，共 35 个 blocker，主要来自：

- provider capability 未确认
- session-validation schema 错误

**影响**

- 这不是旧 blocker 没清理，而是当前事实仍然 blocked。
- 默认输出如果展示 blocker，会继续显得“系统没有收敛”。

**处理方案**

- 优先修复 session schema。
- 记录 provider-origin receipts。
- 重新运行 status/reconcile，让 blocker-summary 从最新事实重算。
- 如果修复后仍有 blocker，应只保留唯一当前阻塞原因。

## 7. dispatch contracts 和 agent-name-map 为 0

**问题**

当前：

- `dispatch-contracts.json` contracts 为 0
- `agent-name-map.json` mappings 为 0
- `orchestrator-runtime-consistency.json` 显示 pass，但只是因为 session action count 和 dispatch count 都为 0

**影响**

- runtime 没有真实 action ledger。
- queue 清空不是因为所有 action 被正确完成，而是因为非法 session 没法 materialize。
- demo 可能误导为“没有 ready action”，但实际是“没有合法 action”。

**处理方案**

- 修复 `orchestrator-session.json` 后重新 ingest。
- 增加检查：如果 handoff 存在但 dispatch contracts 为 0，需要输出“session schema invalid / dispatch not materialized”，而不是单纯 pass。
- 对 `orchestrator-runtime-consistency` 增加 session-validation blocked 的关联判断。

## 8. Agent handoff 使用了非 runtime 角色和非标准状态

**问题**

当前 handoff 中存在：

- `role=dev-backend`
- `role=dev-frontend`
- `role=qa-revalidation`
- `role=reviewer-revalidation`
- `status=archive_created_runtime_evidence_blocked`
- `status=completed_verification_blocked_by_missing_local_dependencies`
- `status=ready_for_commit`

**影响**

- 业务语义很清楚，但 runtime 无法用标准 role/status 计算 gates。
- quality-lineage、role-purity、dispatch-contracts 都无法稳定关联。

**处理方案**

- Handoff role/status 也要遵守 runtime schema。
- 业务细分放到 `summary`、`evidence`、`finding_ids`、`covered_task_ids`、`metadata`。
- status 保持标准值，复杂状态拆成：
  - `status=completed` / `pass` / `approved` / `blocked`
  - 细节写入 `summary`、`findings`、`residual_risks`

## 9. `.gitignore` 和构建产物污染问题已改善

**问题**

此前 `.gitignore` 缺少 `backend/target/`。当前 demo1 已包含：

```gitignore
backend/target/
backend/db/*.sqlite3
frontend/node_modules/
frontend/dist/
*.tsbuildinfo
```

**影响**

构建产物污染问题已明显改善。

**处理方案**

- 保持当前 `.gitignore`。
- 后续 archive summary 中继续区分 source changes 与 generated artifacts。
- commit gate 只纳入源码、测试、文档和必要 runtime evidence。

## 10. 默认输出仍会暴露“看起来完成但 runtime 不认”的矛盾

**问题**

截图输出中大量 Agent 叙述显示功能已完成、QA/Review 已复验、final gates ready。但 runtime 数据显示 provider receipts=0、quality coverage=0/11、final report missing。

**影响**

- 用户会看到“Agent 说完成”和“runtime blocked”并存。
- demo 可信度仍不足。

**处理方案**

- 默认 demo 输出增加一条高优先级诊断：

```text
Runtime contract:
- orchestrator session: invalid
- dispatch contracts: 0
- provider receipts: 0
- quality coverage: QA 0/11, Review 0/11
- final report: missing

Next:
- normalize orchestrator-session roles/statuses to runtime schema
```

- 当 session-validation blocked 时，默认输出优先显示 schema 错误摘要，而不是继续展示后续 Agent 完成叙事。

## 总体结论

这次 demo1 相比之前有改善：

- current run 不再混乱。
- `.gitignore` 已修复。
- queue ready 噪声消失。

但 true harness 闭环仍未完成：

- session schema invalid。
- provider receipts 缺失。
- quality lineage 0/11。
- runtime final gates 缺失。
- final report 缺失。
- blocker-summary 仍 blocked。

优先级最高的修复是：让 Orchestrator 和 Agent 输出遵守 runtime schema，随后补 provider receipts，再让 runtime reconcile 生成 final gates 和用户报告。

## 修复状态

已完成。

本轮修复已落地：

- Orchestrator session 会归一化 demo1 中的别名角色与非标准状态，例如 `Dev Backend`、`Dev Frontend`、`qa-revalidation`、`reviewer-revalidation`、`in_progress`、`approved_with_risks`。
- 重复 `agent_runs.id` 会在 ingest 时自动去重，避免 session schema validation 被重复 id 卡死。
- `session-validation.json` 与 `handoff-validation.json` 在校验通过时会写回 `pass`，避免历史 blocked 文件继续污染 blocker-summary。
- Handoff validation 支持语义完整但字段不完全符合 runtime schema 的 agent 输出，同时保留对残缺 handoff 的严格阻断。
- QA/Reviewer quality lineage 支持“全量 revalidation 覆盖所有 task graph 任务”的聚合 handoff，不再误报 `0/11`。
- True harness evidence 会采集缺少 `from` 但带有 `role` 的 handoff，证据链不再漏掉 revalidation agent。
- Runtime 不会伪造 provider receipt；如果真实 provider-origin receipt 仍缺失，会继续作为真实 blocker 保留。

验证：

- `npm run build`
- `node test/smoke.mjs`
- `node test/reconcile.mjs`
- `node test/implementation-optimization.mjs`
- `node test/demo-replay.mjs`
