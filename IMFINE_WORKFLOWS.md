# imfine 当前实现工作流流程图

生成时间：2026-05-06

本文档基于当前源码实现整理，描述 imfine 已存在的工作流。流程图使用 Mermaid，重点表达 Orchestrator、runtime action、model Agent handoff 和证据 gate 的实际关系。

## 图例

流程图中带颜色的节点表示一次 workflow 的“最终状态”或“显式停顿状态”：

- 绿色：已完成，当前 workflow 成功结束，或进入下一个主链路。
- 黄色：等待模型、等待依赖或等待外部条件，当前 runtime 不继续推进。
- 红色：阻塞，当前 workflow 不会继续执行后续 action，需要 Orchestrator 恢复、模型返工或外部条件修复。
- 蓝色：继续进入其他 workflow，不是失败状态。
- 灰色：内部调试或非用户主入口路径。

## 1. 用户主入口工作流

```mermaid
graph TD
  A["用户"] --> B{"选择入口"}

  B --> I["npx github install"]
  I --> I0["安装 imfine slash entry"]
  I0 --> I1["安装 Codex skill"]
  I0 --> I2["安装 Claude command"]
  I0 --> I3["安装 imfine runtime"]

  B --> INIT_CMD["/imfine init"]
  INIT_CMD --> INIT["初始化项目"]
  INIT --> INIT1["创建 .imfine 工作区"]
  INIT --> INIT2["同步 agents / skills / templates"]
  INIT --> INIT3{"已有项目"}
  INIT3 --> YES["是"]
  INIT3 --> NO["否"]
  YES --> INIT4["生成架构草稿和 Architect Agent 输入"]
  NO --> INIT5["保留空项目初始化结构"]
  INIT --> INIT6["doctor 基础设施检查"]

  B --> RUN_CMD["/imfine run 需求或文件"]
  RUN_CMD --> RUN["创建 Delivery Run"]
  RUN --> AUTO["自动编排 runAutoOrchestrator"]

  B --> STATUS_CMD["/imfine status"]
  STATUS_CMD --> STATUS["读取当前 workspace / run 状态"]

  B --> REPORT_CMD["/imfine report run-id"]
  REPORT_CMD --> REPORT["读取归档报告"]

  B --> ARCHIVE_CMD["/imfine archive run-id"]
  ARCHIVE_CMD --> ARCHIVE_MANUAL["显式归档恢复"]

  classDef completed fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef next fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
  class I1,I2,I3,INIT4,INIT5,INIT6,STATUS,REPORT,ARCHIVE_MANUAL completed;
  class AUTO next;
```

## 2. Delivery Run 创建工作流

```mermaid
flowchart TD
  A[/imfine run 输入/] --> B[initProject]
  B --> C[读取需求来源]
  C --> C1{文本还是文件}
  C1 -->|文本| C2[保存原始输入]
  C1 -->|文件| C3[读取需求文档内容]

  C2 --> D[项目分析]
  C3 --> D
  D --> D1{项目类型}
  D1 -->|空目录| D2[new_project]
  D1 -->|已有文件| D3[existing_project]

  D --> E[创建 .imfine/runs/run-id]
  E --> F[写 request 产物]
  F --> G[写 analysis 产物]
  G --> H[写 design 产物]
  H --> I[planRun 生成 task graph]
  I --> J[写 tasks / ownership / execution-plan / commit-plan]
  J --> K[更新 current run]
  K --> L[进入自动编排]

  classDef next fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
  class L next;
```

## 3. 自动编排总工作流

```mermaid
flowchart TD
  A[runAutoOrchestrator] --> B[resumeRun 计算 next actions]
  B --> C[获取 run lock]
  C -->|失败| C1[blocked: run lock held]
  C -->|成功| D[读取 latest checkpoint]
  D --> E{循环到 maxIterations}

  E --> F[重新 resumeRun]
  F --> G{存在 ready action?}
  G -->|否且 archived| Z[completed]
  G -->|否且未 archived| W[waiting_for_model]

  G -->|有 blocked gate| BG[blocked: gate action]
  BG --> BG1[run -> needs_infrastructure_action]

  G -->|有 ready action| H[获取 action lock]
  H -->|失败| H1[blocked: action lock held]
  H -->|成功| I{action kind}

  I -->|runtime| R[执行确定性 runtime action]
  I -->|agent| M{当前会话能执行 Agent?}
  I -->|agent-archive| AR[执行 archive runtime 并校验 archive handoff]

  M -->|否或需要等待| M1[准备 Agent 执行包]
  M1 --> W
  M -->|是| M2[当前会话执行或分发 Agent]
  M2 --> M3{Agent handoff 是否写回}
  M3 -->|否| M4[blocked]
  M3 -->|是| M5[消费对应 Agent handoff]

  R --> R1{结果}
  AR --> R1
  M5 --> R1

  R1 -->|completed| E
  R1 -->|waiting_for_model| W
  R1 -->|blocked/failed| X[blocked]

  classDef completed fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  class Z completed;
  class W waiting;
  class C1,BG,BG1,H1,M4,X blocked;
```

状态说明：

- `completed`：当前 auto loop 已经没有待执行 action，且 run 已归档。
- `waiting_for_model`：runtime 已准备好 Agent 执行包，但当前会话还没有完成对应 Agent 工作，或缺少模型 handoff / 可继续推进的模型结果。
- `blocked`：当前 action 不适合继续执行，原因可能是 gate、lock、handoff 或模型执行失败。
- `run lock held`：同一个 run 已有另一个自动编排进程在推进，本次调用不执行任何 action，避免重复 commit、push 或写坏 run 状态。
- `action lock held`：某个 action 正在执行，本次调用不重复执行该 action。
- `needs_infrastructure_action`：doctor 或 gate 发现基础设施问题，runtime 已写 evidence，等待修复或后续恢复。

## 4. Orchestrator Action 生成工作流

```mermaid
flowchart TD
  A[resumeRun] --> B[doctor]
  B --> C{基础设施有 fail?}
  C -->|是| C1[生成 gate-infrastructure]

  C -->|否| D{task graph 是否存在?}
  D -->|否| E[Discovery Agents 并行]
  E --> E1[Intake]
  E --> E2[Project Analyzer]
  E --> E3[Product Planner]
  E --> E4[Architect]
  E1 --> F[Task Planner]
  E2 --> F
  E3 --> F
  E4 --> F
  E1 --> G[Risk Reviewer]
  E2 --> G
  E3 --> G
  E4 --> G
  F --> H[runtime-plan]

  D -->|存在| I{run 是否 needs_conflict_resolution?}
  I -->|是| I1[Conflict Resolver Agent]

  I -->|否| J{task graph 是否合法?}
  J -->|否| J1[Task Planner Replan]

  J -->|是| K[inferTaskActions]
  K --> L{worktree 是否准备?}
  L -->|否| L1[可选 runtime-dependency-install]
  L1 --> L2[runtime-worktree-prepare]
  L -->|是| M[按 task layer 推进 Dev/QA/Review]

  M --> N{所有任务 Review approved 或已 committed?}
  N -->|否| M
  N -->|是且无 commits| O[Committer Agent]
  O --> P[runtime-commit-run]
  N -->|是且有 commits 无 push_status| Q[runtime-push-run]
  N -->|是且有 push_status| R[Archive 支撑 Agent 并行]
  R --> R1[Technical Writer]
  R --> R2[Project Knowledge Updater]
  R1 --> S[Archive Agent]
  R2 --> S

  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef next fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
  class C1 blocked;
  class I1,J1 waiting;
  class H,P,Q,S next;
```

状态说明：

- `gate-infrastructure`：基础设施检查失败时生成的阻塞 gate，通常来自 git、remote、push 权限、包管理器或测试命令问题。
- `Conflict Resolver Agent`：run 已进入 `needs_conflict_resolution`，下一步应由冲突解决 Agent 处理。
- `Task Planner Replan`：task graph 校验失败时进入重新规划，不继续执行不可靠任务图。
- 蓝色节点表示进入其他 workflow，例如 runtime plan、commit、push 或 archive。

## 5. 任务执行 / QA / Review / 返工工作流

```mermaid
flowchart TD
  A[task graph] --> B[runtime-worktree-prepare]
  B --> C[为每个任务创建独立 worktree]
  C --> D{任务依赖是否 ready?}
  D -->|否| D1[等待依赖]
  D -->|是| E[Dev 或 Technical Writer Agent]

  E --> F[模型在任务 worktree 修改]
  F --> G[runtime collectPatch]
  G --> H[patch validate]
  H -->|失败| H1[Dev handoff blocked]
  H -->|通过| I[Dev handoff ready]

  I --> J[QA Agent]
  J --> K[读取 QA handoff]
  K --> L{QA status}
  L -->|pass| M[写 test-results evidence]
  L -->|fail| L1[创建 scoped fix task]
  L1 --> L2[run -> needs_dev_fix]
  L -->|blocked| L3[run blocked]

  M --> N[Reviewer Agent]
  N --> O[读取 Reviewer handoff]
  O --> P{Review status}
  P -->|approved| Q[任务 Review 通过]
  P -->|changes_requested| P1[创建 scoped fix task]
  P1 --> P2[run -> needs_dev_fix]
  P -->|blocked| P3[run blocked]

  classDef completed fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  class Q completed;
  class L2,P2 waiting;
  class H1,L3,P3 blocked;
```

状态说明：

- `Dev handoff blocked`：patch 收集或校验失败，不能进入 QA。
- `needs_dev_fix`：QA fail 或 Review changes_requested 后，系统已生成 scoped fix task；后续由 Orchestrator 继续调度 Dev / QA / Review，不依赖固定重试次数的人为阻塞。
- `run blocked`：QA 或 Review 明确 blocked，当前任务链路停止，等待模型或外部条件解决阻塞点。
- `任务 Review 通过`：该任务满足 commit 前的 QA / Review gate。

## 6. Risk Reviewer 工作流

```mermaid
flowchart TD
  A[Orchestrator] --> B{触发时机}
  B -->|规划阶段| C[与 Task Planner 并行]
  B -->|实现边界阶段| D[与 Dev / Writer Agent 并行]

  C --> E[Risk Reviewer Agent]
  D --> E
  E --> F[输出 agents/risk-reviewer/handoff.json]
  F --> G{handoff status}
  G -->|ready| H[继续主链路]
  G -->|blocked| I[run blocked]
  G -->|needs_replan| J[run -> needs_task_replan]

  classDef completed fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  class H completed;
  class J waiting;
  class I blocked;
```

状态说明：

- `ready`：Risk Reviewer 认为当前风险可接受，主链路继续。
- `blocked`：风险不可接受，run 阻塞，等待模型或外部条件解决。
- `needs_task_replan`：Risk Reviewer 要求重新规划任务边界或执行计划，后续进入 Task Planner replan。

## 7. 冲突解决工作流

```mermaid
flowchart TD
  A[runtime commit apply patch] --> B{patch 是否可应用?}
  B -->|是| C[继续 commit]
  B -->|否| D[记录 conflicts evidence]
  D --> E[run/task -> needs_conflict_resolution]
  E --> F[生成 Conflict Resolver input]
  F --> G[Conflict Resolver Agent]
  G --> H[读取 handoff]
  H --> I{handoff status}
  I -->|blocked| I1[保持 needs_conflict_resolution]
  I -->|resolved| J[post-conflict QA]
  J --> K{QA pass?}
  K -->|否| K1[blocked]
  K -->|是| L[post-conflict Review]
  L --> M{Review approved?}
  M -->|否| M1[blocked]
  M -->|是| N[commitResolvedRun]
  N --> O[继续 push / archive]

  classDef completed fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  class C,O completed;
  class I1 waiting;
  class K1,M1 blocked;
```

状态说明：

- `needs_conflict_resolution`：runtime commit 阶段 patch apply 失败，已生成 Conflict Resolver input 和 conflicts evidence。
- `保持 needs_conflict_resolution`：Conflict Resolver handoff 为 blocked，run 保持冲突待解决状态。
- `post-conflict QA / Review`：Conflict Resolver handoff 为 resolved 后，runtime 会自动执行冲突后的 QA 和 Review gate。
- `继续 push / archive`：resolved commit 成功后，回到后续 push / archive 主链路。

## 8. Commit / Push 工作流

```mermaid
flowchart TD
  A[所有任务 QA pass 且 Review approved] --> B[Committer Agent]
  B --> C[读取 agents/committer/handoff.json]
  C --> D{Committer status}
  D -->|blocked| D1[run blocked, 不推进 commit]
  D -->|ready| E[runtime-commit-run]

  E --> F{commit mode}
  F -->|task| F1[按任务生成 task commit]
  F -->|integration| F2[生成 integration commit]
  F1 --> G[写 commits evidence]
  F2 --> G
  G --> H[runtime-push-run]

  H --> I{push 结果}
  I -->|pushed| J[记录 push status pushed]
  I -->|no remote| K[push_blocked_no_remote]
  I -->|permission| L[push_blocked_permission]
  I -->|network| M[有限重试后 push_blocked_network]
  I -->|branch conflict| N[push_blocked_branch_conflict]
  I -->|其他失败| O[push_blocked_failed]

  J --> P[进入归档]
  K --> P
  L --> P
  M --> P
  N --> P
  O --> P

  classDef completed fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  class J,P completed;
  class K,L,M,N,O waiting;
  class D1 blocked;
```

状态说明：

- `run blocked, 不推进 commit`：Committer handoff 为 blocked，runtime 不执行 commit。
- `push_blocked_no_remote`：没有 `origin` remote。
- `push_blocked_permission`：remote 或凭证权限不足。
- `push_blocked_network`：网络问题，runtime 有有限重试，仍失败后记录该状态。
- `push_blocked_branch_conflict`：远端分支冲突，不能盲目覆盖。
- `push_blocked_failed`：未能归入明确分类的 push 失败。
- `push_blocked_*` 不一定阻止归档；归档报告会记录本地 commit、目标分支和用户后续动作。

## 9. 归档和长期知识更新工作流

```mermaid
flowchart TD
  A[push_status 已存在] --> B[Archive 支撑 Agent 并行]
  B --> C[Technical Writer]
  B --> D[Project Knowledge Updater]

  C --> C1[technical-writer handoff]
  D --> D1[project-knowledge-updater handoff]

  C1 --> E{Technical Writer status}
  D1 --> F{Knowledge Updater status}

  E -->|ready/not_needed| G[Archive Agent]
  E -->|blocked| E1[run blocked]
  F -->|ready| G
  F -->|blocked| F1[run blocked]

  G --> H[archiveRun]
  H --> I[检查 requirement/design/task/QA/review/commit/push evidence]
  I --> J{证据完整?}
  J -->|否| J1[archive blocked]
  J -->|是| K[写 archive-report.md]
  K --> L[写 .imfine/reports/run-id.md]
  L --> M[更新 .imfine/project/**]
  M --> N[写 archive handoff]
  N --> O[run archived]

  classDef completed fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  class O completed;
  class E1,F1,J1 blocked;
```

状态说明：

- `Technical Writer blocked`：归档前文档整理不可继续，Archive 不应直接消费不完整文档结论。
- `Project Knowledge Updater blocked`：项目长期知识更新不可确认，Archive 不应写入未验证知识。
- `archive blocked`：Archive evidence 不完整，归档报告会记录缺失项，但不会把未验证结论沉淀到长期知识库。
- `run archived`：归档完成，已写 `.imfine/reports/<run-id>.md` 并更新 `.imfine/project/**`。

## 10. 新项目工作流

```mermaid
flowchart TD
  A[/imfine run 需求/] --> B{项目是否为空?}
  B -->|否| C[走已有项目 Delivery Run]
  B -->|是| D[createDeliveryRun 标记 new_project]
  D --> E[New Project Agent Planning]
  E --> F{当前会话能执行规划 Agent?}
  F -->|否或需要等待| F1[waiting_for_model, 生成 Architect/Task Planner prompt]
  F -->|是| G[Architect Agent 决定 stack]
  G --> H[Task Planner Agent 生成 task graph]
  H --> I{stack-decision 和 task graph 是否有效?}
  I -->|否| I1[blocked]
  I -->|是| J[ensureGitRepository]
  J --> K[runAutoOrchestrator]
  K --> L[按通用任务执行 / QA / Review / Commit / Push / Archive 工作流推进]

  A -. 内部 debug .-> X[/imfine run --deliver/]
  X --> Y[确定性生成最小 Node 项目]
  Y --> Z[执行 patch/QA/review/commit/push/archive]

  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  classDef next fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
  classDef debug fill:#f3f4f6,stroke:#6b7280,color:#374151;
  class F1 waiting;
  class I1 blocked;
  class C,L next;
  class X,Y,Z debug;
```

状态说明：

- `waiting_for_model`：新项目主路径需要当前大模型会话执行 Architect / Task Planner Agent 来决定 stack 和 task graph；如果暂未执行，只生成 prompt 包，不由 runtime 硬编码选择技术栈。
- `blocked`：模型输出的 `stack-decision` 或 `task-graph` 不合法，不能继续生成项目。
- `--deliver`：内部 debug 路径，会确定性生成最小 Node 项目；它不是用户主 harness 工作流。

## 11. 恢复和等待工作流

```mermaid
flowchart TD
  A[orchestrate run-id] --> B[读取 action ledger]
  B --> C[读取 latest checkpoint]
  C --> D[跳过已 completed action]
  D --> E{下一步是否可执行?}
  E -->|依赖未完成| E1[waiting_for_model 或等待依赖]
  E -->|handoff 缺失| E2[waiting_for_model]
  E -->|lock 被占用| E3[blocked]
  E -->|gate blocked| E4[needs_infrastructure_action]
  E -->|可执行| F[执行下一 action]
  F --> G[写 checkpoint]
  G --> H[更新 action ledger]
  H --> I[继续循环]

  R[resume run-id] --> S[重新计算 next actions]
  S --> T[输出 Orchestrator 状态]

  classDef completed fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef waiting fill:#fef9c3,stroke:#ca8a04,color:#713f12;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  classDef next fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
  class E1,E2 waiting;
  class E3,E4 blocked;
  class I next;
  class T completed;
```

状态说明：

- `waiting_for_model 或等待依赖`：当前 action 还缺少模型 handoff、当前会话的 Agent 执行结果或上游依赖 evidence。
- `lock 被占用`：run 或 action 正在被其他编排进程执行，本次调用不重复执行。
- `needs_infrastructure_action`：基础设施 gate blocked，等待修复后再继续 orchestrate。
- `resume run-id`：当前实现是重新计算并输出 next actions；真正自动推进恢复链路的是 `orchestrate run-id` 或 `/imfine run` 内部调用的 auto orchestrator。

## 12. 工作流边界说明

- 用户主入口聚焦 `/imfine init`、`/imfine run`、`/imfine status`、`/imfine report`、`/imfine archive`。
- `plan`、`worktree`、`patch`、`verify`、`review`、`commit`、`push`、`agents prepare/execute` 等命令是 runtime 内部或调试恢复入口。
- 当前 `/imfine run` 默认进入自动编排；当遇到 Agent action 时，runtime 准备 prompt 包，当前 Codex / Claude 大模型会话负责执行或分发 Agent 工作并写回 handoff。
- `resume <run-id>` 当前重新计算 Orchestrator next actions；真正自动执行恢复链路的是 `orchestrate <run-id>` 或 `/imfine run` 内部调用的 auto orchestrator。
- 新项目主路径依赖模型 Agent 做 stack 和 task graph 决策；`--deliver` 是内部 debug 路径，包含确定性最小 Node 项目生成逻辑。
