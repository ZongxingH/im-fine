# imfine-demo1 Harness Gap Tasks

本文基于 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo1` 的实际落地结果、用户提供的多 Agent 截图旁证，以及 `IMFINE_PHASED_IMPLEMENTATION_PLAN.md` 中定义的 harness 工程边界整理。

结论：demo1 能说明模型侧很可能在当前 Codex/Claude 会话中真实启动过多个子 Agent，但当前 imfine 没有把这些由会话 Orchestrator 原生调度的子 Agent 的调度、完成、输出、handoff、receipt、gate 和归档收敛成 runtime 可审计证据。因此，demo1 不能被判定为 completed true harness run。

## 0. 现状判定

### 0.1 能证明的事实

- 截图显示当前会话曾关闭多个智能体线程，例如 `Copernicus`、`Beauvoir`、`Hegel`、`Carson`、`Tesla`、`Rawls`、`Socrates`、`Poincare`、`Faraday`。
- `orchestrator-session.json` 中记录了 10 个 `agent_runs`，包括 Architect、Task Planner、Backend Dev、Frontend Dev、QA、Reviewer、Committer、Technical Writer、Project Knowledge Updater、Archive。
- demo 业务代码存在，且 `npm test` 通过 10 个后端 API 测试。

### 0.2 不能证明的事实

- 不能证明每个截图中的 Agent 与 imfine action id 一一对应。
- 不能证明这些 Agent 的输出被 runtime 原子接收。
- 不能证明当前会话拿到了可绑定 action id 的 provider agent metadata、provider output snapshot 和 integrity。
- 不能证明 dispatch contract、parallel execution wave、standard handoff、final gates 已闭合。
- 不能证明 run 完成了 commit、push、archive finalize。

### 0.3 demo1 落盘证据

- `run.json.status = waiting_for_agent_output`
- `orchestration/state.json.status = waiting_for_agent_output`
- `orchestration/orchestrator-session.json.status = completed`
- `orchestration/agent-runs.json.agents = []`
- `orchestration/dispatch-contracts.json.contracts = []`
- `orchestration/parallel-execution.json.wave_history = []`
- `orchestration/provider-capability.json.provider = unknown`
- `orchestration/provider-capability.json.subagent_supported = unknown`
- `orchestration/true-harness-evidence.json.true_harness_passed = false`
- `status` 显示 QA / Review / Committer / Push / Archive missing，true_harness blocked
- git 当前没有提交，业务文件仍为 untracked
- `archive/final-report.md` 明确写出没有实际 commit 和 push

## 1. 总体差距

按业务 demo 交付看，demo1 大约完成 60%-70%。

按 harness 工程定义看，demo1 大约完成 30%-40%。主要缺口不是“有没有写出业务代码”，而是“imfine 能不能用 runtime 证据证明这是一次完整的多 Agent true harness 交付”。

## 2. 实施原则

- imfine 只在 Codex / Claude 当前会话中使用；runtime/CLI 不负责也不允许去拉起 Codex 或 Claude 的 Agent。
- Codex 和 Claude 当前会话 provider 涉及的记录、校验、handoff、receipt 能力必须同时实现、同时测试；不存在只实现 Codex 或只实现 Claude 的半截任务。
- 截图、聊天记录、模型口头总结只能作为辅助旁证，不能替代 provider-origin receipt。
- runtime 不能从截图或模型文本中倒推 true harness 通过。
- 原生子 Agent 的启动只能由当前 Codex/Claude 会话 Orchestrator 完成；runtime 只负责记录 Orchestrator 回填的调度事实、校验输出和收敛证据。
- 如果 provider 无法提供足够可验证的子 Agent 元数据，run 必须保留 `true_harness_passed=false`，同时输出清晰 blocker。
- `orchestrator-session.json` 自称 completed 不能直接推动 run completed；必须经过 runtime ingest、receipt、handoff、gate 和 finalize。

## 3. P0 任务

### P0-1 当前会话原生子 Agent 证据回填

问题：
当前截图能说明 UI 层关闭过多个智能体，但当前会话 Orchestrator 没有把这些原生 Agent 的 id、session/trace metadata、输出快照和完成状态按 imfine action id 回填给 runtime。runtime 也不应该自己通过 CLI 或 provider API 去拉起这些 Agent。

demo1 证据：

- 截图显示多个智能体已关闭
- `orchestration/agent-runs.json` 为空
- `orchestration/provider-receipts/` 不存在
- `provider-capability-resolution.json.resolved_by_receipts = false`

解决方案：

- 为 Codex 和 Claude 同时定义当前会话原生 Agent evidence handback 协议。
- Orchestrator 每次在当前 Codex/Claude 会话中启动原生子 Agent 时必须记录：
  - action id
  - role
  - provider
  - provider agent id
  - provider session id
  - provider task handle 或 provider trace id；如果当前 provider UI 不暴露该字段，必须显式记录为 unavailable
  - declared output path
  - started_at
- 子 Agent 完成后，Orchestrator 必须调用 runtime 的 `agent complete --provider` 记录 provider-origin completed receipt；该命令只记录和校验证据，不负责拉起 Agent。
- receipt 必须绑定 provider output snapshot，并写入 sha256 integrity。
- 如果 provider 只能显示截图、不能暴露可验证 metadata，则写入 `unverifiable_provider_observation`，但不能让 true harness 通过。

验收标准：

- Codex 和 Claude demo 都能生成 `orchestration/provider-receipts/*.json`。
- 每个 required action 都有 provider-origin completed receipt。
- receipt 缺 provider metadata、output snapshot 或 integrity 时 true harness 必须失败。
- 截图类证据最多进入辅助 evidence，不计入 native subagent proof。

### P0-2 Orchestrator Session Ingest 与状态一致性

问题：
demo1 中 `orchestrator-session.json` 自称 completed，但 runtime `run.json` 仍是 `waiting_for_agent_output`。这说明 Orchestrator 输出没有被 runtime 正式 ingest，也没有形成权威状态。

demo1 证据：

- `orchestration/orchestrator-session.json.status = completed`
- `run.json.status = waiting_for_agent_output`
- `state.json.status = waiting_for_agent_output`
- `status.currentRunConsistency = consistent`，但实际存在明显 session/runtime 分裂

解决方案：

- 增加 orchestrator session ingest 步骤：
  - 校验 session schema
  - 校验 `decision_source=orchestrator_agent`
  - 校验 `execution_mode=true_harness`
  - 校验 `harness_classification=true_harness`
  - 将 `next_actions` 物化为 dispatch contracts
  - 将可验证的 `agent_runs` 与 provider receipts 关联
- 如果 session 自称 completed 但 runtime gates 未闭合，run 必须进入 `blocked` 或 `waiting_for_agent_output`，并输出明确 blocker：`orchestrator_session_unadopted`。
- `status` 必须识别 session/runtime 状态分裂，不能显示为普通 consistent。

验收标准：

- demo1 这种 session completed + run waiting 的组合必须显示 `currentRunConsistency=inconsistent` 或明确 blocker。
- 没有 dispatch contracts / provider receipts 时，session completed 不能推动 run completed。
- ingest 后的 dispatch contracts、agent runs、parallel execution 必须能反查到 session action。

### P0-3 禁止 Runtime/CLI 拉起 Provider Agent

问题：
imfine 的使用场景只存在于 Codex / Claude 当前会话。若后续实现把 runtime 或 CLI 做成“调用 Codex/Claude Agent 的启动器”，就会偏离 harness 定义，也会制造无法被当前会话监管的第二套编排路径。

demo1 证据：

- 多 Agent 事实来自当前会话 UI 中的智能体线程，而不是 runtime CLI。
- runtime 当前没有 provider API 调度能力，也不应补成这种能力。

解决方案：

- 在 README、Codex skill、Claude command、orchestrator agent 文档和 runtime boundary 文档中明确：
  - `/imfine` 只在 Codex/Claude 会话内使用
  - 当前会话 Orchestrator 是唯一允许启动原生子 Agent 的主体
  - runtime/CLI 只负责 init、状态落盘、schema/evidence 校验、receipt 记录、git、archive/finalize 等确定性动作
  - runtime/CLI 不提供 `launch codex agent`、`launch claude agent`、`spawn provider agent` 之类能力
- 为 internal command 增加守护测试，确保不会新增面向 provider agent 启动的 CLI 入口。
- 如果未来 provider 提供官方会话内 metadata，Orchestrator 可以回填这些 metadata；但启动动作仍发生在当前会话层，不迁移到 runtime。

验收标准：

- `rg` 检查不存在 runtime/CLI provider agent launch 命令。
- README、Codex skill、Claude command 都明确用户入口只有 `/imfine init/run/status`。
- Orchestrator 文档明确“launch native subagent”是当前会话动作，runtime 只记录回填证据。
- 测试覆盖：任何新增 internal command 如果声明会拉起 Codex/Claude Agent，必须失败。

### P0-4 Dispatch Contract 和 Wave History 强制闭环

问题：
当前 `orchestrator-session.json` 里有 10 个 agent run，但 runtime 的 dispatch contracts 和 wave history 都是空的。

demo1 证据：

- `dispatch-contracts.json.contracts = []`
- `parallel-execution.json.wave_history = []`
- `agent-runs.json.execution_units = []`

解决方案：

- Orchestrator session 中的每个 `next_action` 必须物化为 dispatch contract。
- 每个 contract 必须包含：
  - action id
  - role
  - task id 或 gate id
  - dependencies
  - parallel group
  - expected handoff path
  - expected provider receipt path
  - expected output paths
- 当前会话 Orchestrator 实际启动子 Agent 后，必须让 runtime 记录 wave started。
- 子 Agent 完成并回填 provider-origin receipt 后，runtime 写入 wave completed。
- 没有 completed wave 的 contract 不能通过 true harness。

验收标准：

- demo run 中 `next_actions.length` 与 required dispatch contracts 数量一致。
- 每个 required contract 都有 started/completed wave。
- 缺 wave 时 status 明确显示缺失 action id。

### P0-5 标准 Handoff Schema 强制执行

问题：
demo1 中存在 `handoffs/qa/qa-report.md`、`handoffs/reviewer/review-report.md`，但缺少 role registry 要求的 `agents/<role-or-action>/handoff.json`。人工报告不能绕过标准 handoff。

demo1 证据：

- 存在 `handoffs/qa/qa-report.md`
- 存在 `handoffs/reviewer/review-report.md`
- 不存在 `agents/qa-*/handoff.json`
- 不存在 `agents/reviewer-*/handoff.json`
- `true-harness-evidence.json.handoff_validation.passed = false`

解决方案：

- 所有 Agent 必须输出标准 `handoff.json`。
- Markdown 报告只能作为 handoff.evidence 引用，不能作为 handoff 本身。
- Orchestrator prompt、Codex skill、Claude command 同步强调：
  - 子 Agent 必须写 declared handoff path
  - handoff 必须包含 run_id、task_id、role、status、summary、commands、evidence、next_state 等字段
- runtime ingest 发现 markdown-only handoff 时必须阻断，并提示需要补标准 handoff。

验收标准：

- QA、Reviewer、Committer、Archive 都有标准 handoff。
- handoff 引用的 evidence 文件必须存在。
- markdown-only 报告不能让 final gates 通过。

### P0-6 True Harness Evidence Freshness

问题：
demo1 的 `true-harness-evidence.json` 生成时间早于后续 `orchestrator-session.json` 更新，导致 evidence 是 stale 的。runtime 后续 status 没有自动标记 stale。

demo1 证据：

- `true-harness-evidence.json.generated_at = 2026-05-20T06:32:49.496Z`
- `orchestrator-session.json.updated_at = 2026-05-20T07:00:34Z`
- true harness evidence 里仍显示 session missing

解决方案：

- true harness evidence 必须记录 source artifact mtimes 或 content hashes。
- `status`、`reconcile`、`finalize` 读取 evidence 时检查 freshness。
- 如果 orchestrator session、agent-runs、dispatch-contracts、provider receipts、handoff、final gates 在 evidence 之后更新，必须标记 `true_harness_evidence_stale`。
- stale evidence 不能作为 gate 通过依据。

验收标准：

- 修改 `orchestrator-session.json` 后，status 必须显示 true harness evidence stale。
- stale evidence 不能让 archive/finalize 通过。
- reconcile 能重新生成 fresh evidence。

### P0-7 Committer 和 Archive 不允许口头完成

问题：
demo1 的 Committer/Archive 只写了 commit plan 和 final report，没有真实 commit、push、runtime archive finalize，却在 session 里被标为 completed。

demo1 证据：

- git 没有任何 commit
- 业务文件仍为 untracked
- `evidence/commit-plan.md` 写明 `Actual commit performed: No`
- `archive/final-report.md` 写明 `No actual git commit was performed` 和 `No push was performed`
- 缺少 `orchestration/final-gates.json`

解决方案：

- Committer Agent 的职责是确认 commit readiness；真实 commit/push 由 runtime 执行。
- 如果用户不允许 commit/push，run 不能 completed，应进入 `ready_for_commit`、`blocked_user_approval_required` 或等价 recoverable 状态。
- Archive Agent 只能在 commit evidence、push outcome、QA/Review evidence、acceptance matrix、true harness evidence 都满足后执行。
- `runtime-archive-finalize` 必须生成 `final-gates.json`，否则 archive 不算完成。

验收标准：

- 没有 commit evidence 时，Committer/Archive action 不能 completed。
- 没有 final-gates 时，run 不能 completed。
- 用户未授权提交时，status 必须明确显示等待用户批准，而不是 completed。

### P0-8 Agent-authored Acceptance Matrix 必须进入 final gate

问题：
demo1 没有验收矩阵，无法判断需求中的数据库、小程序、管理后台、全部接口测试等是否完全满足，哪些属于 demo-substitute 或 deviation。

demo1 证据：

- 缺少 `orchestration/agent-acceptance-matrix.json`
- 缺少 `orchestration/acceptance-matrix.json`
- 业务实现使用 in-memory store，但需求写了数据库设计完整实体与关联表
- 前端小程序页面只是静态结构和语法检查，没有真实微信模拟器或 browser smoke

解决方案：

- Product Planner / Architect / QA / Reviewer 至少一个 Agent 必须写 Agent-authored acceptance matrix。
- matrix 必须覆盖：
  - 用户注册登录
  - 楼层与座位管理
  - 分时预约
  - 超时自动释放
  - 占座举报
  - 管理后台审核
  - 座位使用率统计
  - 前后端分离
  - REST API
  - 用户端小程序页面
  - 管理后台页面
  - 数据库实体与关联表
  - 全部接口单元测试
  - 前端表单校验和分页
- runtime 只校验 matrix schema、required item、evidence 文件存在性和 QA/Review 接受状态，不从关键词自行判断。

验收标准：

- 缺 acceptance matrix 时 final gate blocked。
- required deviation 未被 QA/Review 接受时 blocked。
- in-memory store、静态小程序等必须被明确标注为 passed、demo-substitute 或 deviation。

## 4. P1 任务

### P1-1 Provider UI 旁证 Artifact

问题：
截图能帮助人判断多 Agent 发生过，但当前 imfine 没有地方保存这类辅助证据，也没有说明它的证明边界。

解决方案：

- 增加 `orchestration/provider-observations/`。
- 支持保存截图路径、用户备注、观察到的 agent names、closed count、timestamp。
- 该 artifact 只能用于诊断和人工审计，不能计入 true harness proof。

验收标准：

- status 可以显示 `providerObservations.present=true`。
- true harness evidence 明确区分 `observed_native_agents` 和 `verified_native_agent_receipts`。

### P1-2 当前会话 Agent 名称到 Action ID 映射

问题：
截图里的 Agent 名称如 `Tesla`、`Rawls` 无法映射到 A1、D1、Q1、R1 等 action id。

解决方案：

- Orchestrator 在当前 Codex/Claude 会话中启动 Agent 时生成 `agent-name-map.json`。
- 每个映射包含 provider display name、action id、role、parallel group、started_at、expected output。
- provider-origin receipt 必须引用同一个 action id。

验收标准：

- 人能从截图 Agent 名称追到 `.imfine` action id。
- action id 能继续追到 dispatch contract、handoff、receipt 和 final gate。

### P1-3 Evidence Collector 统一标准路径

问题：
demo1 的 QA/Review 证据散落在根目录 `evidence/` 和 run 目录 `handoffs/` 下，runtime final gates 没有识别为标准证据。

解决方案：

- 明确标准 evidence 目录：
  - `.imfine/runs/<run-id>/evidence/test-results.md`
  - `.imfine/runs/<run-id>/evidence/review.md`
  - `.imfine/runs/<run-id>/evidence/risk-review.md`
  - `.imfine/runs/<run-id>/evidence/commits.md`
  - `.imfine/runs/<run-id>/evidence/push.md`
- 根目录业务 evidence 可以存在，但必须被 handoff 引用并复制或索引到 run-local standard evidence。
- `status` 报 missing 时必须指出它找的是哪个标准路径。

验收标准：

- 根目录 evidence 不会被误判为标准 evidence。
- 被 handoff 引用的 evidence 能被 runtime collector 收敛到标准 evidence。

### P1-4 Orchestrator 完成声明防呆

问题：
Orchestrator 可以在 runtime gates 缺失时把 session 标为 completed，造成用户误读。

解决方案：

- Orchestrator prompt 和 schema 增加 completed 前置条件：
  - all required provider receipts complete
  - all required handoffs valid
  - final gates pass
  - true harness evidence pass
  - commit/push/archive policy satisfied
- 如果任一条件不满足，session status 必须是 blocked、waiting_for_agent_output 或 awaiting_user_approval。

验收标准：

- session completed 但 final gates missing 的 fixture 必须失败。
- Orchestrator 不能用自然语言“已经完成”绕过 runtime 状态。

### P1-5 User Approval 和 Commit Policy

问题：
截图里模型因为“用户没有要求实际 git commit”而不提交。但 imfine 定义中的交付闭环需要明确 commit/push 策略，否则 completed 语义会混乱。

解决方案：

- 在 run 创建时记录 commit policy：
  - `auto_commit_allowed`
  - `commit_requires_user_approval`
  - `push_allowed`
  - `push_requires_remote`
- 如果策略要求用户批准，run 终态不能是 completed，而应是 awaiting_user_approval 或 ready_for_commit。
- README、Codex skill、Claude command 同步说明默认策略。

验收标准：

- 未提交的 run 不会被 Archive 报 completed。
- 用户选择“不提交”时，final report 明确这是未归档完成状态。

### P1-6 New Project Git 初始化和首个提交策略

问题：
demo1 是新项目，但 git 没有初始提交，业务文件全部 untracked。harness 交付时无法追踪最终代码版本。

解决方案：

- `/imfine init` 或 `/imfine run` 对新项目必须确认 git 初始化状态。
- 如果没有 commit，runtime 创建 initial baseline commit 或记录用户禁止提交的 blocker。
- 交付完成前必须至少有 implementation commit 或明确 awaiting approval。

验收标准：

- 新项目 demo 完成后 `git log` 有 implementation commit，或 status 显示 awaiting approval。
- final report 引用具体 commit hash。

### P1-7 Final Gates 对 session/runtime 分裂建模

问题：
status 当前能显示 run 未 finalized，但没有把 session completed 与 runtime waiting 的矛盾作为核心问题凸显。

解决方案：

- 增加 gate：`orchestrator_runtime_consistency`。
- 检查：
  - session.status
  - run.status
  - final-gates status
  - true-harness evidence freshness
  - agent-runs / dispatch contracts / receipts 数量
- 任何矛盾都写入 blocker summary。

验收标准：

- demo1 复盘 fixture 显示 consistency blocked。
- status 输出 nextAction 指向具体缺失证据。

## 5. P2 任务

### P2-1 demo1 Replay 回归测试

问题：
当前测试覆盖了 synthetic fixture，但缺少对 demo1 这种“截图显示多 Agent，runtime 证据空，session 自称 completed”的真实失败形态回归。

解决方案：

- 新增 demo1-minimized fixture。
- 覆盖：
  - session completed
  - agent_runs 写在 session 内
  - runtime agent-runs empty
  - dispatch empty
  - receipts missing
  - final gates missing
  - run waiting
- 断言 status、reconcile、finalize 都不能 completed。

验收标准：

- `npm test` 包含该 fixture。
- 未来不能因为 session 自称 completed 误判 true harness completed。

### P2-2 Provider Capability 诊断文档

问题：
当 provider capability 为 unknown 时，用户不知道是环境不支持、entry 未安装、还是 Orchestrator 没记录 receipt。

解决方案：

- 扩展 `docs/harness-evidence.md` 和 `docs/orchestrator-dispatch-protocol.md`。
- 增加 capability unknown 排查表：
  - provider 未识别
  - entry 未安装
  - subagent 已启动但未记录 receipt
  - receipt 缺 provider metadata
  - output snapshot 缺失
  - integrity mismatch

验收标准：

- status blocker 能链接到具体诊断文档。
- 用户能从 blocker 判断下一步该补什么。

### P2-3 Archive Report 语义降级

问题：
demo1 的 `archive/final-report.md` 写成 Final Archive Report，但内容承认未 commit/push。这种标题会误导用户。

解决方案：

- 如果 final gates 未通过，报告标题必须是 `Blocked Archive Report` 或 `Pre-Archive Report`。
- 只有 runtime archive finalize 通过后才能写 `Final Archive Report`。

验收标准：

- 没有 final gates pass 时不能生成 Final Archive Report。
- report status 与 run status 一致。

### P2-4 Product Deviation 模板

问题：
业务 demo 里常出现“内存 store 替代数据库”“静态页面替代真实小程序运行环境”这类合理 demo 取舍，但没有统一模板表达。

解决方案：

- 增加 acceptance matrix deviation 模板。
- 每个 deviation 必须包含：
  - requested
  - delivered
  - reason
  - risk
  - accepted_by
  - evidence
  - required follow-up

验收标准：

- demo-substitute 不再散落在 final report 文本中。
- runtime 能阻断未接受的 required deviation。

## 6. 完成定义

这些任务完成后，一个新的 demo run 必须满足：

- 用户截图可以作为辅助证据，但不是唯一证据。
- 原生子 Agent 仍由当前 Codex/Claude 会话 Orchestrator 启动，不由 runtime/CLI 启动。
- `agent-runs.json` 有真实 execution units。
- `dispatch-contracts.json` 有 required contracts。
- `parallel-execution.json` 有 started/completed wave history。
- 每个 required action 有 provider-origin completed receipt。
- Codex 和 Claude 会话 provider 都覆盖同一套 receipt / handoff / gate 回填流程。
- 每个 required action 有标准 handoff。
- QA / Review / Committer / Archive evidence 进入标准路径。
- acceptance matrix 明确所有 required requirement 的状态。
- true harness evidence fresh 且通过。
- final gates 通过。
- run status、session status、report status 一致。
- 如果 commit/push 未执行，run 不得显示 completed。

## 7. 建议实施顺序

1. P0-2 Orchestrator Session Ingest 与状态一致性
2. P0-4 Dispatch Contract 和 Wave History 强制闭环
3. P0-3 禁止 Runtime/CLI 拉起 Provider Agent
4. P0-1 当前会话原生子 Agent 证据回填
5. P0-5 标准 Handoff Schema 强制执行
6. P0-6 True Harness Evidence Freshness
7. P0-7 Committer 和 Archive 不允许口头完成
8. P0-8 Agent-authored Acceptance Matrix 必须进入 final gate
9. P1/P2 任务按测试覆盖和文档诊断补齐

P0 全部完成前，imfine 可以继续生成业务 demo，但不能声称已经达到 harness 工程定义上的 completed true harness。
