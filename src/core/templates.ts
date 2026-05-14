import type { InstallLanguage } from "./types.js";

function englishBody(toolName: string): string {
  return `# /imfine

Use imfine as a project-level autonomous multi-agent harness in the current ${toolName} session.

## Invocation

\`\`\`text
/imfine <args>
\`\`\`

Treat the text after \`/imfine\` as the user-facing workflow request. The user interface is this slash command, not the runtime CLI.

## Public User Entries

Only these \`/imfine\` forms are user-facing:

- \`/imfine init\`
- \`/imfine run <requirement text|requirement-file>\`
- \`/imfine status\`

## Layer Contract

imfine is built from three layers:

- absorbed methods = OpenSpec, Superpowers, BMAD source ideas for specs, roles, skills, and evidence discipline
- model orchestration = the current session's Orchestrator Agent and independent subagents
- deterministic runtime = local state materialization, validation, patch handling, git operations, archive evidence, and reports

The runtime must stay deterministic. Do not move requirement judgment, architecture judgment, planning judgment, QA judgment, review judgment, or archive-readiness judgment into hardcoded runtime logic.

## Runtime

The deterministic runtime is installed under \`~/.imfine/runtime\`.

When deterministic execution is needed, run:

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js <command>
\`\`\`

Use the runtime only for:

- \`init\`
- state and artifact materialization
- task-graph validation and planning materialization
- worktree preparation
- patch collection and patch validation
- commit, push, archive, and report materialization

Do not expose runtime commands to the user as the primary workflow.

## Orchestrator Contract

The current session must act as the Orchestrator Agent.

The Orchestrator must:

1. read run context from \`.imfine/runs/<run-id>/**\`
2. write \`orchestration/orchestrator-session.json\`
3. launch independent native subagents through the current environment's subagent capability
4. coordinate handoffs, retries, and blocked decisions
5. stop only for true blockers or final human approval

The Orchestrator must not implement the whole workflow by pretending one agent performed all roles.

If the current ${toolName} environment does not support independent native subagents, mark the run blocked. Do not silently downgrade to a single-agent workflow unless the user explicitly allows it.

## Init Workflow

When the user runs:

\`\`\`text
/imfine init
\`\`\`

the current session must act as Orchestrator:

1. inspect the project root read-only and classify it as empty or existing
2. identify evidence such as language, framework, entry points, modules, tests, build config, and middleware markers
3. call the deterministic runtime:
   \`\`\`bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js init
   \`\`\`
4. read the runtime result and \`.imfine/project/**\`
5. for existing projects, start or use an independent Architect Agent to complete architecture analysis with file evidence
6. report the project type, generated workspace, architecture evidence, and next step

## Run Workflow

When the user runs:

\`\`\`text
/imfine run <requirement text|requirement-file>
\`\`\`

the current session must act as Orchestrator:

1. let runtime create the run and materialize context
2. read \`.imfine/runs/<run-id>/orchestration/orchestrator-input.md\`
3. write \`orchestration/orchestrator-session.json\` with:
   - \`decision_source=orchestrator_agent\`
   - \`execution_mode=true_harness\`
   - \`harness_classification=true_harness\`
   - every planned \`next_action\`
   - every \`agent_run\`
   - explicit \`dependsOn\` and \`parallelGroup\`
4. launch independent native subagents for the declared roles
5. use runtime only for deterministic backend actions between agent handoffs
6. keep driving Dev, QA, Review, Merge Agent, Committer, Technical Writer, Project Knowledge Updater, and Archive until the run is completed or blocked

Do not ask the user to decide which agent runs next.

## Required Agent Roles

The runtime library contains imfine-owned source-level roles and skills. Core roles include:

- Orchestrator
- Intake
- Project Analyzer
- Product Planner
- Architect
- Task Planner
- Dev
- QA
- Reviewer
- Risk Reviewer
- Merge Agent
- Conflict Resolver
- Committer
- Technical Writer
- Project Knowledge Updater
- Archive

Use runtime library commands only when you need the local source text:

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents show orchestrator
node ~/.imfine/runtime/dist/cli/imfine-runtime.js skills list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js templates list
\`\`\`

## Native Subagent Dispatch

Independent agent work must be launched from the current session through the environment's native subagent capability.

Runtime files such as:

- \`dispatch-contracts.json\`
- \`agent-runs.json\`
- \`parallel-plan.json\`
- \`parallel-execution.json\`

are execution records and deterministic materializations. They are not the source of orchestration authority.

## Hard Rules

- Do not expose runtime internals as user workflow.
- Do not ask the user to coordinate subagents.
- Do not silently collapse multi-agent work into one undifferentiated role.
- Do not skip QA, Review, Committer, or Archive gates.
- Do not claim success without handoff and command evidence.
- Keep delivery summaries in the current session; do not create separate work-summary documents.
`;
}

function chineseBody(toolName: string): string {
  return `# /imfine

在当前 ${toolName} 会话中使用 imfine 项目级自主多 Agent harness。

## 调用方式

\`\`\`text
/imfine <参数>
\`\`\`

把 \`/imfine\` 后面的内容视为用户工作流请求。用户入口是这个 slash command，不是 runtime CLI。

## 用户主入口

只对用户暴露这些 \`/imfine\` 形式：

- \`/imfine init\`
- \`/imfine run <需求文本|需求文件>\`
- \`/imfine status\`

## 三层契约

imfine 由三层组成：

- 方法吸收层：吸收 OpenSpec、Superpowers、BMAD 的源码、prompt、agent、skill、workflow、模板思想
- 模型编排层：当前会话中的 Orchestrator Agent 和独立子 Agent
- 确定性 runtime 层：本地状态落盘、校验、patch、git、archive 证据和报告

runtime 必须保持确定性。不要把需求判断、架构判断、任务拆分、QA 结论、Review 结论或归档就绪判断写成 runtime 硬编码逻辑。

## Runtime

确定性 runtime 安装在 \`~/.imfine/runtime\`。

需要确定性动作时，执行：

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js <command>
\`\`\`

runtime 只负责：

- \`init\`
- 状态和产物落盘
- task graph 校验和 planning 物化
- worktree 准备
- patch 收集和 patch 校验
- commit、push、archive、report 落盘

不要把 runtime 命令当成用户主要工作流暴露出去。

## Orchestrator 契约

当前会话必须作为 Orchestrator Agent。

Orchestrator 必须：

1. 读取 \`.imfine/runs/<run-id>/**\` 里的 run 上下文
2. 写出 \`orchestration/orchestrator-session.json\`
3. 使用当前环境的原生子 Agent 能力拉起独立 Agent
4. 协调 handoff、返工和 blocked 决策
5. 只在真实阻塞或最终人工批准时停下来

不要让 Orchestrator 假装自己完成所有角色。

如果当前 ${toolName} 环境不支持独立原生子 Agent，必须把 run 标记为 blocked。除非用户明确允许，否则不要静默降级成单 Agent 工作流。

## Init 工作流

当用户执行：

\`\`\`text
/imfine init
\`\`\`

当前会话必须作为 Orchestrator：

1. 先只读检查项目根目录，判断是空目录还是已有项目
2. 识别语言、框架、入口、模块、测试、构建配置和中间件证据
3. 调用确定性 runtime：
   \`\`\`bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js init
   \`\`\`
4. 读取 runtime 结果和 \`.imfine/project/**\`
5. 对已有项目，启动或使用独立 Architect Agent 完成带文件证据的架构分析
6. 汇报项目类型、工作空间、架构证据和下一步建议

## Run 工作流

当用户执行：

\`\`\`text
/imfine run <需求文本|需求文件>
\`\`\`

当前会话必须作为 Orchestrator：

1. 让 runtime 创建 run 并物化上下文
2. 读取 \`.imfine/runs/<run-id>/orchestration/orchestrator-input.md\`
3. 写出 \`orchestration/orchestrator-session.json\`，其中必须包含：
   - \`decision_source=orchestrator_agent\`
   - \`execution_mode=true_harness\`
   - \`harness_classification=true_harness\`
   - 所有计划中的 \`next_action\`
   - 所有 \`agent_run\`
   - 明确的 \`dependsOn\` 和 \`parallelGroup\`
4. 直接使用当前环境的原生子 Agent 能力拉起独立 Agent
5. agent handoff 之间只把 runtime 当作确定性后端
6. 持续编排 Dev、QA、Reviewer、Merge Agent、Committer、Technical Writer、Project Knowledge Updater、Archive，直到 run \`completed\` 或 \`blocked\`

不要问用户下一步该跑哪个 Agent。

## 角色库

runtime 内置 imfine 自有的源码级角色和 skills。核心角色包括：

- Orchestrator
- Intake
- Project Analyzer
- Product Planner
- Architect
- Task Planner
- Dev
- QA
- Reviewer
- Risk Reviewer
- Merge Agent
- Conflict Resolver
- Committer
- Technical Writer
- Project Knowledge Updater
- Archive

只有在需要读取本地库内容时，才使用：

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents show orchestrator
node ~/.imfine/runtime/dist/cli/imfine-runtime.js skills list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js templates list
\`\`\`

## 原生子 Agent 调度

独立 Agent 工作必须由当前会话通过环境原生子 Agent 能力直接拉起。

runtime 文件例如：

- \`dispatch-contracts.json\`
- \`agent-runs.json\`
- \`parallel-plan.json\`
- \`parallel-execution.json\`

只是执行记录和确定性物化产物，不是编排权力来源。

## 硬性规则

- 不要把 runtime 内部命令当成用户工作流。
- 不要让用户协调子 Agent。
- 不要把多 Agent 工作静默压缩成一个无边界角色。
- 不要跳过 QA、Reviewer、Committer、Archive gate。
- 没有 handoff 和命令证据，不要声称成功。
- 任务总结只留在当前会话，不要生成独立 work-summary 文档。
`;
}

function bodyTemplate(toolName: string, language: InstallLanguage): string {
  return language === "en" ? englishBody(toolName) : chineseBody(toolName);
}

export function codexSkillTemplate(language: InstallLanguage): string {
  const description = language === "en"
    ? "Use when running the imfine project-level autonomous multi-agent harness from Codex."
    : "当需要在 Codex 中运行 imfine 项目级自主多 Agent harness 时使用。";
  return `---
name: imfine
description: ${description}
---

${bodyTemplate("Codex", language)}`;
}

export function claudeCommandTemplate(language: InstallLanguage): string {
  const description = language === "en"
    ? "Use when running the imfine project-level autonomous multi-agent harness from Claude."
    : "当需要在 Claude 中运行 imfine 项目级自主多 Agent harness 时使用。";
  return `---
name: 'imfine'
description: '${description}'
---

${bodyTemplate("Claude Code", language)}`;
}
