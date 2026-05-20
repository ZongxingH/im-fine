# imfine 项目级自主多 Agent Harness 实现方案

## 1. 目标定义

imfine 当前是一套面向真实软件项目交付的项目级自主多 Agent harness。

它的唯一运行模型是：

- 当前 provider 会话中的 `orchestrator agent` 负责唯一编排决策
- runtime 负责确定性物化、校验、执行后端动作和落盘
- `.imfine/` 是唯一运行时工作空间
- `true_harness` 是唯一执行语义
- Codex 和 Claude 是同一 harness 能力面的两个 provider；涉及 provider 的能力必须同时实现、同时测试、同时文档化

用户主入口只有：

```text
/imfine init
/imfine run "<requirement>"
/imfine status
```

`/imfine run` 的固定主路径是：

```text
创建 run
  -> 物化 request / analysis / orchestration 上下文
  -> 当前会话中的 orchestrator agent 读取上下文
  -> orchestrator agent 写出 orchestrator-session.json
  -> runtime 读取并校验 orchestrator-session.json
  -> runtime 物化 planning / dispatch / execution 产物
  -> auto orchestrator 按 agent 决策推进执行
  -> archive / reconcile / finalize 写出报告、final gates、agent-authored acceptance matrix 校验结果和 true harness evidence
```

如果 `orchestrator-session.json` 尚未存在，run 会停在 `waiting_for_agent_output`，等待当前会话中的 orchestrator agent 补齐决策；runtime 不会自动退化为单 Agent 全流程。

当前实现同时适用于两类项目：

- 新项目：从需求输入开始，创建项目骨架、任务图、执行计划和交付产物
- 已有项目：从现有代码库和项目约束开始，完成需求分析、任务拆分、执行和归档

两类项目共用同一条运行模型，不存在第二套 runtime 主脑。

从 harness 工程定义看，imfine 的三层边界是硬约束：

- 方法吸收层负责吸收 OpenSpec / Superpowers / BMAD 的方法、角色、skill 和模板思想
- 模型编排层由当前 provider 会话中的 Orchestrator 和独立原生子 Agent 承担
- deterministic runtime 层只负责状态落盘、schema/evidence 校验、patch、git、archive 证据和报告

runtime 不能成为隐藏主脑：不硬编码需求判断、架构判断、任务拆分、QA / Review / Archive 结论，也不把 runtime-only receipt 伪装成 native subagent 证明。

## 2. 非目标

- 不把 imfine 做成 OpenSpec CLI 的包装器
- 不把 imfine 做成 BMAD 菜单系统
- 不要求用户安装 OpenSpec、Superpowers 或 BMAD
- 不把 `/imfine` 变成一串让用户手工串联的内部子命令
- 不让 runtime 代替 orchestrator agent 推导任务、角色或并行策略
- 不让 runtime 从需求关键词推导产品形态或业务验收标准
- 不让 planning 产物伪装成 execution 证据
- 不把任务总结落成 `.imfine` 文档产物
- 不承诺仓库内所有 runtime 子命令都是用户公开接口
- 不承诺没有 orchestrator session 时自动继续执行

## 3. 外部项目能力吸收策略

### 3.1 OpenSpec

吸收的核心思想：

- 以 run 为中心沉淀分析、设计、任务图和 spec delta
- 通过 capability / archive 维持长期项目知识
- 把规格与交付证据分开落盘

在 imfine 中的落地形态是：

```text
.imfine/runs/<run-id>/request/
.imfine/runs/<run-id>/analysis/
.imfine/runs/<run-id>/planning/
.imfine/runs/<run-id>/archive/
.imfine/project/capabilities/
```

OpenSpec 在 imfine 中是方法来源，不是运行时依赖。

### 3.2 Superpowers

吸收的核心能力：

- clarify
- project analysis
- writing plans
- executing plans
- tdd
- systematic debugging
- code review
- archive confirmation

在 imfine 中，这些能力已经沉淀为 runtime library 下的 skill 文件：

```text
library/skills/
  clarify.md
  project-analysis.md
  write-delivery-plan.md
  execute-task-plan.md
  tdd.md
  systematic-debugging.md
  parallel-agent-dispatch.md
  code-review.md
  archive-confirmation.md
```

这些 skill 服务于 agent 工作，不是用户公开命令。

### 3.3 BMAD

吸收的核心能力：

- 多角色 agent 体系
- 项目上下文与交付上下文分层
- planning / implementation / QA / review 的角色边界
- project context 和 handoff 驱动的上下文工程

在 imfine 中，这些能力已经沉淀为 runtime library 下的 agent 文件：

```text
library/agents/
  orchestrator.md
  intake.md
  project-analyzer.md
  product-planner.md
  architect.md
  task-planner.md
  dev.md
  qa.md
  reviewer.md
  risk-reviewer.md
  merge-agent.md
  committer.md
  archive.md
  technical-writer.md
  project-knowledge-updater.md
```

这些角色定义由 orchestrator agent 调度，不由用户手动选择。

## 4. 安装形态

唯一支持的安装入口是：

```bash
npx github:<owner>/<repo> install
npx github:<owner>/<repo> install --target codex
npx github:<owner>/<repo> install --target claude
npx github:<owner>/<repo> install --target all
npx github:<owner>/<repo> install --target all --lang zh
npx github:<owner>/<repo> install --target all --lang en
```

安装默认行为：

- `install` 默认等价于 `--target all --lang zh`
- `--target` 只允许 `codex|claude|all`
- `--lang` 只允许 `zh|en`

当前安装产物：

```text
Codex:
  ~/.codex/skills/imfine/SKILL.md
  ~/.imfine/runtime/

Claude:
  ~/.claude/commands/imfine.md
  ~/.imfine/runtime/
```

设计原则：

- `/imfine` 是用户入口
- runtime CLI 是内部确定性能力，不是用户主入口
- 安装入口只认 `npx github:<owner>/<repo> install ...`
- 本地直接调用 `imfine install ...` 不属于支持形态

## 5. 项目工作空间

每个项目根目录维护：

```text
.imfine/
  config.yaml
  project/
    overview.md
    product.md
    architecture.md
    tech-stack.md
    module-map.md
    conventions.md
    test-strategy.md
    infrastructure.md
    risks.md
    project-knowledge-freshness.json
    capabilities/
      <capability>/spec.md
      <capability>/trace.json
  runs/
    <run-id>/
      run.json
      request/
        input.md
        normalized.md
        source.json
      analysis/
        project-context.md
        impact-analysis.md
        risk-analysis.md
      orchestration/
        context.json
        orchestrator-input.md
        orchestrator-session.json
        orchestrator-session.normalization.json
        session-validation.json
        handoff-validation.json
        state.json
        state-blockers.json
        blocker-summary.json
        structured-blockers.json
        queue.json
        state-transitions.jsonl
        action-ledger.json
        checkpoints/
        provider-capability.json
        provider-capability-resolution.json
        provider-receipts/
        provider-outputs/
        dispatch-contracts.json
        agent-runs.json
        parallel-plan.json
        parallel-execution.json
        agent-acceptance-matrix.json
        acceptance-matrix.json
        pre-archive-harness-evidence.json
        pre-archive-harness-evidence.md
        auto-timeline.md
        final-gates.json
        method-provenance.json
        trace-index.json
        true-harness-evidence.json
        true-harness-evidence.md
      planning/
        task-graph.json
        ownership.json
        execution-plan.md
        commit-plan.md
      agents/
        <agent-id>/
          input.md
          output.md
          commands.md
          status.json
          patch.diff
          handoff.json
          execution/
            execution-status.json
      evidence/
        test-results.md
        review.md
        risk-review.md
        commits.md
        push.md
      review/
        blocker-matrix.json
      worktrees/
        index.json
      archive/
        archive-report.md
        final-report.md
        project-updates.md
        final-summary.md
  reports/
    <run-id>.md
```

这套工作空间承担四类职责：

- 固定 run、task graph 和 orchestrator 决策
- 分离 planning 产物与 execution 证据
- 支撑恢复、审计和问题定位
- 产出 archive report 与 true harness evidence

当前实现还会在 run 目录中生成 provider、dispatch、checkpoint、blocker、trace 与 pre-archive 证据，用于证明 harness 不是单会话伪装执行：

- `provider-capability.json` 记录当前 provider、entry installed、subagent support、细粒度 provider capabilities、检测来源和检测时间
- `provider-capability-resolution.json` 记录 native subagent capability 是否由 completed provider receipt 解析确认，以及可作为证明的 receipt 列表
- `provider-receipts/` 记录 agent action 对应的 provider execution receipt，包括 provider agent/session/task handle、origin、receipt type、integrity、started/completed 时间、status 和 output path
- `provider-outputs/` 保存 provider-origin completion 绑定的稳定输出快照，避免 handoff 后续被 runtime 规范化后破坏 receipt integrity
- `blocker-summary.json` 汇总 state/session/handoff/provider/final gate 阻塞来源；status 读取不再主动写入该文件
- `structured-blockers.json` 汇总 QA/Review/Risk report、state blocker 和 handoff blocked item，并驱动 `FIX-*` 任务生成
- `review/blocker-matrix.json` 把 QA、Review、Risk、final gate blocker 统一为带 severity、状态、证据、commit 和 recheck 结论的矩阵
- `agent-acceptance-matrix.json` 是 Product Planner / Architect / QA / Reviewer 等 Agent 写入的验收矩阵来源
- `acceptance-matrix.json` 是 runtime 对 Agent-authored acceptance matrix 的 schema、required item、accepted deviation 和 evidence 文件存在性校验结果；runtime 不再通过需求关键词推导产品形态
- `pre-archive-harness-evidence.*` 在 archive 前校验 orchestration、dispatch、handoff、QA、Review、Commit、Push 证据
- `method-provenance.json` 显式记录 OpenSpec / Superpowers / BMAD / imfine-specific contracts 的方法来源和 skill evidence contract
- `trace-index.json` 建立 requirement、analysis、task、handoff、QA/Review/Commit evidence 与 archived capability 的结构化关联
- `.imfine/project/project-knowledge-freshness.json` 记录 project knowledge 是否还存在 init 阶段 stale marker

## 6. 用户命令

当前公开命令只有：

- `/imfine init`
- `/imfine run "<requirement>"` 或 `/imfine run <requirement-file>`
- `/imfine status`

内部确定性命令仍然存在于代码中，例如：

- `orchestrate`
- `worktree prepare`
- `patch collect`
- `verify`
- `review`
- `commit`
- `push`
- `archive`
- `agent complete`
- `reconcile`
- `finalize`
- `agents`
- `skills`
- `templates`
- `workflows`
- `library`
- `resume`

这些命令属于 runtime 内部动作或测试分发器，不属于用户公开契约。

其中 `resume` 只返回当前 run 的只读 orchestration 快照，不负责写状态、制造 blocked 或补 runtime evidence；写入型收敛动作由 `orchestrate`、`agent complete`、`reconcile`、`finalize` 等内部动作承担。

`--plan-only` 也走 `/imfine run` 的同一条主路径：它只创建 run、物化上下文并返回当前 orchestrator 快照，不切换到另一套 planning runtime。

普通用户不需要知道 `orchestrate`、`agent complete`、`finalize` 等内部命令。它们只能由当前会话 Orchestrator protocol、runtime backend 或测试 harness 调用。

## 7. init 和基础设施检查

### 7.1 检查项

`/imfine init` 与 `doctor` 负责产出环境事实，包括：

- git 仓库状态
- 当前分支与 remote
- package manager / build 工具痕迹
- 常见测试入口
- Codex / Claude 安装入口是否存在
- 当前 provider 入口是否已安装

这些检查结果会进入：

- `run` 创建时的 analysis 产物
- `analysis/project-context.md` 中的 Doctor Summary
- orchestrator agent 可读取的 runtime context

`.imfine/config.yaml` 由 init 创建基础配置，不作为 doctor 检查结果的落盘位置。

对已有项目，`/imfine init` 不再只生成 placeholder。当前实现会基于文件证据生成 init Architect handoff，并写入：

- `.imfine/runs/init/agents/architect/input.md`
- `.imfine/runs/init/agents/architect/handoff.json`
- `.imfine/project/architecture.md`
- `.imfine/project/tech-stack.md`
- `.imfine/project/module-map.md`
- `.imfine/project/test-strategy.md`
- `.imfine/project/project-knowledge-freshness.json`

`project-knowledge-freshness.json` 会区分 `confirmed`、`partial`、`unknown` 和空项目状态。证据不足时必须显式写 `unknown`，不能把初始化占位当作确认结论。

### 7.2 缺失处理

这些检查项只提供环境事实，不裁决主路径。

如果环境存在问题：

- runtime 会把阻塞事实写入状态与 evidence
- orchestrator agent 可以据此决定进入 `blocked` 或 `needs_infrastructure_action`

`doctor` 本身不是编排裁判。

## 8. Delivery Run 生命周期

当前 run 状态机包括：

- `created`
- `infrastructure_checked`
- `project_analyzed`
- `requirement_analyzed`
- `designed`
- `orchestrating`
- `waiting_for_agent_output`
- `planned`
- `branch_prepared`
- `executing`
- `implementing`
- `integrating`
- `verifying`
- `reviewing`
- `committing`
- `pushing`
- `archiving`
- `completed`
- `blocked`
- `needs_requirement_reanalysis`
- `needs_dev_fix`
- `needs_design_update`
- `needs_task_replan`
- `needs_infrastructure_action`

`run` 的固定启动行为是：

1. 创建 `run.json`
2. 生成 request / analysis / orchestration 上下文
3. 写出 `orchestrator-input.md`
4. 把 run 状态推进到 `waiting_for_agent_output`

只有当 `orchestrator-session.json` 被写出并通过校验后，runtime 才会继续物化和执行后续步骤。

当前实现还会在读取 session 时执行确定性 normalize：

- `next_action` 会迁移为 `next_actions`
- 展示型或旧版 role 名称会通过 role alias 归一到 canonical role，例如 `Architect`、`Task Planner`、`Backend Dev`、`frontend_dev`、`task_planner`、`technical_writer`
- 缺省数组字段和缺省 `parallelGroup` 会按 runtime 合约补齐
- 无法 normalize 或校验失败的 session 会写出 `session-validation.json` 并进入 `blocked`

## 9. Agent 体系

### 9.1 Orchestrator Agent

`orchestrator agent` 是唯一编排决策源。

它必须写出：

- `runs/<run-id>/orchestration/orchestrator-session.json`

该文件必须显式声明：

- `decision_source=orchestrator_agent`
- `execution_mode=true_harness`
- `harness_classification=true_harness`

同时给出：

- `status`
- `next_actions`
- `agent_runs`
- 可选的 `summary`

runtime 不再替它推导 workflow、role、action 或并行边界。

当前目标路径要求 `orchestrator agent` 在当前 provider 会话中直接启动独立原生子 Agent。runtime 只负责记录这些调度决策、校验产物并执行确定性后端动作。

runtime 在 dispatch 合同生成时会写入 provider dispatch receipt；当前会话 Orchestrator 启动的子 Agent 产物返回后，必须通过 runtime 的 `agent complete <run-id> <action-id> --provider ...` 完成 provider-origin 原子落盘：

- 校验 handoff schema 与 evidence 文件存在性
- 更新 `agent-runs.json`
- 更新 `parallel-execution.json` wave history
- 更新 `action-ledger.json`
- 将 provider receipt 从 `waiting_for_agent_output` 收敛为 provider-origin completed receipt；缺少 provider-origin metadata 时只能保持 waiting/blocked 诊断，不能写成 completed

当前 `agent-runs.json` 不再只表达 native agent 列表，还会写入：

- `agents`: 真实 native subagent run，显式标记 `executionType=native_agent_run`
- `runtime_gates`: runtime 确定性 gate 或 orchestrator gate，显式标记 `runtime_gate` 或 `orchestrator_gate`
- `execution_units`: native agent 与 gate 的统一 registry

completed native agent 必须能反查到 dispatch contract、provider receipt、wave history 和 handoff；runtime-only gate 不再伪装成 native agent receipt。

provider-origin receipt 必须满足：

- `origin=provider_native_subagent`
- `receipt_type=provider_completed`
- provider 为 `codex` 或 `claude`
- provider agent id / session id / task handle 来自原生 provider run，不能是 runtime 拼接的默认值
- output path 指向存在的 provider output snapshot 或 handoff
- `integrity.output_sha256` 与 output snapshot 当前内容一致

runtime-only receipt 只能用于 waiting / diagnostic / runtime gate 记录，不能完成 Agent action，不能让 `receiptProvesNativeSubagent` 通过，也不能把 provider capability 从 unknown 解析为 supported。

### 9.2 Intake Agent

`intake` 负责需求归一化，服务于：

- request 输入理解
- requirement 拆解入口
- 交付边界澄清

它的结果沉淀到 request / analysis / handoff，而不是直接驱动 runtime 分支。

### 9.3 Project Analyzer Agent

`project-analyzer` 负责：

- 识别项目现状
- 提取模块、约束、测试入口和架构边界
- 为 orchestrator 和 architect 提供上下文

### 9.4 Product Planner Agent

`product-planner` 负责：

- 收敛交付范围
- 定义可验证验收边界
- 约束当前 run 的目标范围

### 9.5 Architect Agent

`architect` 负责：

- 生成架构与技术方案判断
- 确定任务边界
- 明确实现策略与风险
- 在 `/imfine init` 的已有项目路径中，产出带文件证据的 init Architect handoff
- 对证据不足的架构结论显式标记 unknown，而不是把 placeholder 当作 confirmed conclusion

### 9.6 Task Planner Agent

`task-planner` 负责：

- 写出 `planning/task-graph.json`
- 写出 `planning/ownership.json`
- 写出 `planning/execution-plan.md`
- 写出 `planning/commit-plan.md`
- 为 orchestrator 提供可执行任务图

当前 runtime 会校验 task graph 的基础结构、依赖存在性和同波次 write scope 冲突。

Task graph 当前校验范围包括：

- `graph.run_id` 必须等于当前 run id
- `task.type` 必须属于 runtime 支持的任务类型
- `depends_on`、`read_scope`、`write_scope`、`acceptance`、`dev_plan`、`test_plan`、`review_plan`、`verification` 必须为数组
- 每个 task 必须有 commit message
- 依赖 task 必须存在，且 dependency graph 不能成环
- 与 `orchestrator-session.json` 中的 task/action/agent 引用必须一致

当前 runtime 还会输出工程语义 warning 和 replan recommendation：

- 单 task 的 write scope 过宽且验收过少时要求拆分或说明
- `done`、`fix`、`test`、`review` 等不可验证 acceptance / plan 文案会触发 warning
- verification command 不属于已知项目命令模式时触发 warning
- API、schema、migration 等共享 contract 变更必须声明 contract/schema evidence
- lockfile、migration、schema、config、public API 等高冲突范围不能被同波次并行执行，除非通过依赖或 conflict strategy 显式串行化

### 9.7 Dev Agent

`dev` 负责：

- 在任务边界内实现代码
- 产出 patch 与 handoff
- 配合 QA / reviewer 返工

### 9.8 QA Agent

`qa` 负责：

- 运行验证
- 增补测试证据
- 给出通过、失败或阻塞结论
- 对前后端交付，提供默认 API base 与核心流程的 frontend contract 或 browser smoke 证据；`node --check` 不能单独作为前端验收

### 9.9 Reviewer Agent

`reviewer` 负责：

- 代码与行为审查
- 给出 approve / changes requested / blocked 结论

### 9.10 Merge Agent

`merge-agent` 负责：

- 在当前项目目录对应的 run 分支工作区合并已通过 QA 和 Reviewer 的任务结果
- 明确声明 `merged_files`、执行命令和合并证据
- 只在任务 write scope 内合并，不承担额外开发职责

### 9.11 Committer Agent

`committer` 负责：

- 判断是否满足提交条件
- 输出 commit 准备结论
- 不直接执行 git commit；确定性 git 操作由 runtime 执行

### 9.12 Archive / Risk Reviewer / Technical Writer / Project Knowledge Updater

这些角色分别负责：

- `archive`: 交付归档和最终确认
- `risk-reviewer`: 风险暴露与阻塞结论
- `technical-writer`: 文档和说明产物
- `project-knowledge-updater`: 长期项目知识更新

对新应用 demo 或中文需求，Technical Writer 默认输出中文项目文档；API / 数据库 backed demo 必须维护 `README.md`、`docs/api.md`、`docs/database-schema.md`、`docs/verification.md`，并与实际代码保持一致。

### 9.13 Role Registry 和 Skill Registry

当前实现已经将 runtime 角色契约集中到 `src/core/role-registry.ts`：

- role level：`run`、`task`、`both`
- handoff schema
- allowed transitions
- role status 集合
- role-level required evidence
- handoff 必需字段、数组字段和字符串字段

`handoff-validator.ts`、`handoff-evidence.ts`、`dispatch.ts` 会消费同一份 role registry，避免角色、handoff schema、allowed transitions 和 evidence requirements 分散漂移。

当前实现也已经将 Superpowers 风格能力集中到 `src/core/skill-registry.ts`：

- skill id
- 适用 role
- required inputs
- expected outputs
- required evidence
- failure handling

`AgentRun.skills` 会在 orchestrator session 校验时验证 skill 是否存在、是否允许被该 role 使用；`true-harness-evidence` 会把关键 skill required evidence 纳入 evidence contract。

## 10. 任务拆分、并行和冲突策略

### 10.1 优先任务级并行

并行边界只由 orchestrator agent 在 `orchestrator-session.json` 中显式声明：

- `dependsOn`
- `parallelGroup`

runtime 只消费这些边界，不推导新的并行波次。

### 10.2 不能安全拆分时

如果 orchestrator agent 没有声明可并行边界，或者通过依赖关系表达了串行执行：

- runtime 按串行执行
- `parallel-plan.json` 仍然只表达规划分组
- `parallel-execution.json` 只记录真实执行事实

当前 orchestrator session 中每个 action 都必须声明 `parallelGroup`。串行语义应通过 `dependsOn` 和不同 action 状态表达，而不是省略 parallel group。

### 10.3 多角色并行

当多个 action 属于同一 `parallelGroup` 且状态为 `ready` 时：

- orchestrator agent 应直接在当前会话中把它们作为同一波次拉起独立子 Agent
- runtime 只把这些调度结果物化为同一波次中的多个 agent run
- `agent-runs.json` 只记录真实 agent run
- `parallel-execution.json` 只记录真实 wave

runtime 当前会在 `parallel-execution.json` 中记录显式 batch 语义：

- `batch_strategy=parallel_group` 表示同一 parallel group 的 ready agent batch
- `batch_strategy=run_level_compatible` 表示 run-level agent 与 task-level ready batch 的兼容合批
- `batch_levels` 明确记录该 wave 包含 `run_level`、`task_level` 中的哪类 action

这样 run-level agent 不再只依赖 `!taskId` 这种隐式规则被混入 batch，而是有可审计的 batch strategy 和 batch level。

### 10.4 write_scope 校验

任务边界通过以下信息约束：

- `readScope`
- `writeScope`
- `taskId`
- `dependsOn`

这些边界由 orchestrator agent 和 task graph 共同定义，runtime 负责落盘和校验。

当前 runtime 已经对 task graph 中的同波次 write scope 重叠、task patch 是否越界、merge-agent 声明的 merged files 是否越界进行校验。

当前 runtime 还会把 Agent-authored acceptance matrix 作为产品形态与工程交付的并行验收层。runtime 只校验 schema、required item、accepted deviation 和 evidence 文件存在性，不再通过需求关键词判断“小程序、管理后台、数据库、前后端”等产品形态。

## 11. Git、Commit 和 Push 策略

每次 run 对应一条交付分支：

- `imfine/<run-id>`

当前实现的确定性 git 行为包括：

- 准备 run 分支
- 收集 patch
- 执行 commit
- push 到 `origin` 或生成明确的本地交付阻塞证据
- 记录 archive 与报告

当前集成目录是当前项目目录本身。task worktree 只用于各 task 的隔离开发；任务通过 QA / Review 后，由 `merge-agent` 负责把已通过的任务结果合并到当前项目目录对应的 run 分支工作区，并声明 `merged_files` 与 evidence。runtime 校验这些声明，再执行后续确定性 commit / push。

是否进入 commit / push 阶段，由 orchestrator agent 和 handoff 结果决定；具体 git 操作由 runtime 执行。

merge-agent 必须声明合并结果，runtime 不替它推导合并内容，只消费已声明且通过 scope 校验的合并事实并执行后续确定性 commit / push。

如果模型或人工已经完成 git 提交，`reconcile` 会读取 run metadata 或 git log，写回 `run.json.commit_hashes` 和 `evidence/commits.md`。如果本地没有 `origin`，runtime 会写出 `evidence/push.md` 并标记 `push_blocked_no_remote`，不会把“未配置远端”误报为已远端交付。

当前 commit / archive identity 统一使用以下 run metadata 字段：

- `implementation_commit`
- `evidence_sync_commit`
- `archive_commit`
- `final_head`
- `pushed_head`
- `commit_set`

commit 阶段会写入 `commit_set`、`implementation_commit`、`final_head` 和 `archive_commit`；push 成功时写入 `pushed_head`，push blocked 时保留本地 `push_local_commit` 和明确阻塞原因。archive 前会记录 `archive_started_head`、`worktree_clean_before_archive` 和 `worktree_status_before_archive`。archive report、committer evidence、run metadata、Git HEAD 和 push evidence 必须引用同一组 commit identity；doctor/reconcile 会检测 archive report 指向旧 commit 或多源 commit 漂移。

如果 git lock、权限或认证导致 commit/push 失败，runtime 必须写入结构化 blocker，保留失败命令、stderr、建议恢复动作和可重试边界；不能只依赖模型口头描述失败原因。

## 12. 新项目流程

新项目和已有项目使用同一条主路径。

新项目的固定行为是：

1. runtime 识别项目类型为 `new_project`
2. 生成 request / analysis / orchestration 上下文
3. 写出 `orchestrator-input.md`
4. 等待 orchestrator agent 写出 `orchestrator-session.json`
5. 按 orchestrator agent 决策推进 planning、执行、验证和归档

新项目的差异体现在：

- analysis 内容
- task graph 内容
- agent_runs 与 next_actions 的编排结果

差异不体现在 runtime 另有一套新项目主脑。

## 13. 已有项目流程

已有项目的固定行为也是：

1. runtime 识别项目类型为 `existing_project`
2. 分析当前代码库、测试、依赖和基础设施
3. 写出 `orchestrator-input.md`
4. 等待 orchestrator agent 决策
5. 按 agent 决策推进后续执行

已有项目与新项目一样，真正的流程差异只来自 orchestrator agent 写出的 session 与 task graph。

## 14. Runtime 和 Agent 边界

runtime 负责：

- 初始化 `.imfine/`
- 创建 run
- 物化 request / analysis / orchestration 上下文
- 读取并校验 `orchestrator-session.json`
- 物化 `dispatch-contracts.json`
- 物化 `agent-runs.json`
- 物化 `parallel-plan.json`
- 物化 `parallel-execution.json`
- 准备 worktree
- 收集和校验 patch
- 记录状态迁移
- 执行 commit / push / runtime archive finalization
- 收敛 reconcile / finalize gate
- 校验 Agent-authored acceptance matrix、生成 final report 和结构化 fix task
- 写出 true harness evidence 和 reports

agent 负责：

- 需求理解
- 项目分析
- 设计与任务规划
- 并行边界声明
- 开发、QA、review、archive 判断
- handoff summary
- product / architecture / QA / review acceptance matrix 判断

高层决策和原生子 Agent 调度都只来自 agent，runtime 只负责确定性后端动作。

如果当前 provider 会话不能启动独立原生子 Agent，orchestrator agent 应把 run 标记为 `blocked`，而不是静默压缩成单会话代偿路径。

当前 runtime 会在 run 创建或首次 orchestration 时写出 provider capability snapshot：

- provider：`codex`、`claude` 或 `unknown`
- 当前 provider entry 是否安装
- subagent support：`supported`、`unsupported` 或 `unknown`
- 细粒度 capability：
  - `supports_subagent`
  - `supports_parallel_subagent`
  - `supports_agent_file_output`
  - `supports_agent_wait`
  - `supports_agent_interrupt`
- detection source 与 detected_at
- 当 provider 声明 `unsupported` 或未确认 `supported` 时写出 blocked reason，并阻断 true harness 通过

provider capability 不是只靠环境变量一次性裁决。当前实现支持由 native subagent receipt 解析确认能力：

- 初始 capability snapshot 可以是 `unknown` 或 `blocked`
- completed receipt 必须包含 provider、provider agent id、provider session id、terminal status 和存在的 output path
- 满足条件的 receipt 会写入 `provider-capability-resolution.json`
- capability snapshot 会更新为 `resolved_by_receipts=true`、`subagent_supported=supported`
- true harness evidence 只读取 capability snapshot / resolution record，不从 agent id 猜测 provider 支持

agent dispatch、等待输出、provider-origin completion 和 runtime processed diagnostic 路径会写出 provider execution receipt。receipt 记录：

- action id
- agent id / role / task id
- parallel group
- provider
- provider agent id
- provider session id
- provider trace id
- provider task handle
- origin
- receipt type
- integrity hash
- status
- output path
- started_at / completed_at
- metadata

因此 true harness 判断不只看产物链是否完整，还要求每个 agent dispatch contract 对应的 provider-origin completed receipt 存在并通过完整性校验。runtime gate 不需要 provider-origin receipt，也不能伪装成 native agent receipt。

## 15. Gate 体系

### 15.1 Orchestrator Gate

主路径唯一关键 gate 是：

- `orchestrator-session.json` 是否存在
- 是否显式声明 `decision_source=orchestrator_agent`
- 是否显式声明 `execution_mode=true_harness`
- 是否显式声明 `harness_classification=true_harness`
- 是否声明有效 run status
- 是否提供 `next_actions` 与 `agent_runs` 数组

不满足时，run 保持在 `waiting_for_agent_output` 或进入 `blocked`。

### 15.2 Planning Gate

如果需要进入任务执行：

- `planning/task-graph.json` 必须存在并通过 runtime 当前支持的结构校验
- `dispatch-contracts.json` 与 `agent-runs.json` 只能从 orchestrator session 派生

当前校验覆盖：

- task id 不重复
- task type 属于 runtime 支持集合
- `graph.run_id` 与当前 run id 一致
- 必需的 scope、acceptance、plan、verification、commit message 不为空
- 必需数组字段必须真的是数组
- task 依赖引用存在
- task dependency graph 不成环
- 无依赖并行候选之间的 write scope 不重叠
- task graph 与 orchestrator session 中的 task/action/agent 引用一致

### 15.3 Execution Gate

进入真实执行时，runtime 依赖：

- ready 的 next action
- task graph 与 ownership
- patch 校验结果
- QA / review / archive handoff 结果
- commit / push / archive evidence
- provider execution receipt
- skill evidence contract
- `true-harness-evidence` 对显式声明、provider、dispatch、wave、handoff、skill evidence 的综合判断

这些 gate 只表达执行前置条件，不表达第二套运行语义。

如果 QA/Review/Risk 先产出在 `review/*.md`，runtime collector 会把它们收敛到标准 evidence：

- `review/qa-report.md` -> `evidence/test-results.md`
- `review/code-review.md` -> `evidence/review.md`
- `review/risk-review.md` -> `evidence/risk-review.md`

archive/finalize gate 只消费标准 evidence、handoff 和结构化 blocker；人工报告可以作为来源，但不能绕过标准 evidence。

### 15.4 Handoff Gate

当前 handoff 已经是不可绕过的标准 evidence。

核心角色 handoff 必须包含：

- `run_id`
- `task_id`
- `role`
- `from`
- `to`
- `status`
- `summary`
- `commands`
- `evidence`
- `next_state`

不同角色还会追加角色专属字段，例如：

- `dev`: `files_changed`、`verification`
- `qa`: `failures`
- `reviewer`: `findings`
- `merge-agent`: `merged_files`
- `committer`: `commit_mode`
- `archive`: `archive_report`、`project_updates`、`blocked_items`

缺失 handoff 时，agent action 保持 `waiting_for_agent_output`；已完成 action 的 handoff 不合法时，run 进入 `blocked` 并写出 validation evidence。

handoff evidence 中引用的文件必须真实存在。缺失 evidence 文件会导致 handoff validation 失败，并在 true harness evidence 中体现为不可通过。

### 15.5 Final Gates

`final-gates.json` 只能作为 runtime 从标准 evidence 派生出的摘要视图。

它不能替代以下标准 evidence：

- handoff
- status
- QA / review evidence
- commit / push outcome
- archive handoff
- true harness evidence

手写 final gates 不能让 blocked run 变成 completed。

当前 `finalize` 会统一检查：

- Planning evidence
- Dispatch / provider receipt / wave traceability
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

只有所有 gate 都通过时，runtime 才会把 run 推进到 `completed`；否则 run 会保持或进入 `blocked`，并写出 `FIX-*` 任务与 `archive/final-report.md`。

当前 `final-gates.json` 的标准 gate 集合为：

- `planning`
- `dispatch`
- `qa`
- `review`
- `recheck_fix_loop`
- `committer`
- `push`
- `archive`
- `true_harness`
- `project_knowledge`

`/imfine status` 优先读取 final gates。completed run 如果缺少 final gates 或 final gates 不完整，会显示 `currentRunConsistency=inconsistent`，不能被当作 completed 交付。

Archive Agent 与 runtime finalize 是两个不同 gate：

- `agent-archive` 必须作为 native agent 产出 archive handoff 和 archive 判断，并留下 provider-origin completed receipt
- `runtime-archive-finalize` 只消费标准 evidence、archive handoff、acceptance matrix、true harness evidence 和 blocker artifact，负责生成 final gates、final report、trace 与 project knowledge freshness
- runtime finalize 不能替代 Archive Agent 进行归档判断，也不能用 runtime-only receipt 证明 archive agent 已执行

### 15.6 Acceptance Matrix Gate

`acceptance-matrix.json` 是 Agent-authored 验收矩阵的 runtime 校验结果，不是 runtime 从需求关键词推导出的产品判断。

Agent-authored 来源包括：

- `orchestration/agent-acceptance-matrix.json`
- `agents/product-planner/acceptance-matrix.json`
- `agents/architect/acceptance-matrix.json`
- `agents/qa/acceptance-matrix.json`
- `agents/reviewer/acceptance-matrix.json`

runtime 负责把这些来源收敛为统一 schema，并校验 required item、accepted deviation、evidence 文件存在性和 QA/Review 接受状态。runtime 不再通过“小程序、管理后台、数据库、前后端”等需求关键词推导产品形态。

Agent-authored matrix 可以覆盖：

- product shape
- architecture
- persistence
- frontend surface
- backend API
- tests
- documentation
- git delivery
- archive evidence

每个 item 都会标注：

- id
- category
- requirement_level
- classification
- status
- detail
- expected / observed
- QA/Review 是否接受
- evidence 文件列表

如果 Agent 判断某项属于 `demo-substitute` 或 `deviation`，必须明确 expected / observed、证据文件和 QA/Review 是否接受；未被接受的 required deviation 会阻断 final gate。

如果 Agent-authored matrix 缺失，或 required item 缺少证据、缺少观察结果、处于 blocked/deviation 且没有 QA/Review 接受，runtime 必须阻断 finalize。

例如 Agent 认为“单静态页替代明确要求的小程序目录”或“内存仓储替代明确要求的 SQLite/MySQL 持久化”可以接受时，必须在 matrix 和 final report 中明确标注为 `demo-substitute` 或 `deviation`，并由 QA/Review 给出接受证据。runtime 只校验这个声明链条是否存在且一致。

当前 acceptance matrix 对 demo 应用交付保留两类可复用验收项，但这些项仍必须来自 Agent-authored matrix：

- `documentation.delivery-set`：系统型 demo 必须具备 `README.md`、`docs/api.md`、`docs/database-schema.md`、`docs/verification.md`
- `tests.frontend-contract`：前后端交付必须具备 frontend contract test 或 browser smoke 证据，不能只用语法检查替代真实流程验证

## 16. 失败和返工

当前 fix loop 通过显式状态表达：

- `needs_requirement_reanalysis`
- `needs_design_update`
- `needs_task_replan`
- `needs_dev_fix`
- `needs_infrastructure_action`

返工触发来源包括：

- task state 转移失败
- patch 校验失败
- QA 失败
- reviewer 要求修改
- orchestrator 明确把 run 置为阻塞或返工状态

恢复时，runtime 只负责状态迁移与证据落盘，不替代 agent 再做判断。

当前实现会为恢复与返工写出审计证据：

- replan 写出 `agents/task-planner-replan/input.md`、`orchestration/task-planner-replan.md`、`orchestration/task-planner-replan-audit.json`
- recover 写出 `orchestration/recovery-<task-id>.json`
- design rework 写出对应 evidence、architect input、task-planner input 和 audit
- blocked action 会根据 role 映射到更精确的 recoverable state，例如 `needs_design_update`、`needs_task_replan`、`needs_dev_fix`、`needs_requirement_reanalysis`、`needs_infrastructure_action`
- reconcile/finalize 会从 QA/Review/Risk 报告、state blocker 和 handoff `blocked_items` 汇总 `structured-blockers.json`
- 每个结构化 blocker 会生成对应 `FIX-*` task，包含 blocker id、owner、required evidence 和 review close action

## 17. 归档策略

归档分成 Agent 判断和 runtime 确定性 finalize 两段：

- `agent-archive` 是 native agent action，负责阅读标准 evidence、handoff、QA/Review/Risk 结论、acceptance matrix 与 blocker artifact，产出 `agents/archive/handoff.json` 和归档判断
- `runtime-archive-finalize` 是 runtime gate，负责校验 archive handoff、provider-origin receipt、标准 evidence 和 true harness evidence，并生成最终报告、final gates、trace 与 project knowledge freshness

两段缺一不可。只有 runtime finalize 没有 Archive Agent，不算完成归档；只有 Archive Agent 没有 runtime finalize，也不会把 run 推进到 completed。

归档阶段固定写出：

- `archive/archive-report.md`
- `archive/final-report.md`
- `archive/project-updates.md`
- `archive/final-summary.md`
- `reports/<run-id>.md`
- `orchestration/final-gates.json`
- `orchestration/acceptance-matrix.json`
- `orchestration/structured-blockers.json`
- `review/blocker-matrix.json`
- `orchestration/pre-archive-harness-evidence.json`
- `orchestration/pre-archive-harness-evidence.md`
- `orchestration/method-provenance.json`
- `orchestration/trace-index.json`
- `orchestration/true-harness-evidence.json`
- `orchestration/true-harness-evidence.md`
- `.imfine/project/project-knowledge-freshness.json`

archive 的最终状态只有：

- `completed`
- `blocked`

归档报告会明确写出：

- run status
- execution mode
- harness classification
- true harness evidence 结论
- required / negotiable / demo substitute / deviation
- QA/Review acceptance
- structured blockers 和修复证据
- blocker matrix、method provenance、commit identity 和 project knowledge freshness

true harness 不是 runtime 猜出来的，而是以下事实共同成立：

- orchestrator agent 显式声明 `true_harness`
- provider capability 明确确认 native subagent、task dispatch、completion receipt、provider output snapshot、receipt integrity 等细粒度能力满足 true harness 要求
- 存在 dispatch contract
- 存在真实 execution wave
- 每个 required contract 都有 completed wave
- 每个 required contract 都有 provider-origin completed receipt
- provider-origin receipt 能反查到 task handle、origin、type、integrity 和 provider output snapshot
- 存在 agent handoff evidence chain
- contract 对应 handoff 全部通过 schema 与 evidence 文件存在性校验
- `AgentRun.skills` 对应的 required evidence contract 全部满足
- `true-harness-evidence.json` 与 `true-harness-evidence.md` 来自同一证据模型，关键结论一致

archive 前还会写出 `pre-archive-harness-evidence.json` 和 `pre-archive-harness-evidence.md`，专门证明进入 archive 前以下 evidence 已满足：

- completed wave contract
- handoff validation
- provider receipt contract
- QA evidence
- Review evidence
- commit evidence
- push evidence
- committer handoff

JSON/Markdown true harness evidence、provider capability、receipt、wave、handoff validation、skill evidence 任一矛盾时，archive preflight 会阻断归档。

archive 完成后会写出：

- `orchestration/trace-index.json`
- `orchestration/method-provenance.json`
- `.imfine/project/capabilities/<capability>/trace.json`
- `.imfine/project/project-knowledge-freshness.json`

trace index 只引用已有产物，不改变业务执行逻辑；capability trace 用于把 archived capability 与 run、task、evidence、commit 关联起来，让后续 run 基于可追踪事实读取历史能力。

Archive Agent 的 provider-origin receipt 只证明 agent 已完成归档判断；`runtime-archive-finalize` 的 action-ledger / final-gates 只证明 runtime 已完成确定性收敛。两个证据不能互相替代。

method provenance 显式记录：

- OpenSpec-inspired：request、analysis、spec-delta、archive、capabilities
- Superpowers-inspired：clarify、project-analysis、write-delivery-plan、execute-task-plan、tdd、systematic-debugging、parallel-agent-dispatch、code-review、archive-confirmation
- BMAD-inspired：Product Planner、Architect、Dev、QA、Reviewer、Risk Reviewer、Committer、Archive、Project Knowledge Updater
- imfine-specific：true harness、provider receipts、dispatch contracts、handoff validation

project knowledge freshness 会扫描 `initialized from limited evidence`、`not detected`、`unknown`、`.gitignore only`、`no source evidence`、`no test evidence` 等 init 阶段 stale marker。archive / reconcile / doctor 会把 stale marker 作为 project knowledge 风险或阻断来源。

## 18. 当前实现摘要

当前实现的关键事实是：

- 公开入口只有 `init`、`run`、`status`
- 安装入口只有 `npx github:<owner>/<repo> install ...`
- 唯一执行模式是 `true_harness`
- 唯一编排决策源是当前会话中的 `orchestrator agent`
- 角色契约已经集中到 role registry，handoff validator、dispatch contract、evidence validation 共用同一份 role 定义
- skill 契约已经集中到 skill registry，`AgentRun.skills` 会校验 role 适配性并进入 evidence contract
- `run` 创建后固定进入 `waiting_for_agent_output`
- `--plan-only` 不走另一套 planning 路径，只返回当前 run 的 orchestrator 快照
- `resume` 是只读快照，不写状态、不制造 blocked、不覆盖 completed evidence
- `doctor` 是 advisory fact source，不再裁决主路径
- runtime 只消费 `orchestrator-session.json`
- runtime 不替代当前会话发起原生子 Agent 调度，但会记录 dispatch receipt、complete receipt、wave history 和 action ledger
- planning 产物与 execution 证据严格分层
- `parallel-plan.json` 只表达规划
- `parallel-execution.json` 只表达真实执行，并记录 batch strategy 与 batch level
- provider capability snapshot 已细分 native subagent、task dispatch、completion receipt、provider output snapshot、receipt integrity 等能力；unknown/unsupported 不允许通过 true harness
- provider capability 可以由 completed native subagent receipt 解析为 `resolved_by_receipts=true`，并写入 `provider-capability-resolution.json`
- provider-origin completed receipt 已记录 task handle、origin、type、integrity，并绑定 `provider-outputs/` 稳定快照
- `agent complete --provider` 会原子校验 handoff/evidence 并更新 provider receipt、agent-runs、parallel-execution、action-ledger
- `agent-runs.json` 已区分 `native_agent_run`、`orchestrator_gate`、`runtime_gate`，并用 `execution_units` 表达统一 registry
- `reconcile` / `finalize` 会把 git、standard evidence、archive、acceptance matrix 和 true harness evidence 收敛为权威 run 状态
- `agent-acceptance-matrix.json` 是 Agent-authored 验收矩阵来源；`acceptance-matrix.json` 是 runtime 对 schema、required item、accepted deviation 和 evidence 文件存在性的校验结果
- `archive/final-report.md` 已显式输出 Required、Negotiable、Demo Substitute、Deviation、QA Review Acceptance 和 Structured Blockers
- `review/blocker-matrix.json` 已用于表达 QA/Review/Risk/final gate blocker 的 severity、状态、证据、commit 和 recheck 结论
- `orchestration/method-provenance.json` 已用于表达 OpenSpec / Superpowers / BMAD / imfine-specific contracts 的方法来源和 skill evidence contract
- `.imfine/project/project-knowledge-freshness.json` 已用于检测 project knowledge stale marker
- init 已为已有项目写出 Architect handoff；evidence 不足时 project knowledge freshness 使用 `unknown` / `partial`，不制造占位结论
- pre-archive harness evidence 已用于 archive 前证据完整性检查
- `agent-archive` 与 `runtime-archive-finalize` 已拆分；前者是 native Archive Agent 判断，后者是 runtime 确定性收敛 gate
- run-level trace index 与 capability trace 已用于 OpenSpec 风格可追溯性
- blocker summary artifact 已用于汇总 state、provider、session、handoff、final gate 阻塞来源；status 不再主动写入该 artifact
- blocker summary 已包含 nextAction、owner、evidence，避免 blocked 只给出笼统原因
- structured blocker artifact 已用于将 QA/Review/Risk blocker 转换为 `FIX-*` 任务
- agent summary 只输出到当前会话
- fix loop 状态已经进入 run 状态机，用于恢复、失败追踪和 archive 前审计
- true harness evidence 按显式声明、provider receipt、真实 dispatch / wave / handoff、skill evidence contract 事实判断
- true harness JSON 和 Markdown 会通过同一模型生成并接受 consistency 校验，矛盾时 archive/reconcile/doctor 会阻断或报告
- orchestrator session schema、handoff、dispatch contract、parallel execution、archive gate、completed gate 已经形成闭环
- commit/archive identity 已统一到 `commit_set`、`implementation_commit`、`archive_commit`、`final_head`、`pushed_head`，doctor/reconcile 可检测 drift
- run 防重策略已经存在：同一 active current run 与同一 source 默认复用，需要新 run 时显式 `--new`
- internal runtime command 已经通过环境变量 guard 与用户公开入口隔离
- final gates 由 runtime 从标准 evidence 派生，不作为独立事实来源；completed run 缺 final gates 或 final gates 不完整会显示 inconsistent
- `docs/runtime-boundary.md`、`docs/orchestrator-dispatch-protocol.md`、`docs/harness-evidence.md` 已沉淀 runtime/Agent 边界、调度协议和证据说明
- test coverage 已覆盖 role registry 一致性、TaskGraph 负例与语义 warning、provider supported/unsupported/unknown、resolved_by_receipts、provider-origin receipt、provider output snapshot、true harness 缺 receipt/wave/handoff/evidence/pre-archive 负例、status/gate matrix 状态输出、agent registry execution units、blocker matrix、project knowledge freshness、reconcile/finalize、agent complete、resume 幂等、Agent-authored acceptance matrix 对照 fixture 和真实双 demo replay
- `test/demo-replay.mjs` 直接回放 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo` 和 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo1`：早期 demo 不能因 `run.json.completed` 被误判为 true-harness completed；当前 demo1 不能因 git commit 存在被误判为 runtime completed

## 19. 已确认实现决策

- `orchestrator-session.json` 是唯一编排真相源
- `decision_source` 必须是 `orchestrator_agent`
- `execution_mode` 必须是 `true_harness`
- `harness_classification` 必须是 `true_harness`
- 当前实现不支持 `single_session_fallback` 作为第二执行模式
- debug / internal runtime 命令不构成用户公开工作流
- `plan` 不属于公开命令
- runtime 不再自己生成 task graph 主语义
- runtime 不从需求关键词推导产品形态或业务验收标准
- acceptance matrix 的判断来源必须是 Agent-authored；runtime 只做 schema、required item、accepted deviation 和 evidence 文件存在性校验
- Codex 与 Claude provider 的 harness 能力必须保持同一能力面；涉及两者的任务必须同时实现、同时测试
- provider-origin completed receipt 加 task handle、origin、type、integrity 和 provider output snapshot，才可证明 native subagent 完成；runtime-only receipt 不能替代
- `agent-archive` 是 native Archive Agent；`runtime-archive-finalize` 是 runtime gate，二者不能互相替代
- task 状态机支持 `completed`，当前交付链路中 commit 后的任务事实主要以 `committed`、commit hash 和 run archive evidence 表达
- archive 终态是 `completed | blocked`
- session summary 不写入 `.imfine` 文档
- status / resume 默认不写 runtime 状态；需要修复或最终收敛时走明确的 reconcile/finalize
- `IMFINE_IMPLEMENTATION_OPTIMIZATION_TASKS.md` 中的 runtime contract、true harness evidence、OpenSpec traceability、Superpowers skill contract、observability、recovery robustness 和 test coverage 任务已按当前实现整合进本文档
- `HARNESS_LANDING_ISSUES.md` 中 T01-T19 已按当前实现完成，并作为本方案的落地校准来源
- 基于 `imfine-demo` 与 `imfine-demo1` 对比得到的 12 项 runtime / harness 修复已按当前实现整合进本文档；临时复盘文档不再作为独立来源保留
- 原 harness engineering backlog 中仍有效的工程要求已合并进本文档，后续不再作为独立任务源保留

## 20. 参考来源

- OpenSpec：规格、delta、archive、capability 沉淀方法
- Superpowers：clarify、plan、execute、review、debug、archive 工作纪律
- BMAD：多角色 agent 体系与项目上下文工程
- 当前仓库代码实现：
  - `src/core/cli.ts`
  - `src/core/run.ts`
  - `src/core/orchestrator.ts`
  - `src/core/auto-orchestrator.ts`
  - `src/core/agent-complete.ts`
  - `src/core/reconcile.ts`
  - `src/core/plan.ts`
  - `src/core/dispatch.ts`
  - `src/core/archive.ts`
  - `src/core/true-harness-evidence.ts`
  - `src/core/role-registry.ts`
  - `src/core/skill-registry.ts`
  - `src/core/provider-evidence.ts`
  - `src/core/provider-output.ts`
  - `src/core/acceptance-matrix.ts`
  - `src/core/blocker-summary.ts`
  - `src/core/trace.ts`
  - `src/core/state-machine.ts`
  - `src/core/quality.ts`
  - `src/core/worktree.ts`
  - `src/core/gitflow.ts`
  - `src/core/doctor.ts`
  - `src/core/session-summary.ts`
  - `library/agents/qa.md`
  - `library/agents/technical-writer.md`
  - `library/skills/tdd.md`
  - `library/templates/orchestrator-session.schema.json`
  - `docs/runtime-boundary.md`
  - `docs/orchestrator-dispatch-protocol.md`
  - `docs/harness-evidence.md`
  - `test/harness-acceptance.mjs`
  - `test/implementation-optimization.mjs`
  - `test/plan-validation.mjs`
  - `test/reconcile.mjs`
  - `test/demo-replay.mjs`
