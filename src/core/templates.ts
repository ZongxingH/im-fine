import type { InstallLanguage } from "./types.js";

function englishBody(toolName: string): string {
  return `# /imfine

Use imfine as a project-level autonomous multi-agent harness in the current ${toolName} session.

## Invocation

\`\`\`text
/imfine <args>
\`\`\`

The text after \`/imfine\` is the user-facing workflow request. Do not expose runtime commands as the primary user workflow.

## Main User Entries

- \`/imfine init\`
- \`/imfine run <requirement text|requirement-file>\`
- \`/imfine status\`

## Runtime

The deterministic runtime is installed under \`~/.imfine/runtime\`.

Use it only for materializing state, initializing \`.imfine\`, checking infrastructure, installing entries, and other deterministic actions:

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js <command>
\`\`\`

## Runtime Boundaries

- Only \`/imfine init\`, \`/imfine run\`, and \`/imfine status\` are user-facing slash-command entries.
- Runtime JS commands remain internal deterministic actions and should not be exposed to the user as the normal operating path.
- \`init\` may call runtime JS to inspect the current project and materialize the workspace.
- Delivery planning, orchestration, implementation, QA, review, fix loops, and archive decisions are expected to be driven by the current model session through multi-role multi-agent + skill execution.
- Legacy bridge commands such as \`agents prepare\` or \`agents execute\` are internal debug/testing paths only.

## Init Workflow

When the user runs \`/imfine init\`, the current session must act as Orchestrator rather than only forwarding the runtime command:

1. Inspect the project root read-only and classify it as empty or existing.
2. Identify evidence such as language, framework, entry points, modules, tests, build config, and middleware markers. Do not invent architecture without evidence.
3. Call the deterministic runtime:
   \`\`\`bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js init
   \`\`\`
4. Read the runtime result and \`.imfine/project/architecture/\`.
5. For existing projects, start or use an internal Architect Agent to fill the pending architecture placeholders:
   - update \`.imfine/project/architecture/overview.md\`, \`tech-stack.md\`, \`module-tech-stack.md\`, \`modules.md\`, \`entrypoints.md\`, \`test-strategy.md\`, and \`risks.md\`
   - update related \`.imfine/project/*.md\` files when evidence supports it
   - cite file evidence for every architecture conclusion
6. If evidence is weak, mark it unknown instead of guessing.
7. Report project type, generated architecture docs, infrastructure status, and suggested next step.

## Phase 2 Agent / Skill Library

The runtime includes imfine-owned source-level agents, skills, and templates adapted from BMAD, Superpowers, and OpenSpec ideas.

Use these runtime commands when library context is needed:

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents show orchestrator
node ~/.imfine/runtime/dist/cli/imfine-runtime.js skills list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js templates list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js library sync
\`\`\`

Required core agents: Orchestrator, Intake, Architect, Task Planner, Dev, QA, Reviewer, Archive.

## Model Agent Execution

\`/imfine agents prepare <run-id>\` is a legacy bridge that turns ready Agent runs into model execution packages under \`.imfine/runs/<run-id>/agents/<agent-id>/execution/\`.

Each package includes the Agent contract, skill bundle, model input prompt, boundaries, required outputs, and handoff expectations. The model must make architecture, implementation, QA, Review, conflict, and archive judgments; runtime only materializes bridge artifacts and records execution evidence.

\`/imfine agents prepare <run-id>\` is not the target provider path. The target harness path is: runtime materializes state and contracts, and the current ${toolName} session acts as Orchestrator to execute or dispatch Agent roles with native subagent capability.

All bridge artifacts must be explicitly treated as \`legacy_debug\` outputs. They are for debugging or non-interactive test runners only and must not be used as evidence that the true harness path has run.

\`imfine-runtime agents execute <run-id> --executor "<command>"\` exists only as an internal/testing bridge for non-interactive runners. It is not required for normal \`/imfine\` use inside Codex or Claude.

\`/imfine library sync\` is an explicit debug-only snapshot of the global runtime library into \`.imfine/debug/library-snapshot/\`. It is not part of \`init\` and not required for the true harness path.

If native provider subagents are unavailable or unconfirmed, the run should be treated as blocked for the true harness path. Do not silently complete the whole workflow as one undifferentiated Agent.

## Existing-Project Auto Orchestration

\`/imfine run ...\` runs the autonomous delivery loop for existing projects from inside the current ${toolName} model session.

The loop only performs deterministic runtime actions itself: prepare worktrees, collect patches after Dev/Writer agents edit their worktrees, record QA/Review decisions from model handoffs, commit approved patches, push the run branch when possible, and archive verified evidence. Product, architecture, implementation, QA, Review, and conflict decisions remain model Agent responsibilities.

For new projects, the same orchestration loop first performs Architect and Task Planner model work from the generated packages. Architect must write \`.imfine/runs/<run-id>/design/stack-decision.json\`; Task Planner must write the task graph. Runtime validates those model outputs and materializes the remaining planning artifacts before preparing worktrees.

## Phase 3 Run Boundary

\`/imfine run\` currently creates a delivery run from text or a requirement file and materializes runtime context, evidence, state, and pending roles. It must not be described as completing requirement analysis, solution design, architecture decisions, or acceptance conclusions.

Do not claim implementation, task graph generation, commits, push, QA, review, or archive have happened in phase 3.

## Phase 4 Plan Boundary

\`/imfine run\` now advances through model planning plus runtime validation/materialization of the task graph, ownership map, execution plan, commit plan, and per-task dev/test/review plans.

Phase 4 still does not create worktrees, implement code, run QA, run review, commit, push, or archive.

## Phase 5 Worktree / Patch Boundary

\`/imfine worktree prepare\` creates the run branch and task worktrees, writes agent inputs, and moves the run to implementation preparation.

\`/imfine patch collect\` collects a task patch from its worktree and validates changed files against the task \`write_scope\`.

Phase 5 still does not make code changes by itself, run QA, run Review, commit, push, or archive.

## Phase 6 QA / Review Boundary

\`/imfine verify\` records QA Agent verification evidence by running executable task verification commands in the task worktree or by recording the QA Agent's explicit \`--status\` decision. If QA fails, runtime creates a scoped fix task and moves the run to \`needs_dev_fix\`.

\`/imfine review\` records the independent Reviewer Agent decision. A \`changes_requested\` decision creates a scoped fix task and moves the run to \`needs_dev_fix\`.

\`/imfine rework design\` records implementation blocked by design, creates Architect and Task Planner rework inputs, and moves the run to \`needs_design_update\`.

Repeated QA or Review failures should continue producing scoped fix tasks for the Orchestrator and agents to resolve autonomously.

Phase 6 still does not commit, push, or archive.

## Phase 7 Commit / Push Boundary

\`/imfine commit\` applies approved task patches to the run branch worktree and creates task-level or integration commits. Runtime requires patch validation, QA pass, and Review approval before committing.

\`/imfine commit resolved\` lets Conflict Resolver commit an already-merged run worktree as an integration commit.

\`/imfine push\` pushes \`origin imfine/<run-id>\` when origin is configured. Missing remote, permission failure, or push failure is recorded as explicit push blocked evidence.

Phase 7 still does not archive.

## Phase 8 Archive Boundary

The archive stage runs Archive Agent confirmation. If requirement, design, task, QA, Review, commit, and push evidence are complete, runtime writes the run archive, user report, and updates \`.imfine/project\` long-term knowledge.

If evidence is missing, archive writes a blocked report and handoff, but does not update long-term project knowledge with unverified claims.

## Phase 9 New Project Waiting Boundary

\`/imfine run ...\` for empty new-project directories enters the same orchestration loop, then waits for Architect and Task Planner model work when needed. Runtime must not generate default project code, tests, docs, or task-graph semantics for a new project.

Do not create GitHub, GitLab, cloud services, databases, production credentials, or external infrastructure.

## Agent Boundary

In phase 1, do not claim full multi-agent delivery is available. Initialize the workspace, run doctor, and report missing infrastructure clearly.

Future phases will add multi-role orchestration for Intake, Project Analysis, Architect, Task Planner, Dev, QA, Review, Archive, and Technical Writer agents.
`;
}

function chineseBody(toolName: string): string {
  return `# /imfine

在当前 ${toolName} 会话中使用 imfine 项目级自主多 Agent harness。

## 调用方式

\`\`\`text
/imfine <参数>
\`\`\`

\`/imfine\` 后面的文本是用户可见的工作流请求。不要把 runtime 命令作为主要用户入口。

## 用户主入口

- \`/imfine init\`
- \`/imfine run <需求文本|需求文件>\`
- \`/imfine status\`

## Runtime

确定性 runtime 安装在 \`~/.imfine/runtime\`。

只有在需要初始化 \`.imfine\`、检查基础设施、安装入口或执行其他确定性动作时，才调用 runtime：

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js <command>
\`\`\`

## Runtime 边界

- 只有 \`/imfine init\`、\`/imfine run\`、\`/imfine status\` 是对用户暴露的 slash command 主入口。
- runtime JS 命令仍然存在，但属于内部确定性 action，不应作为正常使用路径展示给用户。
- \`init\` 期间允许调用 runtime JS 完成当前项目环境检查和工作区物化。
- 交付规划、编排推进、实现、QA、Review、fix loop、归档判断等应依赖当前大模型会话，通过多角色多 Agent + skill 执行。
- \`agents prepare\`、\`agents execute\` 等 legacy bridge 只保留为内部 debug/testing 路径。

## Init 工作流

当用户执行 \`/imfine init\` 时，当前会话必须作为 Orchestrator 完成初始化，而不是只机械转发 runtime 命令：

1. 先只读检查项目根目录，判断是空项目还是已有项目。
2. 识别语言、框架、入口、模块、测试、构建配置、中间件线索等证据；不要编造没有证据的架构。
3. 调用确定性 runtime：
   \`\`\`bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js init
   \`\`\`
4. 读取 runtime 返回和 \`.imfine/project/architecture/\`。
5. 如果是已有项目，启动或使用内部 Architect Agent 补全待处理的架构占位：
   - 更新 \`.imfine/project/architecture/overview.md\`、\`tech-stack.md\`、\`module-tech-stack.md\`、\`modules.md\`、\`entrypoints.md\`、\`test-strategy.md\`、\`risks.md\`
   - 在证据支持时同步更新相关 \`.imfine/project/*.md\`
   - 每个架构结论都必须引用文件证据
6. 证据不足时标记未知，不要猜测。
7. 汇报项目类型、生成的架构文档、基础设施状态和下一步建议。

## 阶段 2 Agent / Skill 库

runtime 内置 imfine 自有的源码级 agents、skills 和 templates，这些产物基于 BMAD、Superpowers、OpenSpec 的思想改造而来，不依赖外部工具安装。

需要读取库上下文时，使用：

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents show orchestrator
node ~/.imfine/runtime/dist/cli/imfine-runtime.js skills list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js templates list
node ~/.imfine/runtime/dist/cli/imfine-runtime.js library sync
\`\`\`

核心角色必须包含：Orchestrator、Intake、Architect、Task Planner、Dev、QA、Reviewer、Archive。

## 模型 Agent 执行

\`/imfine agents prepare <run-id>\` 是遗留桥接路径，会把 ready Agent run 转成模型执行包，位置在 \`.imfine/runs/<run-id>/agents/<agent-id>/execution/\`。

每个执行包包含 Agent 契约、skill bundle、模型输入 prompt、边界、必需输出和 handoff 要求。架构、实现、QA、Review、冲突处理和归档判断必须由模型完成；runtime 只负责生成桥接产物和记录执行证据。

\`/imfine agents prepare <run-id>\` 不是目标 provider 主路径。目标 harness 路径应由 runtime 物化状态与 contract，再由当前 ${toolName} 会话作为 Orchestrator 使用原生子 Agent 能力执行或分发角色工作。

所有 bridge 产物都必须显式视为 \`legacy_debug\` 输出，只能用于调试或非交互测试 runner，不能被当成 true harness 已执行的证据。

\`imfine-runtime agents execute <run-id> --executor "<command>"\` 只作为非交互 runner 的内部/测试桥接，不是 Codex 或 Claude 中正常使用 \`/imfine\` 的前提。

\`/imfine library sync\` 只是显式调试用途，会把全局 runtime library 快照到 \`.imfine/debug/library-snapshot/\`。它不属于 \`init\` 主路径，也不是目标 harness 的前置条件。

如果当前 provider 没有可用子 Agent 能力，真实 harness 路径应视为 blocked。不要静默降级成一个无边界的单 Agent 全流程。

## 已有项目自动编排

\`/imfine run ...\` 在当前 ${toolName} 大模型会话中对已有项目执行自主交付 loop。

这个 loop 只自己执行确定性 runtime 动作：准备 worktree、在 Dev/Writer Agent 修改 worktree 后收集 patch、根据模型 handoff 记录 QA/Review、提交已批准 patch、可行时 push run 分支、归档已验证证据。产品、架构、实现、QA、Review 和冲突处理判断仍然由模型 Agent 负责。

对于新项目，当前 ${toolName} 会话会先根据生成的执行包完成 Architect 和 Task Planner 模型工作。Architect 必须写入 \`.imfine/runs/<run-id>/design/stack-decision.json\`；Task Planner 必须写入 task graph 和 execution plan。Runtime 只在这些模型产物校验通过后准备 worktree。

## 阶段 3 Run 边界

\`/imfine run\` 当前会从需求文本或需求文件创建 delivery run，并物化项目上下文、证据、状态和待执行角色。不要把它描述成已经完成需求分析、方案设计、架构决策或验收结论。

阶段 3 不要声称已经完成实现、任务图生成、commit、push、QA、Review 或归档。

## 阶段 4 Plan 边界

\`/imfine run\` 现在也会创建经过 runtime 校验的 task graph、ownership、execution plan、commit plan，以及每个任务的 dev/test/review plan。

阶段 4 仍然不创建 worktree、不实现代码、不执行 QA、不执行 Review、不 commit、不 push、不归档。

## 阶段 5 Worktree / Patch 边界

\`/imfine worktree prepare\` 创建 run 分支和任务 worktree，写入 Agent 输入，并把 run 推进到实现准备状态。

\`/imfine patch collect\` 从任务 worktree 收集 patch，并按任务 \`write_scope\` 校验变更文件。

阶段 5 仍然不主动修改业务代码、不执行 QA、不执行 Review、不 commit、不 push、不归档。

## 阶段 6 QA / Review 边界

\`/imfine verify\` 在任务 worktree 中执行可运行的任务验证命令，或记录 QA Agent 显式传入的 \`--status\` 判断。QA 失败时，runtime 创建有边界的 fix task，并把 run 推进到 \`needs_dev_fix\`。

\`/imfine review\` 记录独立 Reviewer Agent 的结论。\`changes_requested\` 会创建有边界的 fix task，并把 run 推进到 \`needs_dev_fix\`。

\`/imfine rework design\` 记录实现被设计阻塞，创建 Architect 和 Task Planner 的返工输入，并把 run 推进到 \`needs_design_update\`。

QA 或 Review 连续失败时，应继续生成有边界的 fix task，由 Orchestrator 和各角色 Agent 自主推进解决。

阶段 6 仍然不 commit、不 push、不归档。

## 阶段 7 Commit / Push 边界

\`/imfine commit\` 会把已通过审批的任务 patch 应用到 run branch worktree，并创建任务级 commit 或集成 commit。Runtime 在提交前要求 patch validation、QA pass 和 Review approved 均已完成。

\`/imfine commit resolved\` 支持 Conflict Resolver 把已经在 run worktree 完成的合并结果作为集成 commit 落地。

\`/imfine push\` 在 origin 已配置时推送 \`origin imfine/<run-id>\`。remote 缺失、权限失败或 push 失败都会被记录为明确的 push blocked 证据。

阶段 7 仍然不归档。

## 阶段 8 Archive 边界

归档阶段执行 Archive Agent 确认。需求、设计、任务、QA、Review、commit、push 证据完整时，runtime 写入 run archive、用户报告，并更新 \`.imfine/project\` 长期知识库。

如果证据缺失，归档会写入 blocked 报告和 handoff，但不会把未验证结论写入长期项目知识。

## 阶段 9 新项目等待模型边界

\`/imfine run ...\` 在新的空项目目录中只物化 runtime context，并等待 Architect 和 Task Planner 的模型工作。Runtime 不得为新项目默认生成项目代码、测试、文档、task graph 或验证命令。

不要创建 GitHub、GitLab、云服务、数据库、生产凭据或外部基础设施。

## Agent 边界

阶段 1 不要声称完整多 Agent 交付能力已经可用。只初始化工作空间、运行 doctor，并清晰报告缺失的基础设施。

后续阶段会加入 Intake、Project Analysis、Architect、Task Planner、Dev、QA、Review、Archive、Technical Writer 等多角色编排。

## 交互语言

默认使用中文和用户交流。代码、命令、文件路径、标识符保持原文。
`;
}

export function codexSkillTemplate(language: InstallLanguage): string {
  const body = language === "zh" ? chineseBody("Codex") : englishBody("Codex");
  return `---
name: imfine
description: Use when running the imfine project-level autonomous multi-agent harness from Codex.
---

${body}`;
}

export function claudeCommandTemplate(language: InstallLanguage): string {
  return language === "zh" ? chineseBody("Claude Code") : englishBody("Claude Code");
}
