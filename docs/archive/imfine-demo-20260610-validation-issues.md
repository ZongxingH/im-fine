# imfine-demo 2026-06-10 验证输出问题与处理方案

本文基于 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo` 的最新验证输出整理。当前 run 为 `20260610-搭建生鲜进销存管理系统-包含供应商档案管理-商品品类与商品档案维护-采购入库单据-销售开单出库-`。

结论：这次 demo 相比旧的 `imfine-demo1` 有进步，角色和状态已经基本进入 runtime 可识别范围，但还没有真正闭环。当前主要问题是 `orchestrator-session.json` 中的 `imfine-*` skill id 不被 runtime skill registry 识别，导致 session validation blocked，后续 dispatch、provider receipts、quality lineage、true harness 和 final report 都无法成立。

## 1. session validation 因 unknown skill 被阻断

**问题**

`orchestration/session-validation.json` 当前状态为 `blocked`，共有 13 个错误，全部来自 `agent_runs[].skills` 中的未知 skill：

- `imfine-product-planning`
- `imfine-architecture`
- `imfine-task-planning`
- `imfine-dev`
- `imfine-qa`
- `imfine-review`
- `imfine-risk-review`
- `imfine-merge`
- `imfine-technical-writing`
- `imfine-project-knowledge`
- `imfine-commit`
- `imfine-archive`

这些值表达了 imfine 领域语义，但当前 runtime skill registry 不认识它们。

**影响**

- session validation 无法通过。
- `dispatch-contracts.json` 无法物化，contracts 为 0。
- `queue.json` 中 actions 和 contracts 都为 0。
- `agent-runs.json` 无法生成有效 agents 和 execution units。
- 后续 true harness、quality lineage、final gates 都只能进入 blocked 或空状态。

**处理方案**

- 在 runtime skill registry 中增加 `imfine-*` skill alias，映射到当前已支持的标准 skill。
- 或调整 Orchestrator 模板，不再输出 `imfine-*` skill id，直接输出 registry 已注册的 skill id。
- 建议采用 alias 兼容方案，避免已生成的 demo/session 数据全部失效。
- 修复后重新运行 session validation 和 dispatch materialization，确认 contracts 不再为 0。

## 2. dispatch contracts 和 queue 没有物化

**问题**

当前 runtime 产物显示：

- `orchestration/dispatch-contracts.json` contracts 为 0。
- `orchestration/queue.json` actions 为 0，contracts 为 0。
- `true-harness-evidence.json` 中 handoff validation 的 `required_agent_count` 为 0。

但 run 下实际存在 17 个 Agent handoff 文件，说明会话层确实产出了多 Agent 结果，只是 runtime 没有把它们接入 dispatch 证据链。

**影响**

- runtime 无法证明这些 handoff 是由合法 dispatch action 触发。
- 后续 provider receipt、parallel execution、quality lineage 都没有可关联的 action id。
- demo 输出容易表现为“Agent 都跑了，但 runtime 什么都没接住”。

**处理方案**

- 先修复 session skill schema，使 runtime 可以从 `orchestrator-session.json` 正常物化 dispatch contracts。
- materialize 后，每个 planned agent action 都应生成稳定的 action id、role、skill、expected output path。
- 增加诊断：当 handoff 文件存在但 dispatch contracts 为 0 时，明确输出 `session schema invalid / dispatch not materialized`，不要只显示空 queue。

## 3. provider-origin receipts 缺失

**问题**

当前没有可用的 `orchestration/provider-receipts/` 证据目录或 completed receipt。`provider-capability.json` 显示：

- `provider=unknown`
- `subagent_supported=unknown`
- `blocked=true`
- `resolved_by_receipts=false`
- `resolved_receipt_count=0`

**影响**

- runtime 无法确认 Agent handoff 来自当前环境的原生子 Agent。
- `true-harness-evidence.json` 中 `true_harness_passed=false`。
- provider capability blocker 仍是当前真实 blocker，不是历史噪声。

**处理方案**

- 每个原生 Agent 完成后必须调用 runtime 的 agent completion 记录能力，写入 provider-origin receipt。
- receipt 必须包含真实 provider、provider agent id、session id、task handle 或 trace id、output path。
- 不允许用 runtime-only 或手写占位 receipt 代替 provider-origin receipt。
- receipt 写入后重新生成 provider capability resolution，使 `resolved_by_receipts=true`。

## 4. handoff 文件存在，但字段形态仍需要 runtime 归一化

**问题**

当前 run 下存在 17 个 handoff 文件，包括 `architect`、`dev-backend`、`dev-frontend`、`qa`、`reviewer`、`merge-agent`、`committer`、`archive` 等。

部分 handoff 字段仍然偏会话叙事格式：

- `qa/handoff.json` 中 `from=qa-agent`。
- `reviewer/handoff.json` 中 `from=reviewer-agent`。
- `task-planner/handoff.json` 中 `from=task-planner-agent`。
- `dev-backend/handoff.json` 的 `task_id` 是逗号拼接字符串。
- `dev-frontend/handoff.json` 的 `task_id` 是数组。
- QA、Reviewer、recheck 类 handoff 统一使用 `status=completed`，没有表达 runtime gate 需要的 pass/approved/blocked 语义。

**影响**

- 即使 dispatch 修复后，handoff 仍可能无法稳定映射到 role、task、coverage 和 gate。
- quality lineage 不能可靠判断 QA/Review 覆盖了哪些 task。
- role purity 和 final gates 需要额外兼容逻辑才能解析这些 handoff。

**处理方案**

- handoff 的标准字段保持 runtime 可解析：
  - `from` 使用 runtime role id，例如 `qa`、`reviewer`、`task-planner`。
  - 多任务覆盖统一使用 `covered_task_ids` 数组，不要混用逗号字符串和数组形式的 `task_id`。
  - QA 结果使用 runtime 可判定字段表达 pass/blocked。
  - Review 结果使用 runtime 可判定字段表达 approved/changes_requested/blocked。
- 业务细节保留在 `summary`、`evidence`、`findings`、`residual_risks`、`metadata` 中。
- runtime 可以增加兼容读取，但 Orchestrator/Agent 模板也应输出标准 handoff。

## 5. quality-lineage 没有进入有效聚合

**问题**

当前 `orchestration/quality-lineage.json` 中 `qa`、`review`、`recheck` 均为 `null`。这说明 runtime 没有形成 QA/Review coverage 聚合。

**影响**

- 无法证明 required tasks 被 QA 和 Reviewer 覆盖。
- final gates 不能基于质量证据通过。
- 用户只能看到会话里 QA/Review 说完成了，但 runtime 证据链为空。

**处理方案**

- 先修复 session validation 和 dispatch materialization。
- QA/Reviewer handoff 必须声明 `covered_task_ids`。
- quality-lineage 聚合时按 task graph 中 required tasks 计算覆盖率。
- 如果 coverage 不是 100%，summary 必须保持 blocked，不能显示 pass。

## 6. acceptance matrix 路径和来源不被 role-purity 接收

**问题**

run 根目录存在 `acceptance-matrix.json`，并且 `required_coverage_declared_complete=true`，但 `orchestration/role-purity-audit.json` 仍显示：

- `status=blocked`
- violation: `acceptance-matrix.missing`
- expected: runtime-derived acceptance matrix from agent-authored source

说明当前 acceptance matrix 的位置、来源或派生链不符合 role-purity 审计要求。

**影响**

- role purity 无法通过。
- `true-harness-evidence.json` 中 role purity 仍为 blocked。
- 即使业务验收项存在，runtime 仍无法把它作为可信 gate 证据。

**处理方案**

- 明确 runtime 认可的 acceptance matrix 路径，例如 `orchestration/acceptance-matrix.json` 或从 Agent-authored source 派生的确定路径。
- Product/QA/Reviewer Agent 输出验收覆盖后，由 runtime reconcile 生成或复制到标准位置。
- role-purity 审计只读取标准位置，并在缺失时提示实际发现的非标准路径。

## 7. final gates 和用户报告没有形成 runtime 闭环

**问题**

当前存在 run 根目录下的 `final-gates.json`，内容显示：

- `status=pass_with_risks`
- `generated_by=merge-agent`
- `ready_for_commit=true`

但 runtime 期望的 `orchestration/final-gates.json` 不存在。同时：

- `.imfine/reports` 只有 `.gitkeep`。
- run 内只有 `archive/archive-summary.md`。
- 缺少 `archive/final-report.md`。

**影响**

- Agent 写出的 final gate 不能替代 runtime final gate。
- 用户没有最终可读报告。
- run 无法从 blocked 收敛到 completed 或明确的最终 blocked 结论。

**处理方案**

- Agent 只能提供 final readiness evidence，不直接写 runtime final gates。
- runtime reconcile 根据 session、dispatch、provider receipts、quality lineage、role purity、commit/archive policy 生成 `orchestration/final-gates.json`。
- 无论最终 completed 还是 blocked，都应生成用户可读报告：
  - `.imfine/runs/<run-id>/archive/final-report.md`
  - `.imfine/reports/<run-id>.md`

## 8. Git baseline 仍未建立

**问题**

`.gitignore` 已包含生成物忽略项：

- `backend/target/`
- `backend/db/*.sqlite3`
- `frontend/node_modules/`
- `frontend/dist/`

但 demo 工程的 `git status --short` 仍显示 `.gitignore`、`.imfine/`、`README.md`、`backend/`、`frontend/` 全部未跟踪。

**影响**

- commit/archive gate 无法区分 baseline、Agent 交付物和运行证据。
- 最终交付时容易把“整个项目初始产物”都当作未提交变更。
- 用户难以判断哪些文件是本轮 Agent 修改，哪些是 demo 初始化内容。

**处理方案**

- demo prepare 阶段创建 baseline commit，或明确记录 baseline snapshot。
- commit gate 只针对 baseline 之后的源代码、测试、文档和必要 runtime 证据做判断。
- archive 报告中区分 source changes、runtime evidence、generated artifacts。

## 9. 默认会话输出仍过长，缺少分层摘要

**问题**

截图中的会话输出包含大量 Agent 叙事、文件清单和诊断内容。虽然这次 runtime 状态已经正确保持 blocked，但用户仍需要从长输出里手动判断真正阻塞点。

**影响**

- demo 可读性差。
- 用户容易把下游 blocked 误解成多个并列问题，而不是 session schema 未过导致的连锁反应。
- true harness 主线不够清楚。

**处理方案**

- 默认输出只展示三层摘要：
  - 当前结论：blocked / completed。
  - 首要 blocker：例如 `session-validation unknown skill`。
  - 下游影响：dispatch=0、provider receipts=0、quality lineage empty、final gates missing。
- debug 模式再展开完整 Agent 叙事和文件明细。
- status 输出应区分 root cause 和 downstream symptoms。

## 修复优先级

1. 增加或修正 `imfine-*` skill alias，使 session validation 通过。
2. 重新 materialize dispatch contracts、queue 和 agent-runs。
3. 记录 provider-origin receipts。
4. 标准化 handoff 的 `from`、task coverage 和 QA/Review gate 字段。
5. 生成 runtime 可识别的 acceptance matrix。
6. 重算 quality-lineage 和 role-purity。
7. 由 runtime 生成 `orchestration/final-gates.json`、`archive/final-report.md` 和 `.imfine/reports/<run-id>.md`。
8. 建立 demo baseline commit 或 baseline snapshot。

