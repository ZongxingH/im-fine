# imfine 多角色多 Agent 并行 Loop 与过程可观测分享稿

## 1. 分享目标

这份分享文档基于 `docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md` 整理，面向需要理解或建设项目级多 Agent harness 的研发、架构、平台和 AI 工程同学。

核心观点：

- 多 Agent harness 的关键不是“多叫几个 Agent”，而是让角色、调度、执行、证据和收敛都可验证。
- imfine 适合实现多角色多 Agent 并行 loop，是因为它把高层判断交给 Orchestrator 和角色 Agent，把确定性校验、状态落盘、证据收敛交给 runtime。
- 过程可观测不是额外日志，而是一组可回放、可审计、可阻断错误完成态的结构化 artifact。

## 2. 问题背景

传统单 Agent 编码流程常见问题：

- 一个会话同时做需求分析、架构设计、编码、测试、审查和归档，角色边界不清。
- 看似完成了很多文件，但无法证明“谁做了什么、依据是什么、是否通过独立复核”。
- 并行任务容易互相覆盖，尤其是多个 Agent 同时改公共 API、schema、配置或测试入口。
- Demo 输出容易被 runtime 命令、脚本执行和 JSON 刷新淹没，用户看不到真正的 Agent 主线。
- 最终完成态常常只靠口头总结，缺少可审计的 gate 和 evidence。

imfine 的目标是把这些问题变成工程约束：

- 角色职责固定。
- 并行边界显式。
- Agent 产物和 runtime 派生证据分层。
- 每个完成结论都能追到 provider receipt、handoff、wave、gate 和 archive report。

## 3. 总体模型

imfine 的唯一运行模型是：

```text
用户需求
  -> runtime 创建 run/context
  -> 当前 provider 会话中的 Orchestrator Agent 决策
  -> Orchestrator 写出 orchestrator-session.json
  -> runtime 校验 session 并物化 dispatch/task/wave
  -> Orchestrator 按并行组启动原生子 Agent
  -> 子 Agent 产出 handoff 和 evidence
  -> runtime 记录 provider receipt 并校验证据
  -> QA/Review/Risk/Archive 形成复核闭环
  -> runtime finalize 生成 final gates、true harness evidence、report
```

这里有一个关键边界：

- Agent 负责判断：需求理解、架构选择、任务拆分、并行策略、开发、QA、Review、Archive 结论。
- runtime 负责确定性动作：状态落盘、schema 校验、dispatch contract、provider receipt、patch/git、trace、gate、archive report。

runtime 不能成为隐藏主脑。它不根据需求关键词推导产品形态，不替 Orchestrator 拆任务，不替 QA 做通过判断，也不把 runtime-only receipt 伪装成原生子 Agent 证明。

## 4. 为什么适合多角色多 Agent 并行 Loop

### 4.1 角色体系天然覆盖软件交付链路

imfine 吸收 BMAD 的多角色思想，把软件交付拆成稳定角色：

| 角色 | 主要职责 |
| --- | --- |
| Orchestrator | 唯一编排决策源，负责调度和推进状态 |
| Intake | 需求归一化和边界澄清 |
| Project Analyzer | 项目现状、模块、约束和测试入口分析 |
| Product Planner | 交付范围和验收边界定义 |
| Architect | 架构方案、任务边界和风险判断 |
| Task Planner | 任务图、ownership、执行计划、提交计划 |
| Dev | 在任务边界内实现代码 |
| QA | 验证、测试证据和通过/失败/阻塞结论 |
| Reviewer | 代码与行为审查 |
| Risk Reviewer | 风险暴露和阻塞结论 |
| Merge Agent | 合并已通过 QA/Review 的任务结果 |
| Committer | 判断是否满足提交条件 |
| Archive | 归档判断和最终交付确认 |
| Technical Writer | 文档与说明产物 |
| Project Knowledge Updater | 长期项目知识更新 |

这个角色模型适合并行的原因是：每个角色都有明确输入、输出、handoff schema 和 evidence 要求。并行不是自由发挥，而是在角色契约下执行。

### 4.2 Orchestrator 是唯一编排决策源

并行 loop 的中心不是 runtime，而是当前 provider 会话中的 Orchestrator Agent。

Orchestrator 必须写出：

```text
.imfine/runs/<run-id>/orchestration/orchestrator-session.json
```

其中必须声明：

- `decision_source=orchestrator_agent`
- `execution_mode=true_harness`
- `harness_classification=true_harness`
- `next_actions`
- `agent_runs`

这让调度决策具备明确来源。runtime 只消费这个 session，不私自推导 workflow、role、action 或并行边界。

### 4.3 并行边界显式声明

每个 action 通过两个字段表达并行关系：

- `dependsOn`：依赖哪些 action。
- `parallelGroup`：属于哪个并行组。

同一 `parallelGroup` 中状态为 `ready` 的多个 action，可以被 Orchestrator 同一波次拉起为独立原生子 Agent。

```text
Wave 01: Product Planner + Architect
Wave 02: Task Planner
Wave 03: Backend Dev + Frontend Dev + Docs Dev
Wave 04: QA + Reviewer + Risk Reviewer
Wave 05: Fix Agents + QA Recheck + Reviewer Recheck
Wave 06: Archive Agent + Runtime Finalize
```

如果 Orchestrator 没有声明安全并行边界，runtime 不会自动推导并行，而是按串行执行。

### 4.4 任务级并行优先，冲突由 scope 控制

任务图中每个 task 都必须声明：

- `read_scope`
- `write_scope`
- `depends_on`
- `acceptance`
- `dev_plan`
- `test_plan`
- `review_plan`
- `verification`

runtime 会校验：

- task id 是否重复。
- 依赖是否存在、是否成环。
- 同波次任务的 `write_scope` 是否冲突。
- patch 是否越过 task 边界。
- merge-agent 的 `merged_files` 是否越界。
- 公共 API、schema、migration、lockfile、配置等高冲突范围是否被错误并行。

这套机制让并行具备工程安全边界：不是“多个 Agent 同时改”，而是“多个 Agent 在明确 ownership 和 write scope 下并行”。

### 4.5 Fix Loop 是显式状态机

imfine 不把失败当成对话里的临时插曲，而是让失败进入状态机：

```text
QA failed
  -> needs_dev_fix
  -> Orchestrator dispatches Fix Agent
  -> QA Recheck Agent
  -> Reviewer Recheck Agent
  -> final gates
```

典型返工链路：

```text
Reviewer findings
  -> remediation plan
  -> Backend/Frontend Fix Agent
  -> QA Recheck Agent
  -> Reviewer Recheck Agent
  -> Archive or next fix loop
```

每个 blocker 都会被结构化：

- blocker id
- severity
- owner
- required evidence
- recheck action
- close condition

这样多 Agent loop 可以持续推进，而不是卡在“模型说已经修了”的不可审计状态。

## 5. 并行 Loop 的关键产物

### 5.1 编排层产物

```text
orchestration/
  orchestrator-input.md
  orchestrator-session.json
  session-validation.json
  dispatch-contracts.json
  agent-runs.json
  parallel-plan.json
  parallel-execution.json
  action-ledger.json
  queue.json
```

这些产物回答：

- Orchestrator 做了什么决策？
- 哪些 action 被派发？
- 哪些 action 属于同一个并行 wave？
- 当前 action 的有效状态是什么？
- runtime 是否接受这份编排？

### 5.2 Agent 层产物

```text
agents/<agent-id>/
  input.md
  output.md
  commands.md
  status.json
  handoff.json
  patch.diff
```

这些产物回答：

- Agent 收到了什么上下文？
- Agent 产出了什么判断或代码？
- Agent 执行了哪些命令？
- Agent 的 handoff 是否满足角色 schema？
- Agent 引用的 evidence 是否真实存在？

### 5.3 证据层产物

```text
evidence/
  test-results.md
  review.md
  risk-review.md
  commits.md
  push.md
```

这些产物回答：

- QA 证据是什么？
- Review 结论是什么？
- Risk 是否接受？
- commit/push 是否形成交付闭环？

### 5.4 归档层产物

```text
archive/
  archive-report.md
  final-report.md
  project-updates.md
  final-summary.md

reports/<run-id>.md
```

这些产物回答：

- 本次 run 最终完成了什么？
- 哪些 gate 通过，哪些 gate 阻塞？
- 哪些是 required，哪些是 negotiable、demo substitute 或 deviation？
- QA/Review 是否接受偏差？
- 交付对应哪些 commit identity？

## 6. 如何实现过程可观测

imfine 的可观测不是只看日志，而是四层结构化观察：

```text
Artifact: 事实落盘
Trace:    事件过程
Receipt:  provider 原生执行证明
Gate:     可阻断的完成判定
```

### 6.1 Artifact：所有关键事实落盘

每个 run 都有独立工作空间：

```text
.imfine/runs/<run-id>/
  request/
  analysis/
  orchestration/
  planning/
  agents/
  evidence/
  review/
  archive/
```

好处是：

- 可以恢复：run 中断后能从 artifact 继续。
- 可以审计：每个判断都有文件证据。
- 可以对比：历史 run 和当前 run 的状态可以并排检查。
- 可以回放：demo 问题可以变成 replay fixture。

### 6.2 Trace：事件级过程记录

runtime trace 写入：

```text
orchestration/run-trace.jsonl
orchestration/gate-trace.jsonl
```

每条 trace event 记录：

- `event_id`
- `parent_event_id`
- `run_id`
- `timestamp`
- `source`
- `component_id`
- `action_id`
- `event_type`
- `status`
- `reason`
- `input_artifacts`
- `output_artifacts`

这让问题定位可以从“它为什么 blocked”变成“哪个 component 在哪个 action 上，因为哪些 input artifact 产生了 blocked gate”。

### 6.3 Receipt：证明 Agent 真正由 provider 原生执行

true harness 不能只看最终文件是否存在，还要证明子 Agent 是真实启动和完成的。

每个原生子 Agent 完成后都要有 provider-origin receipt：

```text
orchestration/provider-receipts/
orchestration/provider-outputs/
```

receipt 至少记录：

- action id
- agent id / role / task id
- parallel group
- provider
- provider agent id
- provider session id
- provider task handle
- origin
- receipt type
- status
- output path
- integrity hash
- started_at / completed_at

runtime-only receipt 只能用于诊断或 gate 记录，不能证明 native subagent 完成。这样可以避免“单会话伪装多 Agent”的风险。

### 6.4 Gate：完成态必须可阻断

finalize 会统一检查：

- planning evidence
- dispatch / provider receipt / wave traceability
- QA evidence
- Review evidence
- Recheck / fix loop 状态
- Risk Review evidence
- Committer evidence
- Commit evidence
- Push outcome
- Archive evidence
- Project knowledge freshness
- Acceptance matrix
- True harness evidence

标准 gate 包括：

| Gate | 作用 |
| --- | --- |
| planning | 任务图和规划产物是否有效 |
| dispatch | action、agent run、parallel wave 是否闭合 |
| qa | QA 证据是否覆盖 required task |
| review | Reviewer 是否 approve 或给出可追踪 blocker |
| recheck_fix_loop | 修复、复测、复审是否形成 lineage |
| committer | 是否满足提交条件 |
| push | push 是否成功或有明确阻塞 |
| archive | Archive Agent 和 runtime finalize 是否闭合 |
| true_harness | 是否满足原生子 Agent 与证据链要求 |
| project_knowledge | 项目知识是否 stale |

`final-gates.json` 只是 runtime 从标准 evidence 派生出的摘要，不是事实来源。手写 final gates 不能让 blocked run 变成 completed。

## 7. 可观测输出的分层设计

imfine 的 demo 复盘暴露过一个重要问题：过多 runtime 细节会让用户误以为“脚本在主导”，而不是“Agent 在交付”。

因此展示层需要分层：

### 7.1 默认视图：讲清当前进度

默认 `status` 应该展示：

```text
Run: <run-id>
State: executing

Current wave:
- Backend Dev: completed
- Frontend Dev: running
- QA: waiting

Evidence:
- provider receipts: 3/5
- handoffs: 3/5
- role purity: pass

Blocked:
- none

Next:
- wait for Frontend Dev
- dispatch QA wave
```

### 7.2 Story 视图：适合分享和演示

`status --story` 或 `report --demo-summary` 应突出：

- 谁在工作。
- 哪个 wave 正在执行。
- 哪些 Agent 已完成。
- 当前 gate phase 是 pass 还是 blocked。
- 下一步是什么。

示例：

```text
[runtime] context materialized
[orchestrator] dispatched Backend Dev, Frontend Dev
[agent:backend-dev] completed with provider receipt
[gate:qa] blocked, 2 findings
[orchestrator] dispatched remediation wave
[gate:true-harness] pass
```

### 7.3 Debug 视图：保留完整技术细节

debug 模式可以展开：

- 内部 runtime 命令。
- JSON 写入路径。
- trace event。
- gate 计算细节。
- blocker 派生来源。

这样既能服务 demo，也能服务故障排查。

## 8. 过程可观测的关键设计原则

### 8.1 区分 Agent-authored 和 Runtime-derived

分享或报告中必须明确区分：

```text
Agent-authored:
- agents/architect/handoff.json
- agents/task-planner/handoff.json
- agents/qa/handoff.json
- agents/reviewer/handoff.json

Runtime-derived:
- dispatch-contracts.json
- provider-receipts/*.json
- parallel-execution.json
- true-harness-evidence.json
- final-gates.json
```

Agent-authored 是判断来源，Runtime-derived 是校验和收敛结果。

### 8.2 role purity 防止 Orchestrator 越权

Orchestrator 只能负责调度和决策，不能直接代替子 Agent 写规划、改代码、跑 QA 并形成最终判断。

role purity 要阻断：

- Orchestrator 直接写 `planning/task-graph.json`。
- Orchestrator 直接改 `backend/**`、`frontend/**`、`tests/**`。
- Orchestrator 自测结果替代 QA evidence。
- Reviewer blocker 后没有 rework dispatch。
- 关闭子 Agent 前没有记录 handoff 和 provider receipt。

### 8.3 Acceptance Matrix 必须来自 Agent

验收矩阵来源必须是 Agent-authored，例如：

```text
orchestration/agent-acceptance-matrix.json
agents/product-planner/acceptance-matrix.json
agents/architect/acceptance-matrix.json
agents/qa/acceptance-matrix.json
agents/reviewer/acceptance-matrix.json
```

runtime 只校验：

- schema 是否正确。
- required item 是否有 evidence。
- deviation 是否被 QA/Review 接受。
- evidence 文件是否真实存在。

这避免 runtime 根据“小程序、管理后台、数据库、前后端”等关键词自行判断产品形态。

### 8.4 Blocker 必须结构化

blocked 不能只输出一句“验证失败”。它应该沉淀为：

```text
structured-blockers.json
review/blocker-matrix.json
analysis/harness-debug-overview.md
analysis/harness-debug-detail.json
```

每个 blocker 都要有：

- owner
- severity
- evidence
- required fix
- close action
- recheck result

这样 Orchestrator 才能把 blocker 转成 `FIX-*` task，并继续下一轮 loop。

### 8.5 Harness 自身也要可演进

imfine 把 harness 的历史问题编号为 H-001 到 H-016，并绑定：

- 问题含义。
- 阻断规则。
- 覆盖组件。
- replay 测试。

例如：

| 编号 | 问题含义 | 价值 |
| --- | --- | --- |
| H-003 | 缺失 provider-origin receipt 不能通过 true harness | 防止伪多 Agent |
| H-006 | recheck pass 必须有 lineage | 防止 blocker 被口头关闭 |
| H-007 | final gates 必须由 runtime 从标准 evidence 派生 | 防止伪完成 |
| H-010 | status 必须从 runtime artifacts 派生 gate 状态 | 防止展示层误导 |
| H-016 | 非平凡 harness 修改必须记录演进证据 | 防止 harness 越改越不可证 |

这说明可观测不只服务业务 run，也服务 harness 自身的质量演进。

## 9. 一次完整交付的可观测闭环

可以用下面的链路判断一次 run 是否可信：

```text
需求输入
  -> request/input.md
  -> analysis/project-context.md
  -> orchestrator-session.json
  -> dispatch-contracts.json
  -> parallel-execution.json
  -> provider-receipts/*.json
  -> agents/*/handoff.json
  -> evidence/test-results.md
  -> evidence/review.md
  -> acceptance-matrix.json
  -> true-harness-evidence.json
  -> final-gates.json
  -> archive/final-report.md
  -> reports/<run-id>.md
```

如果其中任一关键环节缺失，run 不应该被报告为 completed。

## 10. 对外讲解时的推荐叙事

### 10.1 一句话

imfine 是一个项目级自主多 Agent harness：Agent 负责判断和协作，runtime 负责确定性校验和证据收敛，让多角色并行交付既能跑起来，也能被审计。

### 10.2 三个关键词

- 多角色：把软件交付拆成 Product、Architect、Task Planner、Dev、QA、Reviewer、Archive 等明确职责。
- 并行 loop：通过 `parallelGroup`、`dependsOn`、`write_scope` 和 provider receipt 形成可控并行。
- 可观测：通过 artifact、trace、receipt、gate、report 证明过程和结论。

### 10.3 三个对比

| 普通单 Agent 流程 | imfine true harness |
| --- | --- |
| 一个会话包办所有事 | Orchestrator 调度多个角色 Agent |
| 最终总结靠自然语言 | final gates 和 evidence 决定完成态 |
| 并行靠模型自觉 | `parallelGroup`、`dependsOn`、`write_scope` 约束 |
| 测试/审查可能被同一会话代替 | QA/Reviewer 必须有独立 handoff 和 evidence |
| 日志多但不可审计 | artifact、trace、receipt、gate 可追溯 |

### 10.4 一个 Demo 讲法

1. 输入需求，runtime 只创建上下文，不做业务判断。
2. Orchestrator 读取上下文，写出 `orchestrator-session.json`。
3. 第一波并行启动 Product Planner 和 Architect。
4. Task Planner 产出任务图和 ownership。
5. 多个 Dev Agent 按 `write_scope` 并行实现。
6. QA、Reviewer、Risk Reviewer 独立复核。
7. 如果发现 blocker，生成 fix loop，并派发 Fix Agent、QA Recheck、Reviewer Recheck。
8. Archive Agent 产出归档判断。
9. runtime finalize 校验 receipt、handoff、evidence、acceptance matrix、final gates。
10. 生成用户可读 report 和 true harness evidence。

## 11. 落地建议

如果团队要实现类似能力，可以按四个阶段推进：

### 阶段一：先做角色和 handoff

- 定义角色清单。
- 定义每个角色的输入、输出和 handoff schema。
- 明确哪些产物必须由 Agent-authored，哪些只能由 runtime-derived。

### 阶段二：再做 task graph 和并行控制

- 引入 `dependsOn` 和 `parallelGroup`。
- 引入 `read_scope` 和 `write_scope`。
- 校验同波次写冲突。
- 把 patch、merge、QA、Review 都纳入 task 边界。

### 阶段三：补齐 receipt、trace 和 gate

- 每个子 Agent 完成后记录 provider-origin receipt。
- 每个 runtime 关键动作写 trace。
- 每个 gate 都能指出 input artifact、output artifact 和 blocked reason。
- final gates 从标准 evidence 派生。

### 阶段四：优化展示和演进

- 默认 status 展示人能理解的进度。
- story/demo 视图突出 Agent 主线。
- debug 视图保留完整 runtime 细节。
- 把历史问题变成 replay 测试和 harness evolution record。

## 12. 总结

imfine 的价值不只是“让多个 Agent 干活”，而是把多 Agent 协作变成可工程化的交付系统。

它适合多角色多 Agent 并行 loop，因为：

- Orchestrator 是唯一编排决策源。
- 角色 Agent 有清晰职责和 handoff。
- 并行由 `parallelGroup`、`dependsOn` 和 scope 显式控制。
- QA、Review、Risk、Archive 形成闭环。
- failure 和 rework 进入状态机，而不是停留在对话里。

它能实现过程可观测，因为：

- run 中所有关键事实都有 artifact。
- runtime 事件有 trace。
- 原生子 Agent 完成有 provider receipt。
- 完成态由 gate 决定。
- 最终交付有 report 和 true harness evidence。

一句话收束：imfine 把“多 Agent 协作”从演示效果推进到工程事实，让每个角色、每次并行、每个阻塞、每个完成结论都能被追踪、验证和复盘。
