# IMFINE 当前实现说明

本文档只描述当前仓库中已经落地并生效的 IMFINE 实现，不包含分阶段路线图、远期目标或理想态承诺。

## 1. 文档目标

IMFINE 当前是一个项目级自主交付 harness。它提供统一的运行入口、受约束的安装形态、基于 provider capability 的 true harness gate，以及围绕 `.imfine/` 工作空间的编排、证据、归档和恢复机制。

本文档的目标是：

- 定义当前对外可承诺的行为。
- 明确运行时和模型各自负责的边界。
- 固定当前真实存在的编排路径、阻塞条件和产物结构。
- 为后续维护提供“实现即文档”的对照基线。

## 2. 对外入口

当前公开的项目级入口只有三类：

- `/imfine init`
- `/imfine run "<request>"`
- `/imfine status`

其中：

- `init` 负责初始化 `.imfine/` 工作空间、基础模板和运行所需目录。
- `run` 是唯一的交付入口。无论新项目还是既有项目，都会先进入 orchestrator 主路径。
- `status` 负责读取当前 run、编排状态、证据和待处理信息。

仓库内仍保留若干调试和内部命令，例如 `plan`、`orchestrate`、`worktree`、`patch`、`verify`、`review`、`commit`、`push`、`archive`、`agents` 等，但这些不属于稳定对外承诺面。

## 3. 安装约束

当前安装入口是硬约束，不是建议项。

- 支持的安装形态：`npx github:<owner>/<repo> install ...`
- 不支持的安装形态：直接在本地 CLI 中调用 `imfine install ...`

CLI 中虽然仍保留 `install` 子命令实现，但它只在受控 invocation 环境中放行；非受控场景会直接拒绝执行。

该约束的目的不是简化体验，而是收紧分发语义，避免把仓库内调试命令误暴露为常规安装接口。

## 4. True Harness 前置条件

`/imfine run` 进入自动编排前，必须先通过两层 gate：

1. provider subagent capability gate
2. infrastructure gate

### 4.1 Provider capability gate

当前 true harness 只在 provider 明确声明原生 subagent 支持时继续执行。

- `supported`：允许继续
- `unknown`：阻塞
- `unsupported`：阻塞

这是一条严格语义，不存在 `unknown` 时的降级继续执行。只要不是显式 `supported`，run 就会进入 `blocked`，并产出 gate 证据。

### 4.2 Infrastructure gate

当 capability gate 通过后，运行时会执行 `doctor` 检查，包括但不限于 workspace、git 状态、必要工具、配置和当前环境约束。基础设施不满足时，run 同样会被阻塞，并记录对应的 gate 结果。

## 5. 工作空间与核心产物

IMFINE 以项目内 `.imfine/` 目录作为运行时工作空间。当前实现会围绕这个目录维护以下核心产物：

- `runs/<run-id>/run.json`
- `runs/<run-id>/planning/task-graph.json`
- `runs/<run-id>/planning/ownership-plan.json`
- `runs/<run-id>/planning/execution-plan.json`
- `runs/<run-id>/planning/commit-plan.json`
- `runs/<run-id>/planning/spec-delta/tasks.md`
- `runs/<run-id>/orchestration/state.json`
- `runs/<run-id>/orchestration/dispatch-contracts.json`
- `runs/<run-id>/orchestration/parallel-plan.json`
- `runs/<run-id>/orchestration/timeline.md`
- `runs/<run-id>/orchestration/infrastructure-gate.json`
- `runs/<run-id>/orchestration/subagent-capability-gate.json`
- `runs/<run-id>/agent-runs.json`
- `runs/<run-id>/evidence/true-harness-evidence.json`
- `runs/<run-id>/evidence/true-harness-evidence.md`
- `runs/<run-id>/evidence/subagent-capability.md`
- `.imfine/state/queue.json`
- `.imfine/archive/...`

这些文件共同承担四类职责：

- 持久化当前 run 和任务图
- 描述 orchestrator 快照与并行波次
- 固定 agent/runtime dispatch contract
- 为审计、恢复、归档和问题定位提供证据

## 6. 统一运行模型

当前实现中，`run` 的主语义不是“立即生成 deterministic 计划”，而是“创建 run 并进入统一编排主路径”。

### 6.1 Run 创建

`/imfine run "<request>"` 首先创建 delivery run，写入项目上下文、请求、模式、初始状态和 workspace 路径。

`--plan-only` 仍然走这条主路径，但它只返回当前 orchestrator snapshot，不会隐式切换到旧式 deterministic planning。

### 6.2 No task graph: 新项目路径

当 run 没有 task graph，且项目被识别为 `new_project` 时，orchestrator 会进入新项目工作流：

- 使用 `library/workflows/new-project-delivery.yaml`
- 进入 `waiting_for_model` 状态
- 创建 Architect 和 Task Planner 两段模型职责
- 在 Architect 完成前，Task Planner 处于等待
- runtime 通过 `runtime-plan` 动作等待并消费 Task Planner 的产物

这条路径的关键点是：

- 新项目规划属于模型职责，不由 deterministic runtime 直接生成
- 当前实现允许 run 停留在 `waiting_for_model`
- “进入编排主路径”与“立刻完成端到端交付”不是同义词

### 6.3 No task graph: 既有项目路径

当 run 没有 task graph，且项目不是 `new_project` 时，orchestrator 会进入既有项目 discovery/planning 路径：

- 使用 `library/workflows/existing-project-delivery.yaml`
- 初始状态为 `no_task_graph`
- 先创建 `intake`、`project-analyzer`、`product-planner`、`architect`
- 再创建 `task-planner`、`risk-reviewer`
- runtime 通过 `runtime-plan` 等待并物化 `task-planner` 输出

这意味着既有项目当前也不再在 run 创建时直接调用 deterministic `planRun()` 作为主路径，而是先走模型主导的 discovery 和 planning。

## 7. 模型职责与运行时职责

当前实现明确区分“模型生成什么”与“运行时负责什么”。

### 7.1 模型职责

模型负责生成或补全高层规划语义，包括：

- 新项目和既有项目的任务拆解
- task graph 候选结果
- 风险识别和设计调整建议
- fix loop 中的设计更新、冲突收敛和重规划语义

### 7.2 运行时职责

运行时不负责替代模型做高层规划。运行时负责：

- gate 检查和状态迁移
- 消费并校验模型产物
- 将 `planning/task-graph.json` 物化为可执行计划文件
- 管理 dispatch contract、并行波次、agent 队列和 runtime action
- 执行 worktree、patch、验证、commit、push、archive 等确定性动作

### 7.3 Model plan materialization

当前 runtime action `runtime-plan` 调用的是模型计划物化逻辑，而不是旧的 deterministic 规划主路径。

具体来说：

- `task-planner` 写出 `planning/task-graph.json`
- 运行时校验该图是否合法
- 校验通过后生成 `ownership-plan.json`、`execution-plan.json`、`commit-plan.json`、任务级文档和 `spec-delta/tasks.md`

仓库中仍保留 `planRun()`，但它已经退化为调试/测试辅助能力，不再是 `/imfine run` 的主路径实现。

## 8. Active Delivery 路径

当 task graph 已存在且可执行时，orchestrator 会进入 active delivery 路径，按依赖和波次调度 agent 与 runtime 动作。

当前实现中的主要阶段包括：

- worktree 准备
- 开发执行
- 文档补充
- QA
- reviewer
- risk-reviewer
- commit
- push
- archive

其中：

- agent dispatch 会基于 `parallel_group` 和依赖关系分批推进
- runtime 会记录每个波次的 dispatch 和完成情况
- worktree、依赖安装、commit、push、archive 等属于 runtime action
- dev、technical-writer、qa、reviewer、risk-reviewer、committer 等属于 agent 角色协同

## 9. Fix Loop 与恢复

当前 orchestrator 已支持几类显式 fix-loop 状态：

- `needs_design_update`
- `needs_conflict_resolution`
- `needs_task_replan`

这些状态不是单纯的注释语义，而是编排器识别的恢复入口。进入这些状态后，运行时会切换到对应的模型/运行时配合流程，而不是简单重跑整条主链路。

同时，run 的状态、dispatch contract、并行计划、agent 执行记录和 evidence 文件都持久化在 `.imfine/` 下，用于：

- 断点恢复
- 失败后的证据追踪
- rerun / resume
- archive 前的审计

## 10. Legacy Bridge 的当前定位

仓库中仍保留 legacy 风格的子能力和若干单步命令，但当前定位已经收缩为：

- 调试用途
- 内部实现复用
- `legacy_debug` 兼容桥

这些能力不再定义对外产品形态，也不应反向主导 `run` 的用户语义。当前对外默认行为以 orchestrator 主路径为准。

## 11. 当前非目标

以下内容不属于当前实现可承诺范围：

- 不承诺新项目在一次 `/imfine run` 中必然自动完成从产品分析到 push/archive 的全链路交付
- 不承诺在 provider capability 为 `unknown` 时自动降级为 true harness 执行
- 不承诺 deterministic runtime 替代模型完成新项目规划
- 不承诺所有仓库内子命令都属于稳定公开接口

换句话说，当前实现承诺的是“统一 orchestrator 主路径 + 严格 gate + 模型规划物化 + 可恢复证据链”，而不是“无条件端到端一次完成”。

## 12. 实现映射

当前实现的关键代码位置如下：

- CLI 与入口约束：`src/core/cli.ts`
- run 创建与持久化：`src/core/run.ts`
- orchestrator 主逻辑：`src/core/orchestrator.ts`
- 自动编排 loop：`src/core/auto-orchestrator.ts`
- 计划校验与物化：`src/core/plan.ts`
- capability / doctor gate：`src/core/doctor.ts`
- worktree 管理：`src/core/worktree.ts`
- 质量验证：`src/core/quality.ts`
- git commit / push：`src/core/gitflow.ts`
- archive：`src/core/archive.ts`
- 工作流定义：`library/workflows/new-project-delivery.yaml`
- 工作流定义：`library/workflows/existing-project-delivery.yaml`
- 工作流定义：`library/workflows/fix-loop.yaml`

## 13. 结论

当前 IMFINE 已经从“阶段性方案设想”收敛为一套以 orchestrator 为中心的真实运行实现：

- 安装入口受控
- `run` 统一进入编排主路径
- true harness 受 provider capability 严格 gate
- 新项目和既有项目都先走模型主导规划，再由 runtime 物化和执行
- 全流程围绕 `.imfine/` 工作空间沉淀状态、证据、并行计划和归档结果

后续如果继续维护方案文档，应以本文档为当前事实基线，而不是再回到分阶段目标表述。
