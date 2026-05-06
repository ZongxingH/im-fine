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
- \`/imfine resume <run-id>\`
- \`/imfine report <run-id>\`
- \`/imfine archive <run-id>\`

## Runtime

The deterministic runtime is installed under \`~/.imfine/runtime\`.

Use it only for materializing state, initializing \`.imfine\`, checking infrastructure, installing entries, and other deterministic actions:

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js <command>
\`\`\`

## Debug / Recovery Runtime Commands

- \`/imfine init\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js init\` from the project root.
- \`/imfine run <requirement text|requirement-file>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js run <requirement text|requirement-file>\` from the project root. In an empty new-project directory this completes the first delivery run.
- \`/imfine run <requirement text|requirement-file> --plan-only\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js run <requirement text|requirement-file> --plan-only\` when the Agent intentionally wants to stop at planning.
- \`/imfine resume <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js resume <run-id>\` to infer next actions, persist queue state, and route ready Agent work.
- \`/imfine agents prepare <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents prepare <run-id>\` to generate model execution packages from ready Agent runs and their skills.
- \`/imfine agents execute <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents execute <run-id> --executor "<model runner>"\` when an external model runner is configured. Use \`--dry-run\` to only validate dispatch.
- \`/imfine orchestrate <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js orchestrate <run-id> --executor "<model runner>"\` to let runtime progress deterministic actions while model agents handle intelligent work.
- \`/imfine run <requirement text|requirement-file> --auto\`: use with \`--executor "<model runner>"\` for existing-project automatic delivery.
- \`/imfine plan <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js plan <run-id>\` from the project root.
- \`/imfine worktree prepare <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js worktree prepare <run-id>\` from the project root.
- \`/imfine patch collect <run-id> <task-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js patch collect <run-id> <task-id>\`.
- \`/imfine patch validate <run-id> <task-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js patch validate <run-id> <task-id>\`.
- \`/imfine verify <run-id> <task-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js verify <run-id> <task-id>\`. If verification is model-judged rather than command-based, pass \`--status pass|fail|blocked --summary "<summary>"\` after QA Agent decides.
- \`/imfine review <run-id> <task-id>\`: after Reviewer Agent makes a decision, run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js review <run-id> <task-id> --status approved|changes_requested|blocked --summary "<summary>"\`.
- \`/imfine rework design <run-id> <task-id>\`: when implementation is blocked by design, run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js rework design <run-id> <task-id> --summary "<summary>"\`.
- \`/imfine commit task <run-id> <task-id>\`: after patch validation, QA pass, and Review approval, run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js commit task <run-id> <task-id>\`.
- \`/imfine commit run <run-id> --mode task|integration\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js commit run <run-id> --mode task|integration\` to preserve task commits or create one integration commit.
- \`/imfine commit resolved <run-id> [task-id...]\`: after Conflict Resolver has merged changes in the run worktree, run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js commit resolved <run-id> [task-id...]\`.
- \`/imfine push <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js push <run-id>\` to push \`origin imfine/<run-id>\` and record push evidence.
- \`/imfine archive <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js archive <run-id>\` to confirm evidence, write archive reports, and update project knowledge.
- \`/imfine status\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js status\` from the project root.
- \`/imfine report <run-id>\`: run \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js report <run-id>\` from the project root.

Use \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js doctor\` when infrastructure status is needed.

## Init Workflow

When the user runs \`/imfine init\`, the current session must act as Orchestrator rather than only forwarding the runtime command:

1. Inspect the project root read-only and classify it as empty or existing.
2. Identify evidence such as language, framework, entry points, modules, tests, build config, and middleware markers. Do not invent architecture without evidence.
3. Call the deterministic runtime:
   \`\`\`bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js init
   \`\`\`
4. Read the runtime result and \`.imfine/project/architecture/\`.
5. For existing projects, start or use an internal Architect Agent to complete model-driven architecture analysis:
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

\`/imfine agents prepare <run-id>\` turns the Orchestrator's ready Agent runs into model execution packages under \`.imfine/runs/<run-id>/agents/<agent-id>/execution/\`.

Each package includes the Agent contract, skill bundle, model input prompt, boundaries, required outputs, and handoff expectations. The model must make architecture, implementation, QA, Review, conflict, and archive judgments; runtime only materializes the prompt package and records execution evidence.

\`/imfine agents execute <run-id>\` can run ready packages through a configured model runner. The command can be supplied with \`--executor "<command>"\` or \`IMFINE_AGENT_EXECUTOR\`. Runtime passes the prompt on stdin and sets \`IMFINE_RUN_ID\`, \`IMFINE_AGENT_ID\`, \`IMFINE_AGENT_ROLE\`, \`IMFINE_AGENT_PROMPT\`, and \`IMFINE_AGENT_OUTPUT_DIR\`.

If no provider bridge or model executor is available, the run must remain waiting for model configuration or enter a clear blocked state. Do not silently complete the whole workflow as one undifferentiated Agent.

## Existing-Project Auto Orchestration

\`/imfine run ... --auto --executor "<model runner>"\` and \`/imfine orchestrate <run-id> --executor "<model runner>"\` run the autonomous delivery loop for existing projects.

The loop only performs deterministic runtime actions itself: prepare worktrees, collect patches after Dev/Writer agents edit their worktrees, record QA/Review decisions from model handoffs, commit approved patches, push the run branch when possible, and archive verified evidence. Product, architecture, implementation, QA, Review, and conflict decisions remain model Agent responsibilities.

For new projects, \`/imfine run ... --auto --executor "<model runner>"\` first runs Architect and Task Planner model packages. Architect must write \`.imfine/runs/<run-id>/design/stack-decision.json\`; Task Planner must write the task graph and execution plan. Runtime validates those model outputs before preparing worktrees.

## Phase 3 Run Boundary

\`/imfine run\` currently creates a delivery run from text or a requirement file and generates project context, requirement analysis, impact analysis, risk analysis, solution design, architecture decisions, and acceptance criteria.

Do not claim implementation, task graph generation, commits, push, QA, review, or archive have happened in phase 3.

## Phase 4 Plan Boundary

\`/imfine run\` now also creates a runtime-validated task graph, ownership map, execution plan, commit plan, and per-task dev/test/review plans.

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

\`/imfine archive\` runs Archive Agent confirmation. If requirement, design, task, QA, Review, commit, and push evidence are complete, runtime writes the run archive, user report, and updates \`.imfine/project\` long-term knowledge.

If evidence is missing, archive writes a blocked report and handoff, but does not update long-term project knowledge with unverified claims.

## Phase 9 New Project Delivery Boundary

\`/imfine run ...\` completes the first delivery for empty new-project directories by default. It initializes git and \`.imfine\`, creates the first project code, tests, docs, local task commits on \`imfine/<run-id>\`, records missing remote as \`push_blocked_no_remote\`, and archives the completed delivery.

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
- \`/imfine resume <run-id>\`
- \`/imfine report <run-id>\`
- \`/imfine archive <run-id>\`

## Runtime

确定性 runtime 安装在 \`~/.imfine/runtime\`。

只有在需要初始化 \`.imfine\`、检查基础设施、安装入口或执行其他确定性动作时，才调用 runtime：

\`\`\`bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js <command>
\`\`\`

## 调试 / 恢复 Runtime 命令

- \`/imfine init\`：在项目根目录执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js init\`。
- \`/imfine run <需求文本|需求文件>\`：在项目根目录执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js run <需求文本|需求文件>\`。在新的空项目目录中会默认完成首个 delivery run。
- \`/imfine run <需求文本|需求文件> --plan-only\`：当 Agent 明确只希望停在规划阶段时，执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js run <需求文本|需求文件> --plan-only\`。
- \`/imfine resume <run-id>\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js resume <run-id>\`，推断下一步、持久化 queue，并路由可执行的 Agent 工作。
- \`/imfine agents prepare <run-id>\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents prepare <run-id>\`，基于 ready Agent run 和 skill 生成模型执行包。
- \`/imfine agents execute <run-id>\`：配置外部模型 runner 后执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js agents execute <run-id> --executor "<model runner>"\`。使用 \`--dry-run\` 只校验调度。
- \`/imfine orchestrate <run-id>\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js orchestrate <run-id> --executor "<model runner>"\`，由 runtime 推进确定性动作，由模型 Agent 完成智能工作。
- \`/imfine run <需求文本|需求文件> --auto\`：配合 \`--executor "<model runner>"\` 用于已有项目自动交付。
- \`/imfine plan <run-id>\`：在项目根目录执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js plan <run-id>\`。
- \`/imfine worktree prepare <run-id>\`：在项目根目录执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js worktree prepare <run-id>\`。
- \`/imfine patch collect <run-id> <task-id>\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js patch collect <run-id> <task-id>\`。
- \`/imfine patch validate <run-id> <task-id>\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js patch validate <run-id> <task-id>\`。
- \`/imfine verify <run-id> <task-id>\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js verify <run-id> <task-id>\`。如果验证依赖模型判断而不是命令执行，QA Agent 做出结论后传入 \`--status pass|fail|blocked --summary "<摘要>"\`。
- \`/imfine review <run-id> <task-id>\`：Reviewer Agent 做出结论后，执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js review <run-id> <task-id> --status approved|changes_requested|blocked --summary "<摘要>"\`。
- \`/imfine rework design <run-id> <task-id>\`：实现被设计阻塞时，执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js rework design <run-id> <task-id> --summary "<摘要>"\`。
- \`/imfine commit task <run-id> <task-id>\`：patch validation、QA pass、Review approved 之后执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js commit task <run-id> <task-id>\`。
- \`/imfine commit run <run-id> --mode task|integration\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js commit run <run-id> --mode task|integration\`，按任务保留多个 commit 或创建一个集成 commit。
- \`/imfine commit resolved <run-id> [task-id...]\`：Conflict Resolver 已经在 run worktree 合并完成后，执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js commit resolved <run-id> [task-id...]\`。
- \`/imfine push <run-id>\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js push <run-id>\`，推送 \`origin imfine/<run-id>\` 并记录 push 证据。
- \`/imfine archive <run-id>\`：执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js archive <run-id>\`，确认证据、生成归档报告并更新项目知识。
- \`/imfine status\`：在项目根目录执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js status\`。
- \`/imfine report <run-id>\`：在项目根目录执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js report <run-id>\`。

需要检查基础设施状态时，执行 \`node ~/.imfine/runtime/dist/cli/imfine-runtime.js doctor\`。

## Init 工作流

当用户执行 \`/imfine init\` 时，当前会话必须作为 Orchestrator 完成初始化，而不是只机械转发 runtime 命令：

1. 先只读检查项目根目录，判断是空项目还是已有项目。
2. 识别语言、框架、入口、模块、测试、构建配置、中间件线索等证据；不要编造没有证据的架构。
3. 调用确定性 runtime：
   \`\`\`bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js init
   \`\`\`
4. 读取 runtime 返回和 \`.imfine/project/architecture/\`。
5. 如果是已有项目，启动或使用内部 Architect Agent 执行模型驱动的架构分析：
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

\`/imfine agents prepare <run-id>\` 会把 Orchestrator 识别出的 ready Agent run 转成模型执行包，位置在 \`.imfine/runs/<run-id>/agents/<agent-id>/execution/\`。

每个执行包包含 Agent 契约、skill bundle、模型输入 prompt、边界、必需输出和 handoff 要求。架构、实现、QA、Review、冲突处理和归档判断必须由模型完成；runtime 只负责生成执行包和记录执行证据。

\`/imfine agents execute <run-id>\` 可以用配置好的模型 runner 执行 ready 包。命令可通过 \`--executor "<command>"\` 或 \`IMFINE_AGENT_EXECUTOR\` 提供。Runtime 会把 prompt 传给 stdin，并设置 \`IMFINE_RUN_ID\`、\`IMFINE_AGENT_ID\`、\`IMFINE_AGENT_ROLE\`、\`IMFINE_AGENT_PROMPT\`、\`IMFINE_AGENT_OUTPUT_DIR\`。

如果当前 provider bridge 或模型 executor 不可用，run 必须保持等待模型配置，或进入明确 blocked 状态。不要静默降级成一个单 Agent 完成全流程。

## 已有项目自动编排

\`/imfine run ... --auto --executor "<model runner>"\` 和 \`/imfine orchestrate <run-id> --executor "<model runner>"\` 会对已有项目执行自主交付 loop。

这个 loop 只自己执行确定性 runtime 动作：准备 worktree、在 Dev/Writer Agent 修改 worktree 后收集 patch、根据模型 handoff 记录 QA/Review、提交已批准 patch、可行时 push run 分支、归档已验证证据。产品、架构、实现、QA、Review 和冲突处理判断仍然由模型 Agent 负责。

对于新项目，\`/imfine run ... --auto --executor "<model runner>"\` 会先执行 Architect 和 Task Planner 模型执行包。Architect 必须写入 \`.imfine/runs/<run-id>/design/stack-decision.json\`；Task Planner 必须写入 task graph 和 execution plan。Runtime 只在这些模型产物校验通过后准备 worktree。

## 阶段 3 Run 边界

\`/imfine run\` 当前会从需求文本或需求文件创建 delivery run，并生成项目上下文、需求分析、影响面分析、风险分析、方案设计、架构决策和验收标准。

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

\`/imfine archive\` 执行 Archive Agent 确认。需求、设计、任务、QA、Review、commit、push 证据完整时，runtime 写入 run archive、用户报告，并更新 \`.imfine/project\` 长期知识库。

如果证据缺失，归档会写入 blocked 报告和 handoff，但不会把未验证结论写入长期项目知识。

## 阶段 9 新项目交付边界

\`/imfine run ...\` 在新的空项目目录中默认完成首个 delivery。它会初始化 git 和 \`.imfine\`，创建首批项目代码、测试、文档，在 \`imfine/<run-id>\` 上完成本地任务 commit，把缺失 remote 记录为 \`push_blocked_no_remote\`，并完成归档。

不要创建 GitHub、GitLab、云服务、数据库、生产凭据或外部基础设施。

## Agent 边界

阶段 1 不要声称完整多 Agent 交付能力已经可用。只初始化工作空间、运行 doctor，并清晰报告缺失的基础设施。

后续阶段会加入 Intake、Project Analysis、Architect、Task Planner、Dev、QA、Review、Archive、Technical Writer 等多角色编排。

## 交互语言

默认使用中文和用户交流。代码、命令、文件路径、标识符保持原文。
`;
}

export function codexSkillTemplate(language: InstallLanguage): string {
  return language === "zh" ? chineseBody("Codex") : englishBody("Codex");
}

export function claudeCommandTemplate(language: InstallLanguage): string {
  return language === "zh" ? chineseBody("Claude Code") : englishBody("Claude Code");
}
