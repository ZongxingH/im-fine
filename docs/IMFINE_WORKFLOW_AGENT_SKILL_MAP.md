# imfine 工作流与 Agent / Skill 编排关系

本文档描述当前实现中的 imfine 工作流，以及每个工作流会涉及的 Agent、内部 Skill 和主要产物。

当前安装到 Codex / Claude 用户入口列表的只有 6 个公开入口：

```text
imfine-agent-orchestrator
imfine-init
imfine-run "<requirement>"
imfine-status
imfine-observe [run-id]
imfine-archive
```

其他 Agent / Workflow 不对用户直接暴露，作为 Orchestrator 和公开 workflow 的内部能力库保留在：

```text
~/.imfine/runtime/src/imfine-skills/
```

源码对应目录是：

```text
src/imfine-skills/
```

## 1. 总体分层

| 层级 | 对外可见 | 作用 |
| --- | --- | --- |
| 公开入口 | 是 | 用户只需要调用这 6 个入口，降低使用复杂度。 |
| Orchestrator Agent | 是 | 唯一主协调入口，负责根据请求和 run 状态选择内部 Agent / Workflow。 |
| 内部 Agent | 否 | 承担 Intake、Product、Architecture、Task Planning、Dev、QA、Review、Archive 等角色工作。 |
| 内部 Workflow Skill | 否 | 承担 brainstorming、product brief、requirement validation、task planning、dispatch、TDD、debug、review、archive confirmation 等方法流程。 |
| Deterministic runtime | 否 | 只负责状态、schema、evidence、receipt、git、gate、archive 等确定性动作。 |

## 2. 公开入口工作流

### 2.1 `imfine-agent-orchestrator`

主入口 Agent。用户可以直接激活它，然后由它路由到更窄的 workflow。

| 项目 | 内容 |
| --- | --- |
| 类型 | Public Agent Entry |
| 源码 | `src/imfine-skills/agents/imfine-agent-orchestrator/` |
| 主要职责 | 读取 `.imfine` 状态，选择 init/run/status/observe/archive 或内部 workflow，协调原生子 Agent 和 runtime evidence。 |
| 直接菜单 Skill | `imfine-init`、`imfine-run`、`imfine-status`、`imfine-observe`、`imfine-archive` |
| 内部菜单 Skill | `imfine-parallel-agent-dispatch`、`imfine-write-delivery-plan`、`imfine-brainstorming`、`imfine-implementation-readiness`、`imfine-correct-course` |
| 关键约束 | 不自己假装完成其他 Agent 工作；Agent 决策来自 Agent / Skill，runtime 只做确定性 evidence 后端。 |

工作流描述：

```text
用户激活 Orchestrator
  -> 读取 .imfine/state/current.json、.imfine/project/**、当前 run 状态
  -> 判断用户意图属于 init / run / status / observe / archive / 内部修复动作
  -> 调用对应公开 workflow 或加载内部 workflow
  -> 根据 run evidence 决定是否需要原生子 Agent
  -> 子 Agent 完成后要求 provider-origin receipt 和 handoff
  -> 调用 runtime 做确定性校验、物化、gate、archive 或报告
  -> 返回当前状态、blocker、下一 owner 或完成结论
```

常见分支：

- 没有 `.imfine` 或项目知识不足：路由到 `imfine-init`。
- 用户给出新需求：路由到 `imfine-run`。
- 用户问当前进展：路由到 `imfine-status`。
- 用户要验证 demo 能力：路由到 `imfine-observe`。
- run 接近完成：路由到 `imfine-archive`。
- run 中途出现需求、架构、QA、Review 或 provider blocker：加载 `imfine-correct-course`、`imfine-implementation-readiness` 或对应内部 workflow。

### 2.2 `imfine-init`

初始化项目工作空间和项目知识。

| 项目 | 内容 |
| --- | --- |
| 类型 | Public Workflow Entry |
| 源码 | `src/imfine-skills/1-bootstrap/imfine-init/` |
| 触发 | 新项目或已有项目开始使用 imfine 前。 |
| 涉及 Agent | `imfine-agent-project-analyzer`、`imfine-agent-architect`，必要时由 `imfine-agent-orchestrator` 协调。 |
| 涉及 Skill | `imfine-project-analysis` 可作为内部分析流程；已有项目需要 architecture evidence 时使用 Architect reasoning。 |
| Runtime 动作 | `node ~/.imfine/runtime/dist/cli/imfine-runtime.js init` |
| 主要产物 | `.imfine/state/current.json`、`.imfine/project/architecture.md`、`tech-stack.md`、`module-map.md`、`test-strategy.md`、`project-knowledge-freshness.json` |
| 关键判断 | 空项目只创建基础 workspace；已有项目必须用文件证据确认 project knowledge，不制造占位结论。 |

工作流描述：

```text
用户调用 imfine-init
  -> Orchestrator 只读扫描项目根目录
  -> 判断 empty project / existing project
  -> runtime 执行 init，创建 .imfine 基础目录、state 和 project artifacts
  -> 如果是已有项目，Project Analyzer 读取文件证据
  -> Architect 确认 architecture / module / tech stack / test strategy
  -> 写入或刷新 project knowledge freshness
  -> Orchestrator 汇报项目类型、证据、unknown、下一步建议
```

常见分支：

- 空项目：只生成基础 `.imfine` workspace 和空项目状态，后续由 `imfine-run` 决定产品/架构。
- 已有项目且证据充分：生成 confirmed 或 partial project knowledge。
- 已有项目但证据不足：明确标记 `unknown` / stale，不把占位内容当作事实。

### 2.3 `imfine-run "<requirement>"`

核心交付工作流。它根据实际需求决定是否进入 discovery、planning、readiness、dispatch、execution、archive 等内部阶段。

| 项目 | 内容 |
| --- | --- |
| 类型 | Public Workflow Entry |
| 源码 | `src/imfine-skills/2-run/imfine-run/` |
| 触发 | 用户提供需求文本或需求文件。 |
| 主协调 Agent | `imfine-agent-orchestrator` |
| 可能涉及 Agent | `imfine-agent-intake`、`imfine-agent-product-planner`、`imfine-agent-ux-designer`、`imfine-agent-project-analyzer`、`imfine-agent-architect`、`imfine-agent-task-planner`、`imfine-agent-dev`、`imfine-agent-qa`、`imfine-agent-reviewer`、`imfine-agent-risk-reviewer`、`imfine-agent-merge-agent`、`imfine-agent-committer`、`imfine-agent-technical-writer`、`imfine-agent-project-knowledge-updater`、`imfine-agent-archive` |
| 可能涉及 Skill | `imfine-brainstorming`、`imfine-product-brief`、`imfine-validate-requirement`、`imfine-clarify`、`imfine-project-analysis`、`imfine-write-delivery-plan`、`imfine-implementation-readiness`、`imfine-parallel-agent-dispatch`、`imfine-execute-task-plan`、`imfine-tdd`、`imfine-systematic-debugging`、`imfine-code-review`、`imfine-correct-course`、`imfine-archive-confirmation`、`imfine-retrospective` |
| Runtime 动作 | `run` 创建上下文；后续由 Orchestrator / Agent 显式调用 `orchestrate`、`agent complete`、`worktree prepare`、`patch collect`、`verify`、`review`、`commit`、`push`、`archive`、`reconcile`、`finalize` 等内部确定性动作。 |
| 主要产物 | `orchestrator-input.md`、`orchestrator-session.json`、`task-graph.json`、`dispatch-contracts.json`、`agent-runs.json`、`parallel-plan.json`、`parallel-execution.json`、agent handoff、provider receipts、QA/Review evidence、final gates、archive report |
| 关键判断 | 是否需要 brainstorming/product brief/requirement validation 由需求清晰度决定；是否并行由 task graph 和 write scope 决定；runtime 不自动推进、不做隐藏主脑。 |

工作流描述：

```text
用户提交需求
  -> Orchestrator / Intake 判断需求是否清晰
  -> 可选：brainstorming / clarify / product brief / validate requirement
  -> runtime 创建 run 并物化 request / analysis / orchestration context
  -> Project Analyzer / Architect 补齐项目与架构证据
  -> Product Planner / UX Designer 产出产品、UX、acceptance 边界
  -> Task Planner 使用 write-delivery-plan 生成 task graph
  -> implementation-readiness 检查是否可派发
  -> Orchestrator 写 orchestrator-session.json
  -> runtime 读取 session 并物化 dispatch contracts / agent-runs / parallel artifacts
  -> parallel-agent-dispatch 或 execute-task-plan 拉起 Dev / QA / Reviewer 等 Agent
  -> Agent handoff + provider-origin receipt + runtime gate 校验
  -> Merge Agent / Committer / runtime commit-push evidence
  -> Archive Confirmation / Archive Agent / runtime finalization
  -> 可选：observe / retrospective / project knowledge update
```

常见分支：

- 需求很清楚：可以跳过 `imfine-brainstorming`，但要记录 `brainstorming_skipped_reason`。
- 需求有产品或 UX 不确定性：先走 `imfine-brainstorming`、`imfine-product-brief`，UI/交互类可启用 `imfine-agent-ux-designer`。
- 需求存在关键歧义：走 `imfine-clarify` 或 `imfine-validate-requirement`。
- task graph 可并行：走 `imfine-parallel-agent-dispatch`。
- 行为可测试：Dev 阶段优先走 `imfine-tdd`。
- QA/Review/Runtime gate 失败：走 `imfine-systematic-debugging` 或 `imfine-correct-course`。
- 准备完成：走 `imfine-archive-confirmation`，再由 Archive Agent 和 runtime finalization 收敛。

### 2.4 `imfine-status`

只读状态和 blocker 观察工作流。

| 项目 | 内容 |
| --- | --- |
| 类型 | Public Workflow Entry |
| 源码 | `src/imfine-skills/2-run/imfine-status/` |
| 触发 | 用户查看当前 run 状态、gate、blocker、下一步 owner。 |
| 涉及 Agent | 通常不拉起子 Agent；由 Orchestrator 或当前会话解释状态。 |
| 涉及 Skill | 不要求内部 workflow；必要时可引导后续 `imfine-correct-course`、`imfine-implementation-readiness`、`imfine-observe` 或 `imfine-archive`。 |
| Runtime 动作 | `status --story`，必要时 `status --debug` |
| 主要产物 | 通常不写交付产物；读取 run 状态、gate、trace、debugger report、sandbox verification。 |
| 关键约束 | status 是只读视图，不推进 run state，不把 `run.json` 的 completed 当成唯一事实。 |

工作流描述：

```text
用户调用 imfine-status
  -> 解析目标 run；没有显式 run-id 时读取 .imfine/state/current.json
  -> runtime 输出 status --story
  -> 当前会话解释 run state、next owner、Agent progress、gates、blockers
  -> 如果用户需要诊断细节，再读取 status --debug
  -> 根据 blocker 类型建议下一入口或内部 workflow
```

常见分支：

- run 等待 Orchestrator 输出：提示需要补齐 `orchestrator-session.json`。
- planning / dispatch / handoff gate blocked：指向 Orchestrator、Task Planner 或对应 Agent。
- QA/Review blocked：指向 Dev fix loop、`imfine-systematic-debugging` 或 `imfine-code-review`。
- final gates / true harness blocked：指向 `imfine-archive-confirmation`、`imfine-observe` 或 provider receipt 修复。
- 用户只想看 demo 摘要：保持 story view，不展开 runtime debug 噪声。

### 2.5 `imfine-observe [run-id]`

Demo / true-harness 可观测性审计工作流。

| 项目 | 内容 |
| --- | --- |
| 类型 | Public Workflow Entry |
| 源码 | `src/imfine-skills/3-observe/imfine-observe/` |
| 触发 | 用户想观察 demo 做得怎么样，或验证 imfine 能力是否可信。 |
| 涉及 Agent | 优先拉起 `imfine-agent-harness-auditor`；若无原生子 Agent 能力，则当前会话运行 audit 并披露 fallback。 |
| 涉及 Skill | `imfine-harness-audit` |
| Runtime 动作 | `status --story`、`status --debug`、`report <run-id> --demo-summary` |
| 主要产物 | `.imfine/runs/<run-id>/analysis/demo-observation.md`，以及 verdict：`pass`、`pass_with_risks`、`blocked`、`misleading_demo` |
| 关键判断 | 观察 demo 时必须引用 runtime artifact，不接受自然语言自证；缺 provider-origin receipt 不能判定 true harness pass。 |

工作流描述：

```text
用户调用 imfine-observe
  -> 解析目标 run；没有 run-id 时读取 current run
  -> runtime 提供 status --story / status --debug / report --demo-summary
  -> 优先拉起 Harness Auditor Agent
  -> Harness Auditor 加载 imfine-harness-audit
  -> 审计 orchestrator session、dispatch、agent-runs、provider receipts、QA/Review evidence、final gates、true harness evidence
  -> 输出 demo verdict 和证据引用
  -> 必要时写 analysis/demo-observation.md
```

常见分支：

- provider-origin receipts、handoff、final gates、QA/Review evidence 都闭合：可判定 `pass`。
- 证据大体闭合但存在非阻断风险：判定 `pass_with_risks`。
- 关键证据缺失或 gate blocked，且 demo 暴露该事实：判定 `blocked`。
- 可见 demo 宣称成功但证据缺失、伪造、过期或互相矛盾：判定 `misleading_demo`。
- 当前 provider 无原生子 Agent 能力：当前会话运行 `imfine-harness-audit`，并披露 `auditor_execution=single_session_skill`。

### 2.6 `imfine-archive`

归档入口，确认 final gates 和 evidence chain。

| 项目 | 内容 |
| --- | --- |
| 类型 | Public Workflow Entry |
| 源码 | `src/imfine-skills/4-archive/imfine-archive/` |
| 触发 | run 已接近完成，需要归档、收敛 gate、输出 final report。 |
| 涉及 Agent | `imfine-agent-archive`、`imfine-agent-committer`、`imfine-agent-project-knowledge-updater`，必要时涉及 `imfine-agent-qa`、`imfine-agent-reviewer`、`imfine-agent-risk-reviewer` |
| 涉及 Skill | `imfine-archive-confirmation`，归档后可进入 `imfine-retrospective` |
| Runtime 动作 | `reconcile`、`finalize`、`archive`，以及 commit/push 相关内部动作 |
| 主要产物 | `orchestration/final-gates.json`、`archive/final-report.md`、`.imfine/reports/<run-id>.md`、project knowledge 更新候选 |
| 关键约束 | Archive Agent judgment 与 runtime archive finalization 必须分离；runtime-only receipt 不能证明 Archive Agent 已执行。 |

工作流描述：

```text
用户调用 imfine-archive
  -> 解析目标 run；没有 run-id 时读取 current run
  -> 检查 QA / Review / Risk / Committer / Project Knowledge evidence
  -> 加载 imfine-archive-confirmation 做 archive readiness 检查
  -> 必要时拉起 Archive Agent 形成 Agent-authored archive judgment
  -> runtime 执行 reconcile / finalize / archive 等确定性收敛动作
  -> 校验 final-gates.json 必须由 runtime 生成
  -> 输出 archive report、blocked items、follow-up owners
```

常见分支：

- 所有 required gates、provider receipts、QA/Review evidence、commit/push policy 闭合：归档为 completed。
- push 或用户批准缺失：保持 `ready_for_commit`、`awaiting_user_approval` 或 blocked，不伪装 completed。
- Archive Agent handoff 缺失：不能只靠 runtime archive finalization 证明完成。
- project knowledge 未更新或 freshness blocked：指派 `imfine-agent-project-knowledge-updater`。
- 归档后需要复盘：进入 `imfine-retrospective`，提取 project knowledge 和 harness evolution 候选。

## 3. 内部工作流 Skill

### 3.1 Discovery / Requirement 阶段

| Skill | 触发条件 | 主要 Agent | 关联 Skill | 主要输出 |
| --- | --- | --- | --- | --- |
| `imfine-brainstorming` | 需求开放、产品/UX/工作流不清晰、存在多个方案。 | `imfine-agent-intake`、`imfine-agent-product-planner`、`imfine-agent-ux-designer`、`imfine-agent-orchestrator` | 后续通常进入 `imfine-product-brief`、`imfine-write-delivery-plan`、`imfine-implementation-readiness` 或 `imfine-correct-course` | `analysis/brainstorming.md` 或 `project/brainstorming.md`，包含方向、假设、非目标、acceptance candidates。 |
| `imfine-clarify` | 需求存在 ambiguity、缺约束、验收不清或高风险解释。 | `imfine-agent-intake`、`imfine-agent-task-planner`、`imfine-agent-orchestrator` | 可前置于 `imfine-validate-requirement`、`imfine-write-delivery-plan` | normalized requirement、assumptions、ambiguities、acceptance candidates。 |
| `imfine-product-brief` | brainstorming 或 intake 后需要产品范围和验收结构。 | `imfine-agent-product-planner`、`imfine-agent-intake`、`imfine-agent-ux-designer` | 可接 `imfine-validate-requirement`、`imfine-write-delivery-plan` | `analysis/product-brief.md` 或 `project/product-brief.md`，Product Planner handoff fields。 |
| `imfine-validate-requirement` | requirement / product brief / PRD-like artifact 进入 architecture/task planning 前需要校验。 | `imfine-agent-intake`、`imfine-agent-product-planner`、`imfine-agent-orchestrator` | 失败时回到 `imfine-brainstorming`、`imfine-product-brief` 或 blocked；通过后进 architecture / task planning。 | `analysis/requirement-validation.md`、blockers、recommended next step。 |

### 3.2 Project / Planning 阶段

| Skill | 触发条件 | 主要 Agent | 关联 Skill | 主要输出 |
| --- | --- | --- | --- | --- |
| `imfine-project-analysis` | 需要读取现有项目证据、生成项目上下文。 | `imfine-agent-project-analyzer`、`imfine-agent-architect` | 支撑 `imfine-init`、`imfine-run`、`imfine-write-delivery-plan` | `project-context.md`、`architecture.md`、`tech-stack.md`、`module-map.md`、`test-strategy.md` |
| `imfine-write-delivery-plan` | 需求、产品范围、架构边界已经足够清楚，需要生成任务图。 | `imfine-agent-task-planner`、`imfine-agent-architect`、`imfine-agent-product-planner` | 可调用/依赖 `imfine-clarify`、`imfine-parallel-agent-dispatch`、`imfine-implementation-readiness` | `planning/task-graph.json`、Agent role plan、acceptance coverage plan、parallel/serial boundaries。 |
| `imfine-implementation-readiness` | Dev dispatch 前检查 requirement/product/architecture/task graph/evidence contract 是否就绪。 | `imfine-agent-task-planner`、`imfine-agent-architect`、`imfine-agent-qa`、`imfine-agent-ux-designer`、`imfine-agent-orchestrator` | 通过后进入 `imfine-parallel-agent-dispatch` 或 `imfine-execute-task-plan`；失败回到 clarify / product / architecture / task planning。 | `orchestration/implementation-readiness.md`，verdict：`ready`、`needs_replan`、`needs_clarification`、`blocked`。 |

### 3.3 Execution / Quality 阶段

| Skill | 触发条件 | 主要 Agent | 关联 Skill | 主要输出 |
| --- | --- | --- | --- | --- |
| `imfine-parallel-agent-dispatch` | task graph 中存在可并行任务或可独立推进的角色工作。 | `imfine-agent-orchestrator`、`imfine-agent-task-planner`、`imfine-agent-dev`、`imfine-agent-qa`、`imfine-agent-reviewer` | 使用 `imfine-execute-task-plan` 的 Dev/QA/Review loop；必要时回 `imfine-correct-course` | Agent assignments、locks、provider-origin receipts、parallel execution summary、handoff files。 |
| `imfine-execute-task-plan` | 已有可执行 task graph，需要通过 Dev / QA / Review 执行。 | `imfine-agent-dev`、`imfine-agent-qa`、`imfine-agent-reviewer`、`imfine-agent-orchestrator` | 可结合 `imfine-tdd`、`imfine-systematic-debugging`、`imfine-code-review` | task handoff、patch evidence、test evidence、QA handoff、Review handoff、fix loop evidence。 |
| `imfine-tdd` | 新增或修改具有可测试验收标准的行为。 | `imfine-agent-dev`、`imfine-agent-qa` | 失败时进入 `imfine-systematic-debugging`；完成后进入 QA / Review | test changes、implementation changes、test command evidence。 |
| `imfine-systematic-debugging` | tests/build/lint/review/merge/runtime checks 失败。 | `imfine-agent-dev`、`imfine-agent-qa`、`imfine-agent-reviewer` | 可由 `imfine-execute-task-plan`、`imfine-code-review`、`imfine-correct-course` 触发 | root cause、targeted fix、before/after command evidence、quality lineage recheck。 |
| `imfine-code-review` | task 实现后、重大功能完成后、archive 前或 fix loop 后需要 review。 | `imfine-agent-reviewer`、`imfine-agent-qa`、`imfine-agent-dev` | 发现 blocker 后进入 `imfine-systematic-debugging` 或 Dev fix loop | `evidence/review.md`、Reviewer handoff、severity-classified findings。 |
| `imfine-correct-course` | 用户改 scope、架构错误、task graph 不可执行、QA/Review blocker 需要 replan、provider/runtime evidence 阻断。 | `imfine-agent-orchestrator`、`imfine-agent-intake`、`imfine-agent-product-planner`、`imfine-agent-architect`、`imfine-agent-task-planner`、`imfine-agent-qa`、`imfine-agent-reviewer` | 可回到 `imfine-clarify`、`imfine-brainstorming`、`imfine-product-brief`、`imfine-write-delivery-plan`、`imfine-implementation-readiness` | `orchestration/course-correction.md`、changed assumptions、affected artifacts、owner actions。 |

### 3.4 Archive / Observe / Learning 阶段

| Skill | 触发条件 | 主要 Agent | 关联 Skill | 主要输出 |
| --- | --- | --- | --- | --- |
| `imfine-archive-confirmation` | 准备 archive/finalize 前确认 evidence chain。 | `imfine-agent-archive`、`imfine-agent-committer`、`imfine-agent-project-knowledge-updater`、`imfine-agent-qa`、`imfine-agent-reviewer`、`imfine-agent-risk-reviewer` | 通过后可走 runtime archive finalization；失败回到对应 owner | archive readiness、final gate checks、Archive Agent handoff、structured blockers。 |
| `imfine-harness-audit` | 观察 demo 质量和 true-harness 可信度。 | `imfine-agent-harness-auditor` | 由 `imfine-observe` 调用；必要时可反馈到 `imfine-correct-course` | verdict、failure evidence、root cause、targeted fix、predicted impact、regression risk。 |
| `imfine-retrospective` | archive 后、blocked run closure 后、非平凡 harness/demo validation 后。 | `imfine-agent-project-knowledge-updater`、`imfine-agent-archive`、`imfine-agent-harness-auditor`、`imfine-agent-orchestrator` | 可产生 project knowledge update 和 harness evolution 候选 | `archive/retrospective.md`、project knowledge candidates、harness evolution candidates、replay/test recommendations。 |

## 4. Agent 与常用 Skill 菜单关系

| Agent | 常用内部 Skill |
| --- | --- |
| `imfine-agent-orchestrator` | `imfine-init`、`imfine-run`、`imfine-status`、`imfine-observe`、`imfine-archive`、`imfine-parallel-agent-dispatch`、`imfine-write-delivery-plan`、`imfine-brainstorming`、`imfine-implementation-readiness`、`imfine-correct-course` |
| `imfine-agent-intake` | `imfine-brainstorming`、`imfine-validate-requirement`、`imfine-product-brief` |
| `imfine-agent-product-planner` | `imfine-brainstorming`、`imfine-product-brief`、`imfine-validate-requirement` |
| `imfine-agent-ux-designer` | `imfine-brainstorming`、`imfine-product-brief`、`imfine-implementation-readiness` |
| `imfine-agent-architect` | `imfine-write-delivery-plan`、`imfine-code-review` |
| `imfine-agent-task-planner` | `imfine-write-delivery-plan`、`imfine-parallel-agent-dispatch`、`imfine-clarify` |
| `imfine-agent-dev` | `imfine-execute-task-plan`、`imfine-tdd`、`imfine-systematic-debugging` |
| `imfine-agent-qa` | `imfine-execute-task-plan`、`imfine-systematic-debugging`、`imfine-code-review`、`imfine-implementation-readiness` |
| `imfine-agent-reviewer` | `imfine-code-review`、`imfine-systematic-debugging` |
| `imfine-agent-committer` | `imfine-archive-confirmation`、`imfine-status` |
| `imfine-agent-archive` | `imfine-archive-confirmation`、`imfine-harness-audit` |
| `imfine-agent-harness-auditor` | `imfine-harness-audit` |
| `imfine-agent-project-analyzer` | 通常由 `imfine-init`、`imfine-project-analysis` 或 Orchestrator 指派。 |
| `imfine-agent-risk-reviewer` | 通常由 Orchestrator / Architect / Task Planner 指派做风险审查。 |
| `imfine-agent-merge-agent` | 通常由 execution / archive 前集成阶段指派，负责合并 approved task patch。 |
| `imfine-agent-technical-writer` | 通常由 Orchestrator / Archive 阶段指派更新交付相关文档。 |
| `imfine-agent-project-knowledge-updater` | 通常由 archive / retrospective 阶段指派更新长期 project knowledge。 |

## 5. 公开入口之间的关系

6 个公开入口不是互相孤立的命令，而是同一条 harness 生命周期上的不同观察点和控制点：

```text
imfine-agent-orchestrator
  -> imfine-init
  -> imfine-run "<requirement>"
  -> imfine-status
  -> imfine-observe [run-id]
  -> imfine-archive
```

典型使用顺序：

- 首次进入项目：先用 `imfine-agent-orchestrator` 或直接 `imfine-init` 建立 `.imfine` project knowledge。
- 开始交付：用 `imfine-run "<requirement>"` 创建 run，并由 Orchestrator 决定内部 Agent / Workflow 编排。
- 执行中查看：用 `imfine-status` 查看当前 blocker、gate、next owner。
- 验证 demo 能力：用 `imfine-observe [run-id]` 审计 true-harness 证据和 demo 可信度。
- 收敛归档：用 `imfine-archive` 做 Archive Agent judgment 与 runtime finalization。

入口之间也可以按状态跳转：

- `imfine-status` 发现需求或 task graph 有问题时，Orchestrator 可转入 `imfine-correct-course`，再回到 `imfine-run` 的 planning / readiness 阶段。
- `imfine-observe` 判定 `blocked` 或 `misleading_demo` 时，Orchestrator 可转入 `imfine-correct-course` 或 `imfine-status` 定位 blocker。
- `imfine-archive` 发现 final gates 未闭合时，不继续归档，而是回到对应 owner：QA、Reviewer、Committer、Project Knowledge Updater 或 Orchestrator。

## 6. 关键边界

- 公开入口不是完整能力清单，只是用户界面。
- 内部 Agent / Workflow 是 Orchestrator 和公开 workflow 的工具箱。
- runtime 不负责选择 brainstorming、product brief、dispatch、QA、review 或 archive judgment。
- 是否需要某个内部 workflow，必须由 Orchestrator / Agent 根据当前需求、项目证据、run 状态和 gate evidence 决定。
- 内部 workflow 可以被 Orchestrator 加载和执行，但不应出现在 Codex / Claude 的用户入口列表里。
