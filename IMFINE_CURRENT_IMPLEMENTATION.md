# IMFINE 当前实现说明

本文档只描述当前仓库中已经落地并生效的 IMFINE 实现，不包含阶段目标或历史演进表述。

## 1. 文档目标

IMFINE 当前是一套以 `orchestrator agent` 为唯一决策源的项目级自主交付 harness。

本文档的目标是：

- 定义当前对外可承诺的行为
- 固定当前唯一有效的运行模型
- 说明模型与 runtime 的职责边界
- 给维护者提供与代码一致的实现基线

## 2. 对外入口

当前公开入口只有三类：

- `/imfine init`
- `/imfine run "<request>"`
- `/imfine status`

其中：

- `init` 初始化 `.imfine/` 工作空间、模板和运行目录
- `run` 创建 run，并进入统一编排主路径
- `status` 读取当前 run、状态和报告

仓库内仍存在 `plan`、`orchestrate`、`worktree`、`patch`、`verify`、`review`、`commit`、`push`、`archive`、`agents` 等命令，但它们属于 runtime 内部动作或测试分发器，不是稳定公开接口。

## 3. 安装入口

当前安装入口只有一种：

- `npx github:<owner>/<repo> install ...`

直接本地调用 `imfine install ...` 不属于支持的安装形态。CLI 中的 `install` 只允许在受控 invocation 环境中执行。

## 4. 运行模型

### 4.1 单一执行模式

当前实现只有一种执行模式：

- `true_harness`

### 4.2 单一决策源

当前实现中，谁决定这次 run 怎么跑，答案只有一个：

- `orchestrator agent`

runtime 不再推导 workflow、role、action 或并行策略。runtime 只消费 `orchestrator agent` 写出的决策文件：

- `runs/<run-id>/orchestration/orchestrator-session.json`

这个文件必须显式声明：

- `decision_source=orchestrator_agent`
- `execution_mode=true_harness`
- `harness_classification=true_harness`

如果没有这个文件，run 会停在 `waiting_for_agent_output`，等待当前会话里的 orchestrator agent 补齐决策。

当前目标路径要求：

- `orchestrator agent` 在当前 provider 会话中直接拉起独立原生子 agent
- runtime 只负责记录、校验和执行确定性后端动作
- 没有原生子 agent 能力时，run 应进入 `blocked`，而不是静默退化成单 agent 全流程

### 4.3 Doctor 的定位

`doctor` 仍然存在，但它只是环境与工具诊断能力：

- 检查 git、工具链、依赖标记、provider 入口安装情况
- 提供当前环境事实

`doctor` 不再裁决主路径，也不派生第二套执行语义。

## 5. 工作空间与核心产物

IMFINE 以项目内 `.imfine/` 目录作为运行时工作空间。当前实现围绕这个目录维护以下核心产物：

- `runs/<run-id>/run.json`
- `runs/<run-id>/request/input.md`
- `runs/<run-id>/request/normalized.md`
- `runs/<run-id>/analysis/project-context.md`
- `runs/<run-id>/analysis/impact-analysis.md`
- `runs/<run-id>/analysis/risk-analysis.md`
- `runs/<run-id>/orchestration/context.json`
- `runs/<run-id>/orchestration/orchestrator-input.md`
- `runs/<run-id>/orchestration/orchestrator-session.json`
- `runs/<run-id>/orchestration/state.json`
- `runs/<run-id>/orchestration/queue.json`
- `runs/<run-id>/orchestration/dispatch-contracts.json`
- `runs/<run-id>/orchestration/parallel-plan.json`
- `runs/<run-id>/orchestration/parallel-execution.json`
- `runs/<run-id>/orchestration/agent-runs.json`
- `runs/<run-id>/orchestration/auto-timeline.md`
- `runs/<run-id>/orchestration/true-harness-evidence.json`
- `runs/<run-id>/orchestration/true-harness-evidence.md`
- `runs/<run-id>/planning/task-graph.json`
- `runs/<run-id>/planning/ownership.json`
- `runs/<run-id>/planning/execution-plan.md`
- `runs/<run-id>/planning/commit-plan.md`
- `runs/<run-id>/worktrees/index.json`
- `runs/<run-id>/archive/archive-report.md`
- `runs/<run-id>/archive/final-summary.md`
- `reports/<run-id>.md`

这些文件承担四类职责：

- 持久化 run 与任务图
- 固定 orchestrator agent 的显式决策
- 分离 planning 产物与 execution 证据
- 为恢复、审计、归档和问题定位提供证据链

## 6. Planning 与 Execution 的边界

当前实现明确把 planning 和 execution 分成两类产物。

### 6.1 Planning 产物

planning 产物表达“准备怎么做”：

- `planning/task-graph.json`
- `planning/ownership.json`
- `planning/execution-plan.md`
- `planning/commit-plan.md`
- `orchestration/parallel-plan.json`

其中：

- `task-graph.json` 是任务图
- `parallel-plan.json` 只描述并行规划边界

它们都不是执行证据。

### 6.2 Execution 产物

execution 产物表达“实际做了什么”：

- `orchestration/dispatch-contracts.json`
- `orchestration/agent-runs.json`
- `orchestration/parallel-execution.json`
- `orchestration/auto-timeline.md`
- `agents/**/handoff.json`
- `evidence/**`
- `archive/**`

其中：

- `parallel-execution.json` 只记录真实执行波次
- `agent-runs.json` 只记录真实 agent run
- `handoff.json` 是各 agent 的模型输出

## 7. Run 创建

`/imfine run "<request>"` 会先创建 delivery run，并生成 runtime 上下文：

- 识别项目是 `new_project` 还是 `existing_project`
- 写入 request、analysis、orchestration context
- 写入 `orchestrator-input.md`
- 把 run 状态推进到 `waiting_for_agent_output`

`--plan-only` 也走这条主路径。它只返回当前 run 的 orchestrator 快照，不会切换到另一套规划路径。

## 8. Orchestrator 主路径

当前主路径的语义是：

1. runtime 创建 run，并把上下文物化到 `.imfine/`
2. 当前会话中的 orchestrator agent 读取 `orchestrator-input.md` 和上下文文件
3. orchestrator agent 写出 `orchestrator-session.json`
4. orchestrator agent 直接使用当前环境的原生子 agent 能力拉起独立角色
5. runtime 读取这个文件并物化：
   - `dispatch-contracts.json`
   - `agent-runs.json`
   - `parallel-plan.json`
   - `state.json`
   - `queue.json`
6. auto orchestrator 只推进确定性 runtime action，并等待当前会话继续完成 agent handoff

这里的关键点是：

- runtime 不再决定 role 和 workflow
- runtime 不再决定并行边界
- runtime 不再自己推导 true harness 成立与否

## 9. 新项目与既有项目

当前实现不再把“新项目路径”和“既有项目路径”做成两套 runtime 决策树。

两者统一遵守同一模型：

- runtime 只负责创建上下文
- orchestrator agent 决定后续 actions、roles、依赖和并行组

差异体现在 orchestrator agent 产出的 `orchestrator-session.json` 内容，而不是 runtime 内部另有一套分支主脑。

## 10. 模型职责与 Runtime 职责

### 10.1 模型职责

模型负责：

- 规划任务与角色
- 决定执行顺序和并行边界
- 产出各 agent handoff
- 给出 QA / Review / Risk / Committer / Archive 等判断
- 在当前会话输出 session summary

### 10.2 Runtime 职责

runtime 负责：

- 初始化 `.imfine/` 工作空间
- 读取并校验 orchestrator session
- 物化 dispatch contract 和 agent run registry
- 准备 worktree
- 收集和校验 patch
- 记录状态迁移
- 执行 commit / push / archive 等确定性动作
- 维护 planning / execution / evidence / report 产物

runtime 不负责替代模型做高层决策，也不负责代替当前会话发起原生子 agent 调度。

当前集成模型是：

- task worktree 只用于各 task 的隔离开发
- 当前项目目录是最终集成目录
- merge-agent 在当前项目目录对应的 run 分支工作区完成任务级代码合并
- runtime 只消费 merge-agent 已声明的合并结果并执行确定性 commit / push

## 11. Active Delivery 路径

当 orchestrator agent 已经给出可执行 session 决策，并且 task graph 存在时，run 进入 active delivery 路径。

主要阶段包括：

- worktree 准备
- dev / technical-writer 执行
- QA
- reviewer
- merge-agent
- committer
- push
- technical-writer / project-knowledge-updater
- archive

执行时：

- agent dispatch 依赖 `dependsOn` 和 `parallelGroup`
- runtime 在 `parallel-execution.json` 中记录真实 wave
- runtime 以当前项目目录作为最终集成和构建目录
- QA / Review / Archive 的结果来自 handoff 校验和确定性落盘

## 12. Session Summary

所有任务总结只输出到当前会话，不写总结文档。

当前实现中：

- 每个 agent 通过自己的 handoff `summary` 提供工作总结
- orchestrator 会在当前会话中汇总这些 summary
- runtime 不会把这类总结写成 `.md` / `.json` 归档产物

## 13. Fix Loop 与恢复

当前实现支持显式 fix-loop 状态：

- `needs_design_update`
- `needs_task_replan`
- `needs_dev_fix`

这些状态不是注释，而是 run 状态机的一部分。相关证据、状态和 handoff 都会持久化在 `.imfine/` 下，用于：

- 断点恢复
- 失败追踪
- resume
- archive 前审计

## 14. Archive 与 True Harness Evidence

当前 archive 结果状态只有：

- `completed`
- `blocked`

true harness 证据文件位于：

- `orchestration/true-harness-evidence.json`
- `orchestration/true-harness-evidence.md`

它验证的是：

- orchestrator agent 是否显式声明 `true_harness`
- 是否存在真实 dispatch contract
- 是否存在真实 execution wave
- 是否存在 handoff evidence chain

true harness 不是 runtime 猜出来的，而是“显式声明 + 执行事实”共同成立。

## 15. 当前非目标

以下内容不属于当前实现的承诺范围：

- 不承诺仓库内所有子命令都属于公开接口
- 不承诺 runtime 替代 orchestrator agent 做规划
- 不承诺没有 orchestrator session 时自动继续执行
- 不承诺 planning 产物天然等同于 execution 证据

## 16. 实现映射

当前实现的关键代码位置如下：

- CLI 与入口约束：`src/core/cli.ts`
- run 创建与上下文物化：`src/core/run.ts`
- orchestrator session 读取与物化：`src/core/orchestrator.ts`
- 自动编排 loop：`src/core/auto-orchestrator.ts`
- planning 物化：`src/core/plan.ts`
- doctor：`src/core/doctor.ts`
- worktree 管理：`src/core/worktree.ts`
- 质量验证：`src/core/quality.ts`
- git commit / push：`src/core/gitflow.ts`
- archive：`src/core/archive.ts`
- session summary：`src/core/session-summary.ts`

## 17. 结论

当前 IMFINE 的实现事实可以压缩成一句话：

`/imfine run` 先由 runtime 物化 run 上下文，再由当前会话中的 orchestrator agent 明确写出唯一的 orchestration 决策，随后 runtime 只按这份决策完成 true harness 的执行、证据记录与归档。
