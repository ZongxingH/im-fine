# IMFINE Harness 优化事项

状态：全部已完成。

本文档基于 `imfine-demo` 的一次实际执行痕迹和当前 `imfine` runtime 实现，整理接下来需要优化的 harness 工程事项。

关注对象是 `imfine` harness 本体，不评价 demo 业务系统本身。

## 结论

当前实现方向正确：`imfine` 已经把职责拆成当前会话 Orchestrator、原生子 Agent、确定性 runtime 三层，并且 runtime 主要负责状态、产物、校验、patch、git、archive 等确定性动作。

但 demo 执行过程暴露出一个核心问题：会话层已经能组织多 Agent 工作，runtime 还没有稳定形成可审计、不可绕过、状态自洽的 true-harness 闭环。

目标应从“Orchestrator 主导 + runtime 辅助记录”推进到：

```text
Orchestrator 主导决策，runtime 强制校验证据链和状态推进。
```

## 主要问题

### 1. Orchestrator Session Schema 校验不足 [已完成]

现状：

- runtime 只校验 `orchestrator-session.json` 的少量顶层字段。
- demo 中的 `next_actions` 缺少当前 runtime 需要的 `kind`、`status`、`reason`、`inputs`、`outputs`、`dependsOn`、`parallelGroup` 等字段。
- runtime 接受了不可执行的 session，导致 `dispatch-contracts.json` 为空。

风险：

- session 看起来像计划，但不能被 runtime 可靠推进。
- 后续 evidence、queue、dispatch contract 都会失真。

需要做：

- 为 `orchestrator-session.json` 增加严格 schema 校验。
- 校验每个 `next_action`、`agent_run` 的必需字段、枚举值、依赖引用和 parallel group。
- 校验 `next_actions` 与 `agent_runs` 可映射。
- 校验失败时 run 进入 `blocked`，并写入明确 blocker 文件。

验收标准：

- 缺少任一必需字段时，`resume/orchestrate` 不继续物化 contracts。
- 错误信息能指出具体 path，例如 `next_actions[2].kind is required`。
- 测试覆盖 malformed session、依赖引用不存在、agent/action 不匹配。

## 2. Completed 状态没有强绑定 True Harness Evidence [已完成]

现状：

- demo 主 run 被标记为 `completed`。
- 但 `true-harness-evidence.json` 中 `true_harness_passed=false`。
- 最终状态和 evidence 之间没有硬约束。

风险：

- run 可以在证据链不成立时被标记完成。
- `status`、`archive report`、`true-harness-evidence` 互相矛盾。

需要做：

- 禁止 run 在 `true_harness_passed=false` 时进入 `completed`。
- archive 前后都刷新 true harness evidence。
- `archiveRun` 或状态机增加 final gate：completed 必须满足 true harness evidence。

验收标准：

- 如果 dispatch contracts、parallel execution wave、agent handoff 任一缺失，archive 只能 blocked。
- `run.json.status=completed` 时，`true-harness-evidence.json.true_harness_passed` 必须为 `true`。
- 增加测试覆盖 evidence false 时 completed transition 被拒绝。

## 3. Agent Handoff 没有成为不可绕过证据 [已完成]

现状：

- 截图中多个 Agent 看似执行完成。
- demo 目录下没有标准 `agents/**/handoff.json`。
- runtime 不能从文件系统证实 Architect、Task Planner、Dev、QA、Reviewer、Committer、Archive 的交接链。

风险：

- 多 Agent 工作只存在于会话叙述里。
- 后续恢复、审计、归档无法判断每个角色实际输出。

需要做：

- 为所有核心角色统一 handoff schema。
- Orchestrator 必须要求子 Agent 直接写回自己的 handoff。
- runtime 对每个 ready/done agent action 校验对应 handoff。
- handoff 需包含 role、task_id、status、summary、commands、evidence、next_state。

验收标准：

- 缺少 handoff 时对应 action 保持 `waiting_for_agent_output`。
- handoff schema 不合法时 run blocked。
- `true-harness-evidence` 能列出完整 handoff chain。

## 4. Dispatch Contracts 与 Parallel Execution 记录缺失 [已完成]

现状：

- demo 的 `dispatch-contracts.json` 为空。
- `parallel-execution.json.wave_history` 为空。
- 但截图中声称启动了多个并行/串行 Agent。

风险：

- runtime 无法证明哪些 Agent 被派发、哪些 parallel group 被执行。
- true harness 证据无法成立。

需要做：

- session 物化时必须生成 dispatch contracts。
- 每次进入等待 Agent 输出时，记录 waiting wave。
- 每次消费 Agent 输出时，记录 completed/blocked wave。
- agent run 状态变化需要同步到 `agent-runs.json`。

验收标准：

- 每个 agent action 都能在 `dispatch-contracts.json` 找到 contract。
- 每个执行批次都能在 `parallel-execution.json.wave_history` 找到记录。
- `agent-runs.json`、`dispatch-contracts.json`、`parallel-execution.json` 三者可互相追踪。

## 5. Run 创建缺少防重和 Resume 保护 [已完成]

现状：

- 截图中 Orchestrator 误把状态刷新/继续执行操作变成了新的 `run` 调用。
- runtime 创建了 `-2` duplicate run，之后又手工标记 superseded/blocked。

风险：

- 同一需求重复创建 run，污染 `.imfine/runs`。
- `status` 可能指向错误 run。
- Orchestrator 容易在长流程中混淆 `run`、`status`、`resume/orchestrate`。

需要做：

- 当存在 active current run 时，`run` 给出明确提示或需要显式 `--new`。
- 提供幂等 resume 路径，避免为了刷新状态误创建 run。
- 在 slash workflow 里明确：创建后继续同一个 run，不再调用 `run`。

验收标准：

- active run 存在时，同需求默认不创建 duplicate。
- 需要新 run 时必须显式声明。
- `status` 能清晰展示 current run、blocked duplicate、completed primary run。

## 6. Archive Gate 与实际任务粒度不匹配 [已完成]

现状：

- 当前 archive 对 task graph 中每个 task 都要求 QA、Review、Commit 等证据。
- demo 的 task graph 包含 T01-T18，其中有规划、文档、QA、Review、Commit 类任务。
- 这些任务并不都适合作为独立 dev task 接受同一套 QA/Review/Commit 检查。

风险：

- 合理的任务图会被 archive 误判 blocked。
- 或者 Orchestrator 绕过 runtime archive，改写最终状态。

需要做：

- 区分 task 类型，例如 `dev`、`docs`、`qa_gate`、`review_gate`、`delivery_gate`。
- archive checks 按 task 类型选择证据要求。
- 对 run-level QA/Review/Committer/Archive gate 单独建模，不混入每个 task。

验收标准：

- dev task 必须有 dev/QA/Review/merge 或 commit evidence。
- docs task 需要 docs handoff 和 review evidence。
- QA/Review/Committer/Archive gate 作为 run-level evidence 校验。
- demo 类新项目任务图可以被 runtime 正确 archive，而不是依赖手工 final gates。

## 7. Final Gates 不应替代标准 Evidence [已完成]

现状：

- demo 写入了 `orchestration/final-gates.json` 表示 QA、Review、Committer、Archive ready。
- 但标准 evidence 文件、handoff、parallel execution 并未齐全。

风险：

- `final-gates.json` 变成绕过 runtime 的万能通过文件。
- 归档报告不能反映真实执行链。

需要做：

- 明确 `final-gates.json` 只能作为摘要或派生视图。
- runtime gate 只信标准 handoff、status、evidence、commit/push/archive 文件。
- 如果保留 final gates，必须由 runtime 根据标准证据生成，不能由 Orchestrator 手写作为事实来源。

验收标准：

- 手写 final gates 不能让 blocked run 变 completed。
- final gates 内容能从标准 evidence 重建。

## 8. 用户公开入口和内部 CLI 边界不够硬 [已完成]

现状：

- README 和 help 声明用户入口只有 `init/run/status`。
- CLI 仍可直接执行 `orchestrate`、`review`、`archive`、`commit`、`push` 等内部命令。

风险：

- 用户或 Orchestrator 误用内部命令。
- 文档承诺和实际可调用能力不一致。

需要做：

- 增加内部命令 invocation guard。
- 只允许 slash wrapper/runtime 受控环境调用内部命令。
- 或将文档改成“CLI 暴露但不稳定”，并明确普通用户不要直接调用。

验收标准：

- 普通 CLI 调用内部命令时给出清晰错误或警告。
- 测试覆盖 public command surface。

## 9. 状态机需要吸收 Evidence Gate [已完成]

现状：

- 状态机主要校验状态迁移合法性。
- 但没有校验迁移所需证据是否存在。

风险：

- 合法状态迁移不等于真实完成。
- `completed`、`archiving`、`committing` 等状态可能缺少对应事实支撑。

需要做：

- 对关键状态增加 evidence guard。
- `committing` 需要 committer handoff。
- `archiving` 需要 QA/Review/Commit outcome。
- `completed` 需要 archive completed 和 true harness evidence pass。

验收标准：

- 关键状态迁移缺证据时被拒绝，并记录 blocker。
- 状态机测试覆盖 evidence guard。

## 10. Session Summary 与持久化 Evidence 的边界需要更清楚 [已完成]

现状：

- 当前规则要求任务总结只留在会话中，不生成额外 work-summary 文档。
- 但 demo 的大量关键信息只存在于截图/会话叙述，没有进入标准 evidence。

风险：

- 为避免生成 summary 文档，反而没有把必要事实落盘。

需要做：

- 明确区分“总结”和“证据”。
- 不写 work-summary 文档，但必须写 handoff、commands、status、evidence。
- Orchestrator 最终总结只能引用已落盘证据。

验收标准：

- 会话总结里的每个完成判断都能链接到标准 evidence。
- 没有 evidence 的结论只能标记为 assumption 或 blocked item。

## 建议优先级

### P0：先让完成状态可信 [已完成]

1. 严格校验 `orchestrator-session.json`。
2. `completed` 强绑定 `true_harness_passed=true`。
3. 缺 handoff、dispatch contract、parallel wave 时 archive blocked。
4. 禁止 `final-gates.json` 替代标准 evidence。

### P1：让 runtime 账本可恢复、可审计 [已完成]

1. 完善 agent handoff schema。
2. 同步维护 `agent-runs.json` 状态。
3. 完善 `parallel-execution.json` wave history。
4. 增加 evidence guard 到状态机。

### P2：提升操作稳定性 [已完成]

1. `run` 防重和 active run resume 提示。
2. 内部 CLI 命令 guard。
3. task 类型和 archive gate 粒度重构。
4. 更清晰的 status/report 展示。

## 推荐下一步实施顺序 [已完成]

1. 新增 `orchestrator-session` schema 和校验测试。
2. 修改 archive/completed gate，确保 evidence false 不能 completed。
3. 统一 handoff schema，补齐 QA/Reviewer/Committer/Archive 的校验路径。
4. 修复 dispatch contract 生成失败时的 blocked 行为。
5. 补 `parallel-execution` 和 `agent-runs` 状态同步。
6. 增加 `run` active-run 防重策略。
7. 用 demo 执行痕迹补一组 regression fixture，确保类似截图流程不会再出现“会话完成、证据未完成”的分裂状态。

## 最终验收场景 [已完成]

用同类新项目需求跑一轮 `/imfine run`，完成后必须同时满足：

- `run.json.status=completed`
- `orchestration/true-harness-evidence.json.true_harness_passed=true`
- `dispatch-contracts.json.contracts.length > 0`
- `parallel-execution.json.wave_history.length > 0`
- 每个参与 Agent 都有合法 `agents/**/handoff.json`
- QA、Review、Committer、Archive gate 均有标准 evidence
- `archive/archive-report.md` 与 `.imfine/reports/<run-id>.md` 引用的证据都存在
- 重新执行 `imfine status` 不创建 duplicate run
