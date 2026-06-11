# imfine BMAD 风格整体迁移方案

## 0. 迁移结论

本次迁移是 **按照 BMAD 的实现方式重构 imfine 的 Agent / Workflow / Skill 表达方式**，不是削减 imfine 能力，也不是只迁移 `observe`。

迁移后的目标是：

- 实现方式对齐 BMAD：每个 Agent、Workflow 都是独立 Skill package，包含 `SKILL.md` 和 `customize.toml`。
- 安装方式保持 imfine 当前入口：继续通过 `npx github:ZongxingH/im-fine install ...` 安装。
- 使用方式对齐 BMAD：Codex / Claude 会话中可直接调用 `imfine-agent-*` 和 `imfine-*` skill / slash command。
- 原功能不缺失：以 `docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md` 中记录的当前能力为迁移基线。
- 旧 flat `library/agents/*.md` 和 `library/skills/*.md` 不再作为行为来源；其内容要全量迁移到 BMAD-style package。

一句话：**只换实现方式，不删原功能。**

## 1. 对齐基线

迁移前必须同时对齐以下两个来源：

- `docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md`：当前 imfine 功能、Agent/Skill 名册、runtime/Agent 边界、gate、证据链、可观测性和测试覆盖的权威基线。
- 当前历史 flat library：迁移前已有 `library/agents/*.md` 和 `library/skills/*.md` 的角色与 workflow 内容。

本迁移计划不得用少量示例替代完整清单。任何实现阶段如果发现当前代码、测试或文档与 phased plan 冲突，默认以 phased plan 的功能基线为准，除非用户明确批准移除某项能力。

## 2. 原功能保留清单

### 2.1 Agent 全量名册

BMAD-inspired Agent 必须全量迁移：

```text
orchestrator
intake
project-analyzer
product-planner
architect
task-planner
dev
qa
reviewer
risk-reviewer
merge-agent
committer
archive
technical-writer
project-knowledge-updater
```

AHE / imfine-specific 观察型 Agent 必须保留：

```text
harness-auditor
```

因此迁移后至少应存在以下 16 个 Agent Skill package：

```text
src/imfine-skills/agents/imfine-agent-orchestrator/
src/imfine-skills/agents/imfine-agent-intake/
src/imfine-skills/agents/imfine-agent-project-analyzer/
src/imfine-skills/agents/imfine-agent-product-planner/
src/imfine-skills/agents/imfine-agent-architect/
src/imfine-skills/agents/imfine-agent-task-planner/
src/imfine-skills/agents/imfine-agent-dev/
src/imfine-skills/agents/imfine-agent-qa/
src/imfine-skills/agents/imfine-agent-reviewer/
src/imfine-skills/agents/imfine-agent-risk-reviewer/
src/imfine-skills/agents/imfine-agent-merge-agent/
src/imfine-skills/agents/imfine-agent-committer/
src/imfine-skills/agents/imfine-agent-archive/
src/imfine-skills/agents/imfine-agent-technical-writer/
src/imfine-skills/agents/imfine-agent-project-knowledge-updater/
src/imfine-skills/agents/imfine-agent-harness-auditor/
```

只保留 `orchestrator/dev/qa/reviewer/harness-auditor` 这 5 个 Agent 不合格。

当前按 Superpowers / BMAD 进一步吸收后，允许并已经新增可选 Agent：

```text
src/imfine-skills/agents/imfine-agent-ux-designer/
```

因此当前增强名册为 17 个 Agent，其中 16 个是原功能保留基线，`imfine-agent-ux-designer` 是 UI/体验类需求的条件启用 Agent。

### 2.2 Workflow / Skill 全量名册

Superpowers-inspired Skill 必须全量迁移：

```text
clarify
project-analysis
write-delivery-plan
execute-task-plan
tdd
systematic-debugging
parallel-agent-dispatch
code-review
archive-confirmation
```

AHE / imfine-specific Skill 必须保留：

```text
harness-audit
```

因此迁移后至少应存在以下 10 个 Workflow Skill package：

```text
src/imfine-skills/workflows/imfine-clarify/
src/imfine-skills/workflows/imfine-project-analysis/
src/imfine-skills/workflows/imfine-write-delivery-plan/
src/imfine-skills/workflows/imfine-execute-task-plan/
src/imfine-skills/workflows/imfine-tdd/
src/imfine-skills/workflows/imfine-systematic-debugging/
src/imfine-skills/workflows/imfine-parallel-agent-dispatch/
src/imfine-skills/workflows/imfine-code-review/
src/imfine-skills/workflows/imfine-archive-confirmation/
src/imfine-skills/workflows/imfine-harness-audit/
```

只保留 `project-analysis/write-delivery-plan/execute-task-plan/code-review/harness-audit/archive-confirmation` 这 6 个 Workflow 不合格。

当前按 imfine 目标继续吸收 Superpowers / BMAD 后，新增以下 Workflow：

```text
src/imfine-skills/workflows/imfine-brainstorming/
src/imfine-skills/workflows/imfine-product-brief/
src/imfine-skills/workflows/imfine-validate-requirement/
src/imfine-skills/workflows/imfine-implementation-readiness/
src/imfine-skills/workflows/imfine-correct-course/
src/imfine-skills/workflows/imfine-retrospective/
```

因此当前增强名册为 16 个 Workflow，其中 10 个是原功能保留基线，新增 6 个用于 discovery、product brief、requirement validation、implementation readiness、course correction 和 retrospective。

### 2.3 用户公开快捷入口

公共快捷入口至少包括：

```text
imfine-agent-orchestrator
imfine-init
imfine-run
imfine-status
imfine-observe
imfine-archive
```

Claude 中对应 slash command pointer：

```text
/imfine-agent-orchestrator
/imfine-init
/imfine-run
/imfine-status
/imfine-observe
/imfine-archive
```

Codex 中对应 native skill：

```text
imfine-agent-orchestrator
imfine-init
imfine-run
imfine-status
imfine-observe
imfine-archive
```

同时，安装后也必须像 BMAD 一样暴露所有 Agent / Workflow package 的同名入口，不能只安装上述 6 个快捷入口。

## 3. 目标目录结构

```text
.claude-plugin/marketplace.json
src/imfine-skills/module.yaml

src/imfine-skills/0-core/imfine-help/SKILL.md

src/imfine-skills/1-bootstrap/imfine-init/SKILL.md
src/imfine-skills/1-bootstrap/imfine-init/customize.toml

src/imfine-skills/2-run/imfine-run/SKILL.md
src/imfine-skills/2-run/imfine-run/customize.toml
src/imfine-skills/2-run/imfine-status/SKILL.md
src/imfine-skills/2-run/imfine-status/customize.toml

src/imfine-skills/3-observe/imfine-observe/SKILL.md
src/imfine-skills/3-observe/imfine-observe/customize.toml

src/imfine-skills/4-archive/imfine-archive/SKILL.md
src/imfine-skills/4-archive/imfine-archive/customize.toml

src/imfine-skills/agents/imfine-agent-*/SKILL.md
src/imfine-skills/agents/imfine-agent-*/customize.toml

src/imfine-skills/workflows/imfine-*/SKILL.md
src/imfine-skills/workflows/imfine-*/customize.toml

src/imfine-skills/templates/
src/imfine-skills/references/
```

`agents/` 和 `workflows/` 下的 `*` 必须覆盖第 2 节全量名册。

## 4. 安装兼容要求

唯一支持的安装入口继续是：

```text
npx github:ZongxingH/im-fine install
npx github:ZongxingH/im-fine install --target codex
npx github:ZongxingH/im-fine install --target claude
npx github:ZongxingH/im-fine install --target all
npx github:ZongxingH/im-fine install --target all --lang zh
npx github:ZongxingH/im-fine install --target all --lang en
npx github:ZongxingH/im-fine install --dry-run
```

安装命令保持兼容，但安装后的文件结构对齐本机 BMAD 的实际形态：

```text
Shared native skills:
  ~/.agents/skills/imfine-agent-*/SKILL.md
  ~/.agents/skills/imfine-*/SKILL.md

Claude slash command pointers:
  ~/.claude/commands/imfine-agent-*.md
  ~/.claude/commands/imfine-*.md

Runtime:
  ~/.imfine/runtime
```

兼容含义：

- `install` 命令不变。
- `--target codex|claude|all` 不变。
- `--lang zh|en` 不变。
- `--dry-run` 不变。
- `~/.imfine/runtime` 路径不变。
- Codex 通过 `~/.agents/skills/imfine-*` 发现 imfine Agent / Workflow skills。
- Claude 通过 `~/.claude/commands/imfine-*.md` slash command pointer 进入对应 imfine skill。
- 安装后不再用单个旧 `~/.codex/skills/imfine/SKILL.md` 承载主行为。

不兼容内容：

- 不继续安装旧 `library/agents/*.md` 作为 Agent 行为来源。
- 不继续安装旧 `library/skills/*.md` 作为 Skill 行为来源。
- 不维护 flat library 与 BMAD-style package 两套行为来源。

## 5. BMAD 实现方式要求

### 5.1 Agent 即 Skill

每个 Agent package 必须包含：

```text
SKILL.md
customize.toml
```

`SKILL.md` 负责：

- 说明该 Agent 的触发条件和职责。
- 加载 `customize.toml` 中的 persona、activation、persistent facts 和 menu。
- 按 BMAD 风格执行 activation flow。
- 分发到对应 Workflow Skill 或要求用户确认下一步。

`customize.toml` 至少表达：

- role / identity
- persona
- communication style
- principles
- persistent facts
- activation steps
- menu items

BMAD 风格激活流程必须包含：

1. 解析 agent block。
2. 执行 `activation_steps_prepend`。
3. 采用 persona。
4. 加载 persistent facts。
5. 加载 imfine 配置。
6. 问候或确认用户意图。
7. 执行 `activation_steps_append`。
8. 匹配菜单项并分发，或展示菜单等待用户选择。

### 5.2 Workflow 即 Skill

每个 Workflow package 必须包含：

```text
SKILL.md
customize.toml
```

`customize.toml` 至少包含 `[workflow]` block：

```toml
[workflow]
activation_steps_prepend = []
activation_steps_append = []
persistent_facts = [
  "file:{project-root}/.imfine/project/**/*.md"
]
on_complete = ""
```

Workflow Skill 承载原 `library/skills/*.md` 的行为说明、纪律和步骤；runtime 命令只能作为后端机械操作被调用，不能替代 Workflow 的判断与编排。

### 5.3 module.yaml

`src/imfine-skills/module.yaml` 必须声明：

- imfine module code / name / description
- `.imfine` 相关目录
- 全量 Agent roster
- 可安装 skill package
- 必要变量与默认选项

`agents:` 字段必须覆盖第 2.1 节的 16 个基础 Agent；如果启用了当前增强名册，还必须包含 `imfine-agent-ux-designer`，不得只列示例。

### 5.4 marketplace.json

`.claude-plugin/marketplace.json` 只列出公开入口 package：

- `imfine-agent-orchestrator`
- `imfine-init`
- `imfine-run`
- `imfine-status`
- `imfine-observe`
- `imfine-archive`

完整 Agent / Workflow package 必须保留在源码和 runtime 内部库中，但不得进入 marketplace / Codex / Claude 用户入口列表。

## 6. Runtime 保留边界

Node runtime 保留的原因不是继续承载 Agent/Skill 行为，而是保留 Agent/Skill 不适合且不能可靠完成的确定性后端能力。

迁移后，runtime 必须继续保留 phased plan 已记录的能力，包括但不限于：

- 初始化 `.imfine/`。
- 创建 run。
- 物化 request / analysis / orchestration 上下文。
- 读取并校验 `orchestrator-session.json`。
- 物化并校验 `dispatch-contracts.json`。
- 物化并校验 `agent-runs.json`。
- 物化 `parallel-plan.json`。
- 物化 `parallel-execution.json`。
- 准备 worktree。
- 收集和校验 patch。
- 记录状态迁移。
- 执行 commit / push / runtime archive finalization。
- 收敛 reconcile / finalize gate。
- 校验 Agent-authored acceptance matrix。
- 生成 final report 和结构化 fix task。
- 写出 true harness evidence 和 reports。
- 校验 provider-origin receipts。
- 校验 handoff schema 与 evidence 引用。
- 校验 role purity / authorship 边界。
- 维护 quality lineage / recheck fix loop。
- 维护 runtime requirements。
- 维护 sandbox verification。
- 维护 harness component registry。
- 维护 harness config / experiment / evolution records。
- 写入 runtime trace JSONL。
- 生成 harness debugger report。
- 支撑 smoke、fixture replay、demo replay 和 H-001 到 H-016 回归覆盖。

这些 TypeScript runtime 能力不能因为迁移到 BMAD-style Agent/Skill 而删除。

必须迁出 runtime 或旧 library 的能力：

- Agent persona。
- Agent activation。
- Agent menu。
- Workflow 步骤说明。
- Skill 触发说明。
- 角色行为规则。
- Orchestrator 用户交互入口。
- Demo observe / harness audit 的判断流程。
- 面向 Codex / Claude 的 skill 暴露方式。

边界规则：

- Skills 和 Agents 负责判断、编排、角色行为和用户可见工作流。
- Runtime 只负责确定性的状态、schema、证据、gate、archive、trace、fixture 和测试支撑。
- Runtime 不能用 runtime-only receipt 替代 provider-native agent execution。
- Skill 可以调用 runtime 命令作为后端操作，但不能把 runtime 命令作为主要交互模型暴露给用户。
- 迁移完成后，不再维护 `library/agents/*.md` 和 `library/skills/*.md` 作为可用行为来源。

## 7. Orchestrator 与快捷 Workflow

`imfine-agent-orchestrator` 是主入口，因为它对应 phased plan 中唯一编排决策源：当前会话中的 Orchestrator Agent。

Orchestrator 不替代 runtime，也不替代具体 Agent。它负责：

- 加载项目上下文。
- 读取当前 run 状态。
- 展示菜单。
- 根据用户意图分发到 init / run / status / observe / archive。
- 在 full run 中组织 intake、analysis、planning、dev、qa、review、risk、merge、commit、archive、project knowledge update 等角色。

`imfine-agent-orchestrator/customize.toml` 至少暴露：

```toml
[[agent.menu]]
code = "INIT"
description = "Initialize imfine project context and runtime workspace"
skill = "imfine-init"

[[agent.menu]]
code = "RUN"
description = "Run the full multi-agent imfine delivery workflow"
skill = "imfine-run"

[[agent.menu]]
code = "STATUS"
description = "Inspect current run status, gates, and blockers"
skill = "imfine-status"

[[agent.menu]]
code = "OBSERVE"
description = "Audit demo quality and true-harness observability"
skill = "imfine-observe"

[[agent.menu]]
code = "ARCHIVE"
description = "Confirm final gates and archive the run"
skill = "imfine-archive"
```

快捷 Workflow 只是入口便利性，不是第二套主脑。

## 8. init / run / status / observe / archive 要求

### 8.1 imfine-init

`imfine-init` 是 BMAD-style workflow skill。它通过 Agent/Skill 编排完成项目初始化，但初始化后的 `.imfine` 产物必须与当前实现兼容。

职责分工：

```text
imfine-init workflow / Orchestrator / Project Analyzer / Architect
  负责：项目理解、证据收集、架构分析、初始化说明、调用顺序

Node runtime
  负责：创建 .imfine 目录、写标准状态文件、写标准 project artifacts、校验结构
```

必须保持兼容的初始化产物包括：

```text
.imfine/
.imfine/state/current.json
.imfine/project/
.imfine/project/architecture.md
.imfine/project/tech-stack.md
.imfine/project/module-map.md
.imfine/project/test-strategy.md
.imfine/project/project-context.md
.imfine/project/freshness.json
.imfine/debug/
```

### 8.2 imfine-run

`imfine-run` 必须保持 phased plan 当前 true harness 主路径：

- run 创建后进入 `waiting_for_agent_output`。
- orchestrator session 是唯一编排真相源。
- `decision_source=orchestrator_agent`。
- `execution_mode=true_harness`。
- `harness_classification=true_harness`。
- runtime 不生成第二套 task graph 主语义。
- native subagent 不可用时应 blocked，而不是静默降级为 single-session fallback。

### 8.3 imfine-status

`imfine-status` 必须继续从 runtime artifacts 派生 gate 状态，而不是只看文件是否存在。

它至少应读取或展示：

- current run。
- action / agent run 状态。
- final gates。
- true harness evidence。
- provider receipt 状态。
- handoff validation。
- blocker summary。
- harness debugger report。
- sandbox / runtime requirements mismatch。

### 8.4 imfine-observe

`imfine-observe` 必须保留 AHE 观察能力：

- 使用 `imfine-agent-harness-auditor` 或 `imfine-harness-audit`。
- 读取 runtime evidence、trace、receipts、handoffs、final gates、true harness evidence。
- 判断 demo 是否可信证明了多 Agent true-harness 能力。
- 输出 evidence-driven 结论、failure evidence、root cause、targeted fix、predicted impact。

runtime 只提供状态、报告和证据文件，不替 Agent 判断 demo 好坏。

### 8.5 imfine-archive

`imfine-archive` 必须保留 Archive Agent 与 runtime finalize 的双 gate：

- `agent-archive` 是 native Archive Agent 判断，必须有 provider-origin completed receipt。
- `runtime-archive-finalize` 是 runtime 确定性收敛 gate。
- runtime finalize 不能替代 Archive Agent 做归档判断。
- runtime-only receipt 不能证明 Archive Agent 已执行。

## 9. 迁移步骤

1. 以 phased plan 和历史 flat library 生成迁移对照表，确认基础 16 个 Agent 与 10 个 Workflow 都有目标 package。
2. 创建 `.claude-plugin/marketplace.json`，只列出 6 个公开入口 package。
3. 创建 `src/imfine-skills/module.yaml`，声明完整 Agent roster 和目录。
4. 在 `src/imfine-skills/agents/` 下创建至少 16 个 BMAD 风格 Agent package；当前增强名册包含 17 个。
5. 在 `src/imfine-skills/workflows/` 下创建至少 10 个 BMAD 风格 Workflow package；当前增强名册包含 16 个。
6. 创建或保留 `imfine-init`、`imfine-run`、`imfine-status`、`imfine-observe`、`imfine-archive` 快捷 Workflow package。
7. 将 `library/templates/` 中可复用的 evidence schema、prompt 和参考材料迁移到 `src/imfine-skills/templates/` 或 `src/imfine-skills/references/`。
8. 更新安装器，使 `npx github:ZongxingH/im-fine install ...` 继续可用，并安装到 BMAD-like 结构。
9. 更新 `package.json` 发布文件列表，确保 BMAD-style package、plugin metadata 和 runtime 必要资源随包发布。
10. 更新 skill discovery / install manifest，使所有 package 都可被安装和发现。
11. 更新测试，将 flat library 断言改为 package discovery、installed tree、command pointer 和安装兼容断言。
12. 确认 runtime 保留第 6 节列出的能力，不因迁移删除 H-001 到 H-016、replay、trace、gate、receipt、handoff、archive、sandbox 等测试支撑。
13. 删除旧 `library/agents/*.md` 和 `library/skills/*.md` 行为来源。
14. 只保留 runtime 必须使用的 templates、schemas、fixtures 或测试资源；这些资源不得继续承载 Agent/Skill 行为。

## 10. 验收标准

迁移完成必须满足：

- `.claude-plugin/marketplace.json` 只列出 6 个公开入口 package：`imfine-agent-orchestrator`、`imfine-init`、`imfine-run`、`imfine-status`、`imfine-observe`、`imfine-archive`。
- `src/imfine-skills/module.yaml` 声明完整基础 16 个 Agent roster；当前增强名册还包含 `imfine-agent-ux-designer`。
- 当前 `npx github:ZongxingH/im-fine install ...` 安装命令继续可用。
- `--target codex|claude|all`、`--lang zh|en`、`--dry-run` 继续可用。
- 安装后 `~/.agents/skills/` 只保留 6 个 imfine public entries；历史安装留下的隐藏 Agent / Workflow entries 必须被清理。
- Claude 安装后 `~/.claude/commands/` 只保留 6 个 imfine public command pointers；历史安装留下的隐藏 Agent / Workflow commands 必须被清理。
- Codex 不再依赖 `~/.codex/skills/imfine/SKILL.md` 作为主行为入口，而是通过 `~/.agents/skills/` 中的 6 个 public entries 发现 imfine。
- `~/.imfine/runtime` 继续存在。
- 安装后的公开使用方式与 BMAD 类似，但用户只直接调用 `imfine-agent-orchestrator`、`imfine-init`、`imfine-run`、`imfine-status`、`imfine-observe`、`imfine-archive`；完整 Agent / Workflow skills 作为 runtime 内部库保留，不进入用户入口列表。
- 每个 imfine Agent 都保留 BMAD 风格 `SKILL.md`，由 Orchestrator 内部加载和调度。
- 每个 imfine Agent 都有 `customize.toml`。
- 每个 imfine Workflow 都保留 BMAD 风格 `SKILL.md`，由 Orchestrator 内部加载和调用。
- 每个 imfine Workflow 都有 `customize.toml`。
- Orchestrator Agent 可以通过菜单分发 `init`、`run`、`status`、`observe` 和 `archive`。
- `imfine-init` 通过 Agent/Skill 编排初始化项目，但 `.imfine` 初始化产物与当前实现兼容。
- `imfine-run` 保持 true harness 主路径和 orchestrator session 唯一真相源。
- `imfine-status` 保持基于 runtime artifacts 的 gate / blocker / evidence 状态观测。
- `imfine-observe` 保留 harness-auditor 和 harness-audit 能力。
- `imfine-archive` 保留 Archive Agent 与 runtime finalize 双 gate。
- Runtime 仍然校验 handoffs、dispatch contracts、provider receipts、true-harness evidence、acceptance matrix、final gates、archive reports、sandbox verification 和 project knowledge freshness。
- Runtime-only receipts 仍然不能满足 native provider-agent proof。
- `library/agents/*.md` 和 `library/skills/*.md` 不再作为行为来源存在。
- `npm test` 仍然运行完整测试套件，不因迁移删减 phased plan 已覆盖的测试。
- H-001 到 H-016 replay / harness component coverage 仍然存在并通过。
- demo replay 仍能区分早期不完整 demo 与当前 true-harness demo，不因 commit 或 run.json completed 误判完成。

## 11. 非目标

本次迁移不是：

- 不是 BMAD-lite。
- 不是只迁移 `observe`。
- 不是只保留 5 个 Agent。
- 不是只保留 6 个 Workflow。
- 不是 runtime 瘦身练习。
- 不是删除原功能。
- 不是把 Node runtime 改成主交互模型。
- 不是保留 flat library 作为第二套行为来源。

## 12. BMAD 源码参考

本方案参考以下 BMAD 源码路径：

- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/.claude-plugin/marketplace.json`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/module.yaml`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/4-implementation/bmad-agent-dev/SKILL.md`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/4-implementation/bmad-agent-dev/customize.toml`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/4-implementation/bmad-dev-story/SKILL.md`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/4-implementation/bmad-dev-story/customize.toml`

## 13. 与 phased plan 的对应关系

- phased plan 第 3.2 节 Superpowers skills 对应本方案第 2.2 节 9 个 Superpowers-inspired Workflow。
- phased plan 第 3.3 节 BMAD roles 对应本方案第 2.1 节 15 个 BMAD-inspired Agent。
- phased plan 第 3.4 节 AHE / HARNESS.md 对应 `imfine-agent-harness-auditor` 与 `imfine-harness-audit`。
- phased plan 第 14 到 18 节 runtime / gate / evidence / observability 能力对应本方案第 6 节 runtime 保留边界。
- phased plan 第 19 到 20 节当前实现摘要与已确认实现决策，是后续迁移实现和测试验收的功能基线。
