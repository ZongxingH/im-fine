# imfine BMAD 风格整体迁移方案

## 决策

本次迁移是按照 BMAD 的实现方式来实现 imfine：Agent / Skill / Workflow / 安装产物结构都对齐 BMAD；最终仍通过 imfine 自己的 `npx` 安装命令安装；安装后的使用方式也与 BMAD 类似。

这不是只迁移 `observe` 的局部方案。迁移目标是把 imfine 的 Agent、Workflow、菜单、模块元数据和插件暴露方式，整体表达成 BMAD 使用的结构模式：

- Agent 即 Skill
- Workflow 即 Skill
- `customize.toml`
- 模块级 `module.yaml`
- 插件 marketplace 声明
- deterministic runtime 只保留不可替代的裁判层和状态后端
- 当前 `npx github:ZongxingH/im-fine install ...` 安装模式继续兼容
- 安装后的使用方式从单个 `/imfine` 转向 BMAD-like 的多 Agent / Workflow 入口

## 目标结构

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

src/imfine-skills/agents/imfine-agent-orchestrator/SKILL.md
src/imfine-skills/agents/imfine-agent-orchestrator/customize.toml

src/imfine-skills/agents/imfine-agent-dev/SKILL.md
src/imfine-skills/agents/imfine-agent-dev/customize.toml

src/imfine-skills/agents/imfine-agent-qa/SKILL.md
src/imfine-skills/agents/imfine-agent-qa/customize.toml

src/imfine-skills/agents/imfine-agent-reviewer/SKILL.md
src/imfine-skills/agents/imfine-agent-reviewer/customize.toml

src/imfine-skills/agents/imfine-agent-harness-auditor/SKILL.md
src/imfine-skills/agents/imfine-agent-harness-auditor/customize.toml

src/imfine-skills/workflows/imfine-project-analysis/SKILL.md
src/imfine-skills/workflows/imfine-project-analysis/customize.toml

src/imfine-skills/workflows/imfine-write-delivery-plan/SKILL.md
src/imfine-skills/workflows/imfine-write-delivery-plan/customize.toml

src/imfine-skills/workflows/imfine-execute-task-plan/SKILL.md
src/imfine-skills/workflows/imfine-execute-task-plan/customize.toml

src/imfine-skills/workflows/imfine-code-review/SKILL.md
src/imfine-skills/workflows/imfine-code-review/customize.toml

src/imfine-skills/workflows/imfine-harness-audit/SKILL.md
src/imfine-skills/workflows/imfine-harness-audit/customize.toml

src/imfine-skills/workflows/imfine-archive-confirmation/SKILL.md
src/imfine-skills/workflows/imfine-archive-confirmation/customize.toml

src/imfine-skills/templates/
src/imfine-skills/references/
```

## 迁移后使用方式

迁移后 imfine 的使用方式与 BMAD 类似：用户可以直接激活某个 Agent，也可以直接调用某个 Workflow Skill。Orchestrator Agent 是进入 imfine 系统的总控入口；具体 workflow 入口是快捷入口。

公共入口至少包括：

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

Codex 中对应 native skills：

```text
imfine-agent-orchestrator
imfine-init
imfine-run
imfine-status
imfine-observe
imfine-archive
```

入口职责：

- `imfine-agent-orchestrator`：主入口。激活 imfine Orchestrator Agent，加载项目上下文，展示菜单，并分发到 init / run / status / observe / archive。
- `imfine-init`：初始化项目和 `.imfine` runtime workspace。
- `imfine-run`：执行完整多 Agent delivery workflow。
- `imfine-status`：查看当前 run、gate、blocker、runtime evidence 和下一步。
- `imfine-observe`：审计 demo 质量和 true-harness observability。
- `imfine-archive`：执行 archive readiness、final gates 和归档收尾。

允许保留 `/imfine` 兼容入口，但它只能作为 `imfine-agent-orchestrator` 的指针，不能承载另一套旧行为。

## 安装兼容要求

迁移后必须兼容当前 imfine 的安装方式。用户已有的安装入口不能被替换成另一套必须重新学习的入口。

同时，安装后的 Codex / Claude 文件结构必须对齐本机 BMAD 的实际安装形态。

本机 BMAD 安装观测结果：

```text
Shared skills:
  ~/.agents/skills/bmad-*/SKILL.md

Claude command pointers:
  ~/.claude/commands/bmad-*.md

Codex-specific bmad skills:
  ~/.codex/skills/bmad-* 不存在
```

数量观测：

```text
~/.agents/skills/bmad-*        107 skill directories
~/.claude/commands/bmad-*.md   107 command pointer files
~/.codex/skills/bmad-*         0 directories
```

因此 imfine 安装后也必须采用同类结构：共享 skills 放到 `~/.agents/skills/imfine-*`，Claude command pointers 放到 `~/.claude/commands/imfine-*.md`，Codex 通过共享 skills 发现 imfine，而不是通过单个 `~/.codex/skills/imfine/SKILL.md` 承载主行为。

当前支持的安装方式必须继续有效：

```text
npx github:ZongxingH/im-fine install
npx github:ZongxingH/im-fine install --target codex
npx github:ZongxingH/im-fine install --target claude
npx github:ZongxingH/im-fine install --target all --lang zh
npx github:ZongxingH/im-fine install --target all --lang en
npx github:ZongxingH/im-fine install --dry-run
```

安装命令保持兼容，但安装后的文件结构改为对齐 BMAD 在本机的实际安装形态：

```text
Shared native skills:
  ~/.agents/skills/imfine-agent-orchestrator/SKILL.md
  ~/.agents/skills/imfine-agent-dev/SKILL.md
  ~/.agents/skills/imfine-agent-qa/SKILL.md
  ~/.agents/skills/imfine-agent-reviewer/SKILL.md
  ~/.agents/skills/imfine-agent-harness-auditor/SKILL.md
  ~/.agents/skills/imfine-init/SKILL.md
  ~/.agents/skills/imfine-run/SKILL.md
  ~/.agents/skills/imfine-observe/SKILL.md
  ~/.agents/skills/imfine-status/SKILL.md
  ~/.agents/skills/imfine-archive/SKILL.md

Claude slash command pointers:
  ~/.claude/commands/imfine-agent-orchestrator.md
  ~/.claude/commands/imfine-agent-dev.md
  ~/.claude/commands/imfine-agent-qa.md
  ~/.claude/commands/imfine-agent-reviewer.md
  ~/.claude/commands/imfine-agent-harness-auditor.md
  ~/.claude/commands/imfine-init.md
  ~/.claude/commands/imfine-run.md
  ~/.claude/commands/imfine-observe.md
  ~/.claude/commands/imfine-status.md
  ~/.claude/commands/imfine-archive.md

Runtime:
  ~/.imfine/runtime
```

兼容的含义：

- 安装命令保持不变。
- `--target codex|claude|all` 保持不变。
- `--lang zh|en` 保持不变。
- `--dry-run` 保持不变。
- `~/.imfine/runtime` 路径保持不变。
- Codex 通过 `~/.agents/skills/imfine-*` 发现 imfine Agent/Workflow skills。
- Claude 通过 `~/.claude/commands/imfine-*.md` slash command pointers 进入对应 imfine skills。
- 安装后的 Codex / Claude 入口必须引导到新的 BMAD-style Agent / Workflow Skill。

不兼容的内容：

- 不继续安装旧 `library/agents/*.md` 作为 Agent 行为来源。
- 不继续安装旧 `library/skills/*.md` 作为 Skill 行为来源。
- 不通过旧 flat library 维持第二套 Agent/Skill 行为。

也就是说，兼容的是 **安装入口和用户调用方式**，不是兼容旧的内部行为来源。

## BMAD 源码参考

本方案参考以下 BMAD 源码路径：

- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/.claude-plugin/marketplace.json`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/module.yaml`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/4-implementation/bmad-agent-dev/SKILL.md`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/4-implementation/bmad-agent-dev/customize.toml`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/4-implementation/bmad-dev-story/SKILL.md`
- `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/BMAD-METHOD-main/src/bmm-skills/4-implementation/bmad-dev-story/customize.toml`

## 迁移规则

### 1. Agent 迁移为 Agent Skill

当前 flat agent 文件：

```text
library/agents/orchestrator.md
library/agents/dev.md
library/agents/qa.md
library/agents/reviewer.md
library/agents/harness-auditor.md
```

迁移为 BMAD 风格 Agent 包：

```text
src/imfine-skills/agents/imfine-agent-orchestrator/SKILL.md
src/imfine-skills/agents/imfine-agent-orchestrator/customize.toml

src/imfine-skills/agents/imfine-agent-dev/SKILL.md
src/imfine-skills/agents/imfine-agent-dev/customize.toml

src/imfine-skills/agents/imfine-agent-qa/SKILL.md
src/imfine-skills/agents/imfine-agent-qa/customize.toml

src/imfine-skills/agents/imfine-agent-reviewer/SKILL.md
src/imfine-skills/agents/imfine-agent-reviewer/customize.toml

src/imfine-skills/agents/imfine-agent-harness-auditor/SKILL.md
src/imfine-skills/agents/imfine-agent-harness-auditor/customize.toml
```

每个 Agent 包必须包含：

- `SKILL.md`：负责激活流程、persona 采用、配置加载和菜单分发。
- `customize.toml`：负责 role、identity、communication style、principles、persistent facts 和 menu items。

BMAD 风格激活流程必须包含：

1. 解析 agent block。
2. 执行 `activation_steps_prepend`。
3. 采用 persona。
4. 加载 persistent facts。
5. 加载 imfine 配置。
6. 问候或确认用户意图。
7. 执行 `activation_steps_append`。
8. 匹配菜单项并分发，或展示菜单等待用户选择。

### 2. Workflow 迁移为 Workflow Skill

当前 flat skill 文件：

```text
library/skills/project-analysis.md
library/skills/write-delivery-plan.md
library/skills/execute-task-plan.md
library/skills/code-review.md
library/skills/harness-audit.md
library/skills/archive-confirmation.md
```

迁移为 BMAD 风格 Workflow 包：

```text
src/imfine-skills/workflows/imfine-project-analysis/SKILL.md
src/imfine-skills/workflows/imfine-project-analysis/customize.toml

src/imfine-skills/workflows/imfine-write-delivery-plan/SKILL.md
src/imfine-skills/workflows/imfine-write-delivery-plan/customize.toml

src/imfine-skills/workflows/imfine-execute-task-plan/SKILL.md
src/imfine-skills/workflows/imfine-execute-task-plan/customize.toml

src/imfine-skills/workflows/imfine-code-review/SKILL.md
src/imfine-skills/workflows/imfine-code-review/customize.toml

src/imfine-skills/workflows/imfine-harness-audit/SKILL.md
src/imfine-skills/workflows/imfine-harness-audit/customize.toml

src/imfine-skills/workflows/imfine-archive-confirmation/SKILL.md
src/imfine-skills/workflows/imfine-archive-confirmation/customize.toml
```

每个 Workflow 包都必须包含 `[workflow]` customization block：

```toml
[workflow]
activation_steps_prepend = []
activation_steps_append = []
persistent_facts = [
  "file:{project-root}/.imfine/project/**/*.md"
]
on_complete = ""
```

### 3. 增加模块元数据

新增：

```text
src/imfine-skills/module.yaml
```

该模块文件必须声明 imfine 的安装目录、变量和 agent roster。

初始形态：

```yaml
code: imfine
name: "imfine"
description: "Observable multi-agent harness engineering workflow"
default_selected: true

directories:
  - ".imfine"
  - ".imfine/project"
  - ".imfine/runs"
  - ".imfine/custom"

agents:
  - code: imfine-agent-orchestrator
    name: Orchestrator
    title: Harness Orchestrator
    description: "Coordinates native provider agents and deterministic runtime gates."

  - code: imfine-agent-dev
    name: Dev
    title: Implementation Agent
    description: "Implements task-level changes with patch, test, and handoff evidence."

  - code: imfine-agent-qa
    name: QA
    title: Verification Agent
    description: "Verifies runtime behavior, tests, acceptance coverage, and evidence quality."

  - code: imfine-agent-reviewer
    name: Reviewer
    title: Code Review Agent
    description: "Reviews implementation quality, scope control, risks, and regressions."

  - code: imfine-agent-harness-auditor
    name: Harness Auditor
    title: Observability Auditor
    description: "Evaluates whether an imfine run is a credible true-harness demonstration."
```

### 4. 增加插件 Marketplace 声明

新增：

```text
.claude-plugin/marketplace.json
```

初始形态：

```json
{
  "name": "imfine",
  "owner": {
    "name": "imfine"
  },
  "description": "Observable multi-agent harness workflow for Codex and Claude.",
  "license": "MIT",
  "plugins": [
    {
      "name": "imfine-harness",
      "source": "./",
      "description": "Observable multi-agent harness workflow for Codex and Claude.",
      "version": "0.0.0",
      "author": {
        "name": "imfine"
      },
      "skills": [
        "./src/imfine-skills/agents/imfine-agent-orchestrator",
        "./src/imfine-skills/agents/imfine-agent-dev",
        "./src/imfine-skills/agents/imfine-agent-qa",
        "./src/imfine-skills/agents/imfine-agent-reviewer",
        "./src/imfine-skills/agents/imfine-agent-harness-auditor",
        "./src/imfine-skills/1-bootstrap/imfine-init",
        "./src/imfine-skills/2-run/imfine-run",
        "./src/imfine-skills/2-run/imfine-status",
        "./src/imfine-skills/3-observe/imfine-observe",
        "./src/imfine-skills/4-archive/imfine-archive",
        "./src/imfine-skills/workflows/imfine-project-analysis",
        "./src/imfine-skills/workflows/imfine-write-delivery-plan",
        "./src/imfine-skills/workflows/imfine-execute-task-plan",
        "./src/imfine-skills/workflows/imfine-code-review",
        "./src/imfine-skills/workflows/imfine-harness-audit",
        "./src/imfine-skills/workflows/imfine-archive-confirmation"
      ]
    }
  ]
}
```

### 5. 安装器适配 BMAD 风格结构

当前安装器仍然保留，但安装内容必须改为 BMAD-style skill package。

安装器继续负责：

- 构建 runtime。
- 安装或更新 `~/.imfine/runtime`。
- 写入共享 native skill 目录 `~/.agents/skills/imfine-*`。
- 为 Claude 写入 slash command pointer 文件 `~/.claude/commands/imfine-*.md`。
- 根据 `--target` 选择 Codex、Claude 或二者都安装。
- 根据 `--lang` 选择中文或英文入口文案。
- 根据 `--dry-run` 输出将要写入的目标，不修改文件。

安装器新增或调整职责：

- 扫描 `src/imfine-skills/**/SKILL.md`，生成 imfine skill manifest。
- 将每个 BMAD-style skill package 复制为 `~/.agents/skills/<canonical-id>/SKILL.md`。
- 对 Agent 生成 `imfine-agent-*` canonical id。
- 对 Workflow 生成 `imfine-*` canonical id。
- 为 Claude 生成同名 command pointer，例如 `~/.claude/commands/imfine-run.md`。
- 保留一个兼容入口 `~/.claude/commands/imfine.md` 时，它只能作为 Orchestrator 指针，不能承载另一套行为来源。
- 如果需要保留 Codex 旧入口 `~/.codex/skills/imfine/SKILL.md`，它也只能作为兼容指针，指向 `~/.agents/skills/imfine-agent-orchestrator/SKILL.md`，不能承载另一套行为来源。
- 确保安装产物不依赖旧 `library/agents/*.md` 或 `library/skills/*.md`。

安装器不负责：

- 作为用户主要工作流入口替代 Agent/Skill。
- 拉起 Codex 或 Claude provider agent。
- 生成 runtime-only receipt 冒充 native provider agent proof。
- 维护旧 flat library 行为来源。

### 6. Runtime 最小保留边界

Node runtime 只保留 imfine 必须依赖的确定性裁判能力。除此之外，Agent、Skill、Workflow、Template 的行为来源都迁移到 BMAD 风格结构，不再保留旧 flat library 作为第二套来源。

迁移后：

```text
用户可见工作流：
  imfine-agent-orchestrator / imfine-init / imfine-run / imfine-status /
  imfine-observe / imfine-archive skills

必须保留的确定性后端：
  node runtime 负责 state、schema validation、dispatch contracts、provider receipts、
  handoff validation、true-harness evidence、final gates、archive validation
```

必须保留在 runtime 中的能力：

- `.imfine/runs/<run-id>/` 状态读写和 run 索引。
- schema validation。
- dispatch contract 物化和校验。
- provider-origin receipt 校验。
- handoff schema 和 evidence 引用校验。
- role purity / authorship 边界校验。
- acceptance matrix / deviation 的确定性派生和校验。
- true-harness evidence 派生和校验。
- final gates 派生和校验。
- archive readiness 和 archive report 校验。
- 可重复执行的测试、smoke、fixture replay 支撑。

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

规则：

- Skills 和 Agents 负责判断、编排、角色行为和用户可见工作流。
- Runtime 只负责确定性的状态、schema、证据、gate、archive 和可重复校验。
- Runtime 不能用 runtime-only receipt 替代 provider-native agent execution。
- Skill 可以调用 runtime 命令作为后端操作，但不能把 runtime 命令作为主要交互模型暴露给用户。
- 迁移完成后，不再维护 `library/agents/*.md` 和 `library/skills/*.md` 作为可用行为来源。

## Orchestrator 菜单目标

`imfine-agent-orchestrator/customize.toml` 应暴露以下菜单项。用户也可以直接调用同名 workflow shortcut。

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

## Init Workflow 要求

`imfine-init` 是 BMAD-style workflow skill。它通过 Agent/Skill 编排完成项目初始化，但初始化后的 `.imfine` 产物必须与当前实现保持兼容。

职责分工：

```text
imfine-init workflow / Orchestrator / Project Analyzer Agent
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
```

如果当前 runtime 已生成以下产物，迁移后也必须继续保持兼容：

```text
.imfine/project/project-context.md
.imfine/project/freshness.json
.imfine/debug/
```

规则：

- `imfine-init` 不能绕过 runtime 手写核心 `.imfine` 状态。
- `imfine-init` 可以要求 Project Analyzer / Architect Agent 产出分析内容。
- Runtime 负责将标准产物落盘并保证结构可被 `imfine-run`、`imfine-status`、`imfine-observe`、`imfine-archive` 继续读取。
- 迁移后旧 run/status/observe/archive 依赖的 `.imfine` 数据契约不能破坏。

## 迁移步骤

1. 创建 `.claude-plugin/marketplace.json`。
2. 创建 `src/imfine-skills/module.yaml`。
3. 在 `src/imfine-skills/agents/` 下创建 BMAD 风格 Agent 包。
4. 在 `src/imfine-skills/workflows/` 下创建 BMAD 风格 Workflow 包。
5. 将 `library/templates/` 中可复用的 evidence schema 和 prompt 迁移到 `src/imfine-skills/templates/`。
6. 将方法论说明和 AHE 参考资料迁移到 `src/imfine-skills/references/`。
7. 更新安装器，使当前 `npx github:ZongxingH/im-fine install ...` 安装入口继续可用，但安装结构改为 BMAD-style：
   - `~/.agents/skills/imfine-*`
   - `~/.claude/commands/imfine-*.md`
   - `~/.imfine/runtime`
8. 更新 `package.json` 发布文件列表，确保 BMAD-style skill packages、plugin metadata 和 runtime 必要资源随包发布。
9. 更新 runtime library loading，使其能够发现带 `SKILL.md` 的 BMAD 风格 package directory。
10. 更新测试，将 flat `library/agents/*.md` 和 `library/skills/*.md` 断言改成 package discovery、BMAD-style installed tree 和安装兼容断言。
11. 删除旧的 flat `library/agents/*.md` 和 `library/skills/*.md` 行为来源。
12. 只保留 runtime 必须使用的 templates、schemas、fixtures 或测试资源；这些资源不得继续承载 Agent/Skill 行为。

## 验收标准

迁移完成必须满足：

- `.claude-plugin/marketplace.json` 列出 imfine agent skills 和 workflow skills。
- `src/imfine-skills/module.yaml` 声明 imfine 目录和 agent roster。
- 当前 `npx github:ZongxingH/im-fine install ...` 安装命令继续可用。
- `--target codex|claude|all`、`--lang zh|en`、`--dry-run` 继续可用。
- 安装后存在 `~/.agents/skills/imfine-*` skill directories。
- Claude 安装后存在 `~/.claude/commands/imfine-*.md` command pointers。
- Codex 不再依赖 `~/.codex/skills/imfine/SKILL.md` 作为主行为入口，而是通过 `~/.agents/skills/imfine-*` 发现 skills。
- `~/.imfine/runtime` 继续存在。
- 兼容入口 `/imfine` 如继续保留，只能路由到 `imfine-agent-orchestrator`，不能成为第二套行为来源。
- 安装后的公开使用方式与 BMAD 类似：可直接调用 `imfine-agent-orchestrator`、`imfine-init`、`imfine-run`、`imfine-status`、`imfine-observe`、`imfine-archive`。
- 每个 imfine Agent 都可以通过 BMAD 风格 `SKILL.md` 激活。
- 每个 imfine Agent 都有 `customize.toml`。
- 每个 imfine Workflow 都可以通过 BMAD 风格 `SKILL.md` 调用。
- 每个 imfine Workflow 都有 `customize.toml`。
- Orchestrator Agent 可以通过菜单分发 `init`、`run`、`status`、`observe` 和 `archive`。
- `imfine-init` 通过 Agent/Skill 编排初始化项目，但 `.imfine` 初始化产物与当前实现兼容。
- `imfine-agent-harness-auditor` 替代 flat `library/agents/harness-auditor.md` 角色。
- `imfine-harness-audit` 替代 flat `library/skills/harness-audit.md` skill。
- Runtime 仍然校验 handoffs、dispatch contracts、true-harness evidence、final gates 和 archive reports。
- Runtime-only receipts 仍然不能满足 native provider-agent proof。
- `library/agents/*.md` 和 `library/skills/*.md` 不再作为行为来源存在。
- Runtime 保留内容仅限状态、schema、证据、gate、archive、fixture 和测试支撑。
- 现有 build 和 smoke tests 在迁移后通过。
- 新增测试覆盖 BMAD 风格 package discovery。
- 新增测试覆盖当前安装模式兼容性。

## 非目标

- 不做 BMAD-lite hybrid 结构。
- 不继续把 flat markdown 作为 Agent 或 Skill 行为来源。
- 不维护 BMAD-style skills 与旧 flat library 的双轨行为来源。
- 不把 Workflow 判断逻辑、Agent persona 或菜单逻辑留在 runtime 中。
- 不把 Node runtime 命令作为主要用户交互模型暴露。
- 不改变当前 `npx github:ZongxingH/im-fine install ...` 用户安装入口。
- 不把 `observe` 当成单点迁移；它必须和整个 imfine Skill / Agent 系统一起迁移。
