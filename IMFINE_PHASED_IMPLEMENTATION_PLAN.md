# imfine 项目级自主多 Agent Harness 分阶段实现方案

## 1. 目标定义

imfine 是一个面向真实软件项目交付的项目级自主多 Agent harness。

它不是规格工具，不是 OpenSpec、Superpowers、BMAD 的运行时 adapter，也不会要求用户先安装这些外部工具。imfine 会基于这些开源项目和公开方法论的源码、prompt、agent、skill、workflow、模板进行源码级吸收和改造，形成自己的 Agent 库、Skill 库、运行时、安装产物和项目工作空间。

最终用户体验：

```text
/imfine run "给订单列表增加按支付状态筛选"
```

或：

```text
/imfine run docs/requirements/order-filter.md
```

imfine 自动完成：

```text
需求输入
  -> 项目识别：新项目 / 已有项目
  -> 基础设施检查：git、remote、分支、权限、包管理器、测试命令、Codex/Claude 安装目标
  -> 项目上下文分析
  -> 需求分析
  -> 方案设计
  -> 风险识别
  -> 任务拆解
  -> 每个任务生成可执行 plan
  -> 创建 imfine/<run-id> 分支
  -> 多 Dev Agent 按边界并行开发
  -> QA Agent 测试和补充验证
  -> Review Agent 审查
  -> 冲突、失败、设计偏差自动返工
  -> 按任务 commit
  -> push 到 origin imfine/<run-id>
  -> Archive Agent 确认并归档
  -> 更新项目长期知识库
```

imfine 同时支持两类项目：

- 新项目：从一句话、需求文档或 PRD 开始，自动补齐产品分析、技术选型、架构设计、项目初始化、测试体系、首批功能、commit、push 和归档。
- 已有项目：先从代码、配置、测试、文档中建立项目上下文，再在现有架构和约定内完成需求交付。

## 2. 非目标

- 不把 imfine 做成 OpenSpec clone。
- 不把 imfine 做成 BMAD 菜单系统。
- 不要求用户安装 OpenSpec、Superpowers、BMAD。
- 不把 `/imfine` 降级成一串用户手动执行的命令。
- 不让多个 Agent 直接在同一个工作区无边界写文件。
- 不让 Dev Agent 自己宣布交付完成。
- 不把需求分析、架构判断、Review 判断硬编码进 runtime。

## 3. 外部项目能力吸收策略

### 3.1 OpenSpec

可吸收内容：

- slash command 面向 AI coding assistant 的安装形态。
- change 目录中的 `proposal.md`、`design.md`、`tasks.md`、spec delta。
- specs 按 capability 组织的长期知识结构。
- archive 后把变更沉淀为当前事实的思想。
- 轻量、可迭代、brownfield-first 的规格实践。

不吸收为核心：

- 不以 OpenSpec change 作为 imfine 的顶层生命周期。
- 不把 OpenSpec CLI 作为运行时依赖。
- 不要求每个小需求都完整走规格级流程。

imfine 中的改造形态：

```text
.imfine/runs/<run-id>/analysis/
.imfine/runs/<run-id>/design/
.imfine/runs/<run-id>/tasks/
.imfine/runs/<run-id>/spec-delta/
.imfine/project/capabilities/
```

`change` 可以是 run 内部产物，但顶层对象是 `delivery run`。

### 3.2 Superpowers

可吸收内容：

- brainstorming / clarify：用于需求理解和问题澄清。
- writing-plans：用于生成可执行、可验证的任务计划。
- executing-plans：用于分批执行、检查点、证据记录。
- test-driven-development：用于新行为优先测试。
- systematic-debugging：用于失败复现、根因定位、假设验证。
- subagent development with code review：用于多 Agent 开发和独立 review。
- code-reviewer agent 的审查协议。

不吸收为核心：

- 不依赖 Claude plugin 安装结构。
- 不把 Superpowers 的 slash command 原样暴露给用户。

imfine 中的改造形态：

```text
imfine/skills/
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

这些 skill 是所有角色 Agent 的工作纪律，而不是用户手动选择的命令。

### 3.3 BMAD

可吸收内容：

- 多角色 Agent 体系。
- Analysis / Planning / Solutioning / Implementation 的阶段化上下文工程。
- PM、Architect、Developer、QA/Test Architect、Technical Writer、Master/Orchestrator 等角色定义。
- Quick Flow 与完整流程的分级思想。
- Project Context 作为长期项目规则和上下文。
- story / task 的聚焦上下文机制。
- adversarial review 和 implementation readiness gate。

不吸收为核心：

- 不保留复杂菜单系统。
- 不要求用户选择角色或 workflow。
- 不按 BMAD 安装结构运行。
- 不把 PM/SM/UX 等角色全部固定为每次必跑。

imfine 中的改造形态：

```text
imfine/agents/
  orchestrator.md
  intake-analyst.md
  product-planner.md
  architect.md
  task-planner.md
  dev.md
  qa.md
  reviewer.md
  conflict-resolver.md
  committer.md
  archive.md
  technical-writer.md
```

Orchestrator 按项目类型、需求复杂度和风险动态选择角色，不让用户参与角色调度。

## 4. 安装形态

imfine 安装后应能在 Codex 和 Claude 中通过 `/imfine` 使用。

安装命令示例：

```bash
npx github:<owner>/<repo> install
npx github:<owner>/<repo> install --target codex
npx github:<owner>/<repo> install --target claude
npx github:<owner>/<repo> install --target all
npx github:<owner>/<repo> install --target all --lang zh
npx github:<owner>/<repo> install --target all --lang en
```

`install` 默认等价于 `--target all`，因此通过 GitHub 执行安装后，应直接在 Codex 和 Claude 中都能使用 `/imfine`。
安装时支持 `--lang zh|en` 指定交互语言和输出产物语言，目前只支持中文和英文，默认中文。

Codex 目标产物：

```text
~/.codex/skills/imfine/SKILL.md
~/.imfine/runtime/
```

Claude 目标产物：

```text
~/.claude/commands/imfine.md
~/.imfine/runtime/
```

Claude 第一阶段只生成 `~/.claude/commands/imfine.md`。如果后续 Claude Code 的 agent 文件能力对调度有明确收益，再作为增强项加入。

设计原则：

- `/imfine` 是用户入口。
- runtime CLI 是内部确定性能力，不作为用户主入口。
- runtime 使用 TypeScript/npm 实现和分发。
- npm 包主入口为 `imfine`，内部确定性 runtime bin 可命名为 `imfine-runtime`，两者由同一个 TypeScript/npm 包提供。
- 安装入口只支持 `npx github:<owner>/<repo> install ...` 形态，不支持用户直接运行 `imfine install ...`。
- Codex 和 Claude 使用两套安装产物，但共享 `.imfine` 项目工作空间和 `~/.imfine/runtime`。
- 安装产物必须说明如何调用当前工具的子 Agent 能力。
- 如果当前工具不支持独立子 Agent，默认阻塞，不静默降级为单 Agent 全流程，除非用户明确允许。

## 5. 项目工作空间

每个项目根目录生成：

```text
.imfine/
  config.yaml
  library.md
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
    capabilities/
      <capability>/spec.md
  agents/
    orchestrator.md
    intake.md
    project-analyzer.md
    product-planner.md
    architect.md
    task-planner.md
    dev.md
    qa.md
    reviewer.md
    conflict-resolver.md
    committer.md
    archive.md
    technical-writer.md
    risk-reviewer.md
    project-knowledge-updater.md
  skills/
    clarify.md
    project-analysis.md
    write-delivery-plan.md
    execute-task-plan.md
    tdd.md
    systematic-debugging.md
    parallel-agent-dispatch.md
    code-review.md
    archive-confirmation.md
  templates/
    handoff.schema.json
    task-graph.schema.json
    requirement-analysis.md
    solution-design.md
    task.md
    archive-report.md
  runs/
    <run-id>/
      run.json
      request/
        input.md
        normalized.md
        source.json
      analysis/
        project-context.md
        requirement-analysis.md
        impact-analysis.md
        risk-analysis.md
        product-analysis.md
      design/
        solution-design.md
        architecture-decisions.md
        technical-solution.md
        acceptance.md
      planning/
        task-graph.json
        ownership.json
        execution-plan.md
        commit-plan.md
      spec-delta/
        proposal.md
        design.md
        tasks.md
      tasks/
        <task-id>/
          task.md
          dev-plan.md
          test-plan.md
          review-plan.md
          status.json
          evidence.md
      agents/
        <agent-run-id>/
          input.md
          output.md
          status.json
          commands.md
          patch.diff
      worktrees/
        index.json
      orchestration/
        state.json
        infrastructure-gate.json
        agent-runs.json
        parallel-plan.json
        action-ledger.json
        timeline.md
        auto-timeline.md
        checkpoints/
      evidence/
        infrastructure.md
        dependency-install.md
        commands.md
        test-results.md
        review.md
        conflicts.md
        commits.md
        push.md
        patch-risks.md
      archive/
        archive-report.md
        project-updates.md
        final-summary.md
  state/
    current.json
    locks.json
    queue.json
  reports/
    <run-id>.md
```

说明：

- `.imfine/runs/<run-id>` 保存一次交付的完整证据链。
- `.imfine/project` 保存跨 run 的长期项目知识。
- `.imfine/project/capabilities` 吸收 OpenSpec 的 capability spec 思想，但不把它作为唯一事实来源。
- `.imfine/runs/<run-id>/spec-delta/` 保存 run-local proposal/design/tasks delta，归档时由 Archive Agent 消费并沉淀进 capability spec。
- `.imfine/runs/<run-id>/orchestration/` 保存 Orchestrator 的 action queue、agent registry、parallel plan、action ledger、checkpoint、timeline 和 infrastructure gate。
- `agents/<agent-run-id>/` 下展示的是常见产物，不同角色可以有不同子结构；例如 Dev Agent 通常包含 `commands.md`、`patch.diff`、`status.json`，QA / Reviewer 以 handoff、status 和 evidence 为主，run-level model execution 会包含 `execution/model-input.md`、`execution-status.json`、stdout/stderr。
- `evidence/` 下展示的是常见证据类型，不要求每个 run 都生成所有文件；实际生成内容由 Orchestrator action、Agent handoff 和 runtime gate 决定。
- 归档时 Archive Agent 会确认 run 产物，并反向更新 `.imfine/project`。
- `.imfine` 默认可提交进业务仓库。建议提交 `.imfine/config.yaml`、`.imfine/project/**`、`.imfine/reports/**`、归档报告和关键 evidence；大量 agent 中间日志、临时 worktree 索引和可再生成的运行细节可配置忽略。

## 6. 用户命令

用户入口保持少。

```text
/imfine init
/imfine run "需求"
/imfine run docs/requirements/xxx.md
/imfine status
/imfine report <run-id>
/imfine resume <run-id>
/imfine archive <run-id>
```

内部 runtime 可以有更多命令，但不作为主交互：

```bash
imfine-runtime init
imfine-runtime doctor
imfine-runtime run <requirement text|requirement-file>
imfine-runtime resume <run-id>
imfine-runtime orchestrate <run-id>
imfine-runtime task graph validate
imfine-runtime worktree prepare
imfine-runtime patch collect
imfine-runtime patch validate
imfine-runtime verify
imfine-runtime review
imfine-runtime rework design
imfine-runtime commit
imfine-runtime push
imfine-runtime archive
imfine-runtime status
imfine-runtime report
imfine-runtime agents list|show <id>
imfine-runtime agents prepare <run-id>
imfine-runtime agents execute <run-id>
imfine-runtime skills list|show <id>
imfine-runtime templates list|show <id>
imfine-runtime library sync
```

当前实现中，`/imfine run "需求"` 已是默认自主交付入口：

- 用户不需要传 `--auto`。
- 用户不需要传 `--executor`；`/imfine` 运行在 Codex / Claude 大模型会话中，由当前主会话读取模型执行包并执行或分发 Agent 工作。`--executor` 只作为非交互 runner 的内部/测试桥接。
- 用户不需要手动执行 `agents execute`、`orchestrate` 或 `commit resolved`。
- `--plan-only` 作为内部调试/明确停在计划阶段的能力保留。
- deterministic new-project vertical slice 只作为内部 debug/test 路径保留，不作为用户主入口。
- `/imfine` 安装文档的用户主入口聚焦 `init`、`run`、`status`、`resume`、`report`、`archive`，内部 runtime 命令归入调试/恢复说明。

## 7. init 和基础设施检查

`/imfine init` 同时支持新项目和已有项目。

`/imfine init` 不只是创建目录。它是项目级 harness 的初始化入口：

- 空项目：创建 `.imfine` 工作空间、基础项目知识库、状态文件和后续新项目交付所需目录。
- 已有项目：创建 `.imfine` 工作空间，同时生成 `.imfine/project/architecture/` 下的架构文档草稿，并为 Architect Agent 准备基于证据补全架构的输入。
- Runtime 只做确定性项目扫描和占位落盘；最终架构分析必须由当前模型会话中的 Architect Agent 基于文件证据补全。
- 每个架构结论必须引用文件证据；证据不足时标记未知，不得猜测。
- 参考本地 `harness-test` 的 `/auok init`：先由 runtime materialize 工作空间和架构占位，再由 Orchestrator 调用 Architect Agent 完成模型驱动分析。

已有项目初始化时建议生成以下架构文档：

```text
.imfine/project/architecture/
  overview.md
  tech-stack.md
  modules.md
  module-tech-stack.md
  entrypoints.md
  test-strategy.md
  risks.md
```

### 7.1 检查项

- 当前目录是否为 git 仓库。
- 是否存在 remote。
- 是否可以读取当前分支。
- 是否有未提交变更。
- 是否可以创建分支。
- 是否可以 push 到 remote。
- 是否存在包管理器和 lockfile。
- 是否存在测试、lint、typecheck、build 命令。
- 是否已安装目标工具入口：Codex skill 或 Claude command。
- 是否存在项目初始化所需基础设施。

### 7.2 缺失处理

imfine 可以自动完成低风险初始化，例如创建 `.imfine` 目录、写配置、生成项目知识库初稿。

对于外部基础设施缺失：

- 没有 git：提示用户初始化 git，或在新项目场景由 imfine 初始化。
- 没有 remote：提示用户配置 remote；新项目可以先完成本地 commit，push 阶段阻塞。
- 无 push 权限：完成本地交付和归档候选，标记 push blocked。
- 无测试命令：由 Agent 尝试识别或补充；无法补充时记录风险。
- 需要安装依赖：默认允许自动执行，但必须记录命令和结果。

push 策略采用 `doctor` 前置检查：不是无条件盲目 push，而是在 `/imfine init` 或 `/imfine run` 早期检查 remote、权限和分支状态；检查通过后默认自动 push，检查失败或执行失败则进入明确的 push blocked 状态。

自动安装依赖仅限项目内包管理器命令，例如 `npm install`、`pnpm install`、`yarn install`、`pip install -r requirements.txt`、`mvn install` 等。系统级安装、修改 shell 环境、安装数据库、创建云资源、配置外部服务等不自动执行，只记录阻塞原因或建议动作。

当前实现：

- `/imfine run` / `resume` 会由 Orchestrator 自动执行 `doctor`，并写入 `.imfine/runs/<run-id>/orchestration/infrastructure-gate.json`。
- gate fail 会生成内部 `gate-infrastructure` action；自动编排遇到 gate blocker 时进入 `needs_infrastructure_action`。
- gate warning 会记录为 `ready_with_warnings`，不会无条件阻断开发。
- gate blocker 会写入 `.imfine/runs/<run-id>/evidence/infrastructure.md` 和用户后续动作。
- 依赖安装由 Orchestrator 在需要时自动插入内部 `runtime-dependency-install` action。
- 支持 npm / pnpm / yarn / pip requirements / mvn 等项目内安装命令记录；依赖安装使用长时任务友好的超时窗口，当前为 2 分钟，并把命令、stdout、stderr、exit code 和失败原因写入 `.imfine/runs/<run-id>/evidence/dependency-install.md`。
- pip 安装要求项目本地 `.venv`；系统级安装、shell 环境修改、数据库、云资源和外部服务不会自动执行。
- `doctor` 同时检查 Codex / Claude 入口和 provider bridge 能力，并按 `entry_installed`、`session_orchestrator`、`subagent_supported` 分级记录 provider capability；当前无法证明真实子 Agent 能力时记录 `subagent_supported=unknown`，由当前大模型会话保持角色边界执行 ready Agent 工作，或让 run 保持 `waiting_for_model`。

## 8. Delivery Run 生命周期

核心状态：

```text
created
  -> infrastructure_checked
  -> project_analyzed
  -> requirement_analyzed
  -> designed
  -> planned
  -> branch_prepared
  -> implementing
  -> integrating
  -> verifying
  -> reviewing
  -> committing
  -> pushing
  -> archiving
  -> archived
```

异常状态：

```text
blocked
needs_requirement_reanalysis
needs_design_update
needs_task_replan
needs_dev_fix
needs_conflict_resolution
needs_infrastructure_action
```

原则：

- Agent 决定语义状态是否满足。
- Runtime 只做状态合法性、文件存在性、边界、命令、证据和 git 操作校验。
- 失败后由 Orchestrator 自主回流，不默认问用户。
- 只有基础设施、权限、生产风险、最终破坏性动作等无法安全假设时才阻塞用户。

当前实现：

- run / task 状态统一通过集中 transition API 更新。
- runtime 已定义完整 run lifecycle、异常状态和合法迁移图。
- 非法 run / task 状态迁移会记录 recoverable blocker，不静默覆盖。
- `/imfine run` / `orchestrate` 推进前会获取 run-level lock；runtime / agent action 执行前会获取 action-level lock。
- 每个 action 执行前后都会写 checkpoint；`waiting_for_model`、`blocked`、`failed`、`completed` 都有 checkpoint / timeline evidence。
- action ledger 会持久记录 completed action，重复 resume / run 不会重复执行同一 completed action。
- stale lock 可由 Orchestrator / resume 根据时间、状态和 evidence 自主恢复。

## 9. Agent 体系

### 9.1 Orchestrator Agent

职责：

- 解析 `/imfine` 命令。
- 判断新项目 / 已有项目。
- 调用 runtime 做确定性初始化、状态、worktree、commit、push。
- 选择 Agent 和 Skill。
- 拆分任务并维护任务图。
- 按 `read_scope`、`write_scope` 和依赖调度并行 Agent。
- 收集 handoff、patch、命令、测试、review、commit、push、archive 证据。
- 失败时自主返工。

不可做：

- 不直接替代所有角色写完整实现。
- 不跳过 QA / Review / Archive gate。
- 不假装并行安全。

### 9.2 Intake Analyst Agent

职责：

- 接收一句话、文档、issue、PRD 等需求输入。
- 规范化需求。
- 标记业务歧义、约束、非目标、验收标准候选。
- 新项目时补充产品定位、用户、核心流程、范围边界。

### 9.3 Product Planner Agent

职责：

- 新项目或复杂需求时生成产品分析、PRD 级产物、功能边界。
- 对已有项目的小需求可跳过或轻量运行。

来源参考：

- BMAD PM / Analyst。
- Superpowers brainstorming / clarify。

### 9.4 Architect Agent

职责：

- 分析架构、模块边界、数据流、依赖、风险。
- 新项目时选择技术栈和架构。
- 已有项目时遵守当前架构和约定。
- 给 Task Planner 提供可拆分边界。

来源参考：

- BMAD Architect。
- BMAD project-context。
- OpenSpec design。

### 9.5 Task Planner Agent

职责：

- 把设计拆成任务图。
- 每个任务必须有明确边界和验收。
- 判断哪些任务可并行，哪些必须串行。
- 生成每个任务的 dev/test/review/commit plan。

输出示例：

```json
{
  "run_id": "20260430-order-filter",
  "tasks": [
    {
      "id": "T1",
      "title": "Add backend payment status query support",
      "type": "dev",
      "depends_on": [],
      "read_scope": ["backend/**", ".imfine/runs/20260430-order-filter/**"],
      "write_scope": ["backend/order/**", "backend/**/order/**"],
      "acceptance": ["API accepts paymentStatus", "existing filters still work"],
      "verification": ["backend unit tests"],
      "commit": {
        "mode": "task",
        "message": "feat(order): support payment status filtering"
      }
    }
  ]
}
```

### 9.6 Dev Agent

职责：

- 在独立 worktree 中按任务实现。
- 遵守 `write_scope`。
- 写或更新测试。
- 记录命令和结果。
- 生成 patch 和 handoff。

### 9.7 QA Agent

职责：

- 独立运行测试、lint、typecheck、build、场景验证。
- 补充回归测试。
- 复现失败并给出根因候选。
- 失败时输出给 Dev 的修复任务。

### 9.8 Reviewer Agent

职责：

- 对照需求、设计、任务边界、测试证据审查 diff。
- 检查无关改动、风险、兼容性、安全、性能、可维护性。
- 输出 approved 或 changes_requested。

### 9.9 Conflict Resolver Agent

职责：

- 当多个任务 patch 冲突或边界无法完全隔离时介入。
- 读取冲突上下文、任务意图、测试证据。
- 合并 patch、解决冲突、保留行为。
- 触发集成测试和 Review。

### 9.10 Committer Agent

职责：

- 根据 commit plan 审查 commit readiness、commit mode、证据链和分支策略。
- 确认 patch validation、QA、Review evidence 齐全。
- 输出 commit readiness handoff，供 Orchestrator 决定是否推进 runtime commit。
- 不直接执行 `git commit` 或 `git push`；git materialization 始终由 runtime 确定性执行。

当前实现：

- Committer Agent 已有源码级契约、输入、输出、禁止事项和 handoff schema。
- Committer Agent 已能进入 Orchestrator 动态调度；runtime `commit` / `push` 仍负责真正的 git 操作和证据记录。
- Orchestrator 会消费 `agents/committer/handoff.json`；`status=ready` 才记录 commit readiness 通过，`status=blocked` 会进入可恢复 blocked，不推进 runtime commit。

### 9.11 Archive Agent

职责：

- 确认设计、开发、测试、review、commit、push 证据链完整。
- 生成归档报告。
- 更新 `.imfine/project` 长期知识库。
- 标记遗留风险和后续建议。

### 9.12 Project Analyzer / Risk Reviewer / Project Knowledge Updater / Technical Writer

当前实现中补齐的支撑角色：

- Project Analyzer：读取项目证据，输出架构、模块边界、测试命令和 unknowns。
- Risk Reviewer：审查设计和任务边界中的安全、数据、生产配置、依赖、测试和并行风险。
- Technical Writer：在归档前整理技术摘要、文档和最终说明。
- Project Knowledge Updater：在 Archive Agent 确认证据链后更新 `.imfine/project/**` 和 capability notes。

这些角色由 Orchestrator 动态选择，不要求用户手动选择，也不按 BMAD 菜单系统暴露。

当前实现会消费这些 run-level 支撑角色的 handoff：

- Risk Reviewer 支持 `ready|blocked|needs_replan`，由 Orchestrator 决定继续、阻塞或进入 replan。
- Technical Writer 支持 `ready|not_needed|blocked`，用于归档前文档整理确认。
- Project Knowledge Updater 支持 `ready|blocked`，用于归档前项目知识更新确认。

## 10. 任务拆分、并行和冲突策略

### 10.1 优先任务级并行

如果任务有非重叠 `write_scope`：

```text
T1 backend/order/**
T2 frontend/src/pages/orders/**
T3 docs/order-filter/**
```

则：

- 每个任务创建独立 worktree。
- 每个任务由独立 Dev Agent 实现。
- 每个任务独立测试。
- 每个任务生成独立 patch。
- 集成分支按依赖顺序应用 patch。
- 每个任务一个 commit。

### 10.2 不能安全拆分时

如果多个任务会修改同一批文件或边界不明确：

- 降低并行度。
- 将任务合并为串行批次。
- 或使用共享设计 + 独立试验 + Conflict Resolver 集成。
- 最终以集成 commit 或少量 task commit 落地。

系统不能为了并行而伪造边界。

### 10.3 多角色并行

多 Agent 并行不只限 Dev Agent。imfine 应支持所有具备明确输入、输出、依赖和写入边界的角色并行：

- 需求和项目分析阶段：Intake Analyst、Project Analyzer、Product Planner、Architect 可并行读取不同上下文。
- 设计和计划阶段：Architect、Task Planner、Risk Reviewer 可并行或流水线协作。
- 开发阶段：多个 Dev Agent 按 `write_scope` 并行。
- 验证阶段：多个 QA Agent 按模块、测试类型、端到端场景或风险域并行。
- 审查阶段：多个 Reviewer Agent 按代码实现、架构影响、安全风险、测试充分性分工并行。
- 归档阶段：Archive Agent、Technical Writer、Project Knowledge Updater 可并行整理不同产物，最后由 Orchestrator 汇总。

调度原则：只要边界明确就并行；边界不清楚就降低并行度、串行化或交给 Orchestrator 重新规划。

并行要求：

- Orchestrator 是唯一主调度者，负责判断哪些角色、哪些同角色 Agent 实例可以并行。
- 同一角色也可以并行，例如多个 Dev Agent、多个 QA Agent、多个 Reviewer Agent、多个 Project Analyzer Agent。
- 并行的前提不是角色类型，而是输入、输出、写入边界、依赖和 gate 明确。
- 并行 Agent 不直接共享同一个可写工作区；必须通过 worktree、任务边界、handoff 和 runtime gate 集成。
- 失败、冲突或证据不足时，Orchestrator 优先自主重规划、返工、降级并行度或触发 Conflict Resolver，而不是默认要求人工介入。

### 10.4 write_scope 校验

Runtime 必须检查：

- patch 是否越界。
- 是否修改高风险文件。
- 是否删除大量文件。
- 是否修改 lockfile。
- 是否修改 CI、生产配置、权限、安全策略。
- 是否修改 `.imfine` 中不允许 Agent 修改的状态文件。

越界不一定立即失败，但必须进入 Orchestrator 判定；高风险变更默认阻塞或需要明确记录。

当前实现：

- patch collect 会按 task `write_scope` 校验变更边界。
- patch risk scanner 会记录 lockfile 修改、CI / 生产配置修改、权限 / 安全策略修改、大量删除和 `.imfine` runtime-owned 状态文件修改。
- 高风险变更写入 `.imfine/runs/<run-id>/evidence/patch-risks.md`，并生成 Risk Reviewer 输入。
- 高风险记录不替模型做最终判断；是否继续、返工、重规划或阻塞由 Orchestrator / Risk Reviewer 判定。

## 11. Git、Commit 和 Push 策略

默认策略：

```text
base branch: 当前分支
run branch: imfine/<run-id>
task worktree branch: imfine/<run-id>-<task-id>
remote: origin
push target: origin imfine/<run-id>
```

说明：task worktree branch 不使用 `imfine/<run-id>/<task-id>`，因为 Git 不能同时存在 `imfine/<run-id>` 分支和该分支路径下的子分支。

流程：

```text
创建 imfine/<run-id>
  -> 为可并行任务创建 worktree / task branch
  -> Dev Agent 产出 patch
  -> Runtime 校验 patch
  -> 应用到 run branch
  -> 运行验证
  -> task commit
  -> 集成验证
  -> review
  -> push origin imfine/<run-id>
```

commit 原则：

- 边界明确时优先保留多个 task commit。
- 边界不明确或冲突密集时允许集成 commit。
- commit message 应 AI-friendly，包含 task-id、run-id、摘要、测试证据。

示例：

```text
feat(order): add payment status filter API

Run: 20260430-order-filter
Task: T1
Verification:
- npm run test -- order
```

push 失败处理：

- 无 remote：记录 `push_blocked_no_remote`。
- 无权限：记录 `push_blocked_permission`。
- 网络失败：可重试，超过限制后阻塞。
- 分支已存在且冲突：由 Orchestrator 判断 rebase、rename 或阻塞。

push blocked 不阻止归档。Archive Agent 可以在报告中明确记录 push 阻塞原因、当前本地 commit hash、目标分支和用户后续动作，然后完成带阻塞说明的归档。

当前实现：

- task commit 和 integration commit 均由 runtime 执行，并要求 patch validation、QA pass、Review approved。
- patch apply 冲突会生成 Conflict Resolver input / status / handoff / conflicts evidence，并把 run / task 推入 `needs_conflict_resolution`。
- Conflict Resolver `resolved` handoff 会自动触发 affected verification、Review gate 和 resolved integration commit，用户不需要手动执行 `commit resolved`。
- push 会记录 `push_blocked_no_remote`、`push_blocked_permission`、`push_blocked_branch_conflict`、`push_blocked_network`、`push_blocked_failed` 或 `pushed`。
- 网络失败会有限重试；分支冲突记录为 `push_blocked_branch_conflict`，后续由 Orchestrator 判断 rebase、rename 或阻塞。
- push evidence 和 Archive 报告会记录 push status、目标分支、本地 commit hash、阻塞原因和用户后续动作。

## 12. 新项目流程

新项目的 `/imfine run "..."` 应自动完成：

```text
产品分析
  -> 技术栈选择
  -> 架构设计
  -> 项目脚手架
  -> 测试策略
  -> 首批功能任务图
  -> 并行开发
  -> QA / Review
  -> commit / push
  -> archive
```

默认生成：

- README。
- 项目结构。
- 包管理器配置。
- 基础测试。
- lint / format / typecheck / build 命令。
- `.gitignore`。
- `.imfine/project` 长期知识库。

高风险或无法安全假设项：

- 数据库、云服务、部署平台、付费服务、生产凭据。
- 涉及真实外部系统的集成。
- 安全、权限、合规策略。

新项目默认技术栈、框架、目录结构和测试工具完全由 Agent 基于需求自主决策。高风险或无法安全假设项可以由 Agent 给出默认方案，但不得伪造凭据或假装基础设施存在。

新项目不自动创建 GitHub、GitLab 或其他远程仓库。imfine 可以自动执行本地 git 初始化、本地分支和本地 commit；如果缺少 remote，则 push 阶段进入 `push_blocked_no_remote`，并在归档中记录后续配置建议。

## 13. 已有项目流程

已有项目的 `/imfine init` 或首次 `/imfine run` 应先分析：

- 语言和框架。
- 模块边界。
- 包管理器。
- 入口文件。
- API、页面、服务、数据库迁移。
- 测试目录和测试命令。
- CI 配置。
- 代码风格和约定。
- 已有文档。

所有结论必须有文件证据。证据不足标记 unknown。

分析结果写入：

```text
.imfine/project/
```

后续每次归档都要更新长期知识库。

## 14. Runtime 和 Agent 边界

Runtime 负责确定性控制：

- 文件落盘。
- JSON/YAML/Markdown schema 校验。
- 状态迁移。
- 锁、队列、checkpoint 和 action ledger。
- worktree 创建和清理。
- patch 越界检查。
- patch risk evidence 记录。
- 命令执行和日志。
- 项目内依赖安装命令执行和证据记录。
- git commit / push。
- 证据文件存在性校验。
- retry 计数。

Agent 负责智能判断：

- 需求理解。
- 产品设计。
- 架构选择。
- 任务拆分。
- 是否可以并行。
- 测试充分性。
- review 质量判断。
- 冲突解决策略。
- 归档内容是否完整。

这个边界是 imfine 可信度的核心。

长时任务原则：

- imfine 的完整交付流程按长时任务设计。
- 运行过程中默认不要求用户持续介入。
- Orchestrator 应基于 run state、task status、agent handoff、evidence gate 自动恢复和继续推进。
- 除基础设施权限、凭据、生产风险、破坏性动作、需求根本歧义等无法安全假设的问题外，不应把普通 QA / Review 失败、冲突、测试失败直接抛给用户。
- `resume <run-id>` 应能从部分完成状态恢复下一步动作。

当前实现：

- Handoff gate 已覆盖 Dev、QA、Reviewer、Archive、Conflict Resolver。
- 非法 handoff 不会触发 patch collect、verify、review、archive 或 commit resolved；默认进入 `waiting_for_model`、`blocked` 或可恢复状态。
- auto loop 会结合 action ledger、checkpoint、状态和 evidence gate 恢复下一步，而不是只重跑最近 action。
- QA / Review 失败会持续生成有边界的 fix task，由 Orchestrator 自主推进，不因固定重试次数直接阻塞。

## 15. Gate 体系

### 15.1 Runtime Gate

- 必填文件存在。
- 必填字段存在。
- 状态迁移合法。
- task graph 合法。
- 并行任务 `write_scope` 不重叠。
- patch 不越界。
- 测试命令有记录。
- commit hash 有记录。
- push 结果有记录。
- 归档报告存在。

### 15.2 Agent Gate

- 需求是否被满足。
- 设计是否合理。
- 任务拆分是否充分。
- 测试是否覆盖关键风险。
- review 是否通过。
- 归档是否反映真实结果。

### 15.3 Infrastructure Gate

- git 可用。
- remote 可用。
- branch 可创建。
- push 权限可用。
- 包管理器可用。
- 依赖安装可执行。
- 测试命令可执行。

Infrastructure Gate 失败不一定阻止开发，但会影响 commit、push 或 archive 状态。

当前实现的 gate evidence：

- Infrastructure Gate：`.imfine/runs/<run-id>/orchestration/infrastructure-gate.json` 和 `.imfine/runs/<run-id>/evidence/infrastructure.md`。
- Dependency Install Gate：`.imfine/runs/<run-id>/evidence/dependency-install.md`。
- Handoff Gate：role-specific handoff validator 覆盖 Dev、QA、Reviewer、Archive、Conflict Resolver、Committer、Risk Reviewer、Technical Writer、Project Knowledge Updater。
- Patch Risk Gate：`.imfine/runs/<run-id>/evidence/patch-risks.md` 和 Risk Reviewer 输入。
- Commit / Push Gate：`.imfine/runs/<run-id>/evidence/commits.md`、`.imfine/runs/<run-id>/evidence/push.md`。

## 16. 失败和返工

QA 失败：

```text
qa_failed
  -> QA Agent 分类失败
  -> Orchestrator 生成 fix task
  -> Dev Agent 修复
  -> QA 复验
```

Review 失败：

```text
review_changes_requested
  -> Reviewer findings 转任务
  -> Dev Agent 修复
  -> QA 回归
  -> Review 复审
```

冲突失败：

```text
merge_conflict
  -> Conflict Resolver Agent
  -> 集成测试
  -> Review
```

设计不成立：

```text
implementation_blocked_by_design
  -> Architect Agent 更新设计
  -> Task Planner 重排任务
  -> Dev 继续
```

需求不清：

默认由 Agent 自行澄清和假设。只有业务风险高、多个合理解释会导致不可逆或高成本实现时，才阻塞用户。

## 17. 归档策略

Archive Agent 在以下条件满足后归档：

- requirement analysis 存在。
- design 存在。
- task graph 存在。
- 所有任务状态完成或有明确豁免。
- QA 通过。
- Review 通过。
- commit 已完成或有明确阻塞记录。
- push 已完成或有明确阻塞记录。
- 最终报告存在。

归档动作：

```text
.imfine/runs/<run-id>/archive/archive-report.md
.imfine/reports/<run-id>.md
.imfine/project/* 更新
.imfine/project/capabilities/* 更新
```

Archive Agent 需要确认：

- 本次交付实际做了什么。
- 与原需求是否一致。
- 有哪些测试证据。
- 有哪些 review 结论。
- 有哪些遗留风险。
- 项目长期知识需要怎么更新。

`/imfine run` 默认自动推进归档。若归档失败、中断、证据缺失或需要人工恢复，系统提示用户显式执行 `/imfine archive <run-id>` 继续归档。

当前实现：

- Archive 阶段会先执行 Technical Writer / Project Knowledge Updater 支撑 Agent，再执行 Archive Agent 确认。
- Archive 报告包含 requirement、design、task graph、QA、Review、commit、push、blocked/follow-up items 等证据链。
- push blocked 不阻止归档；报告会记录 push status、本地 commit hash、目标分支和用户后续动作。
- run 创建阶段生成 `.imfine/runs/<run-id>/spec-delta/proposal.md`、`design.md`、`tasks.md`。
- Archive 消费 run-local spec delta，并更新 `.imfine/project/capabilities/<run-id>/spec.md`。
- capability spec 区分 `Verified Facts` 和 `Inferences`，避免把推断当作已验证事实。

## 18. 分阶段实现路线

这里不称 MVP，而是按能力闭环分阶段建设。

### 阶段 1：安装形态和项目工作空间

状态：已完成

目标：

- 支持 `npx github:<owner>/<repo> install --target codex|claude|all --lang zh|en`。
- 支持 `npx github:<owner>/<repo> install`，默认同时安装 Codex 和 Claude 的 `/imfine` 入口。
- 生成 `/imfine` 两套入口产物。
- 安装 `~/.imfine/runtime`。
- 支持 `/imfine init`。
- 支持 `.imfine/project` 和 `.imfine/runs` 基础结构。
- 支持基础设施 doctor。

验收：

- Codex 中可通过 `/imfine init` 使用。
- Claude 中可通过 `/imfine init` 使用。
- 新项目和已有项目都能生成 `.imfine`。
- doctor 能指出 git、remote、测试命令、push 权限等状态。
- 阶段 1 不要求真实多 Agent 并行，只要求安装形态、runtime、项目工作空间和基础设施检查可用。

当前已落地：

- 安装入口只允许 `npx github:<owner>/<repo> install ...`，不支持用户直接 `imfine install ...`。
- 默认安装 `--target all --lang zh`，支持 Codex skill 和 Claude command 两套产物。
- `/imfine init` 支持空项目和已有项目；已有项目会生成 `.imfine/project/architecture/` 草稿和 Architect Agent 输入。
- `doctor` 已覆盖 git、remote、branch、push probe、包管理器、lockfile、测试脚本、Codex / Claude 入口和 provider bridge，并按 `entry_installed`、`session_orchestrator`、`subagent_supported` 记录 provider capability。

### 阶段 2：源码级 Agent / Skill 库

状态：已完成

目标：

- 调研并改造 BMAD agent。
- 调研并改造 Superpowers skill。
- 调研并改造 OpenSpec artifact 模板。
- 形成 imfine 自己的 agents、skills、templates。

验收：

- Orchestrator、Intake、Architect、Task Planner、Dev、QA、Reviewer、Archive 可被 `/imfine` 调用。
- 每个角色有输入、输出、禁止事项、handoff schema。
- 每个 skill 有触发条件、步骤、产物和失败处理。
- `imfine-runtime agents|skills|templates list|show` 可查看库产物。
- `imfine-runtime library sync` 可把源码级库同步到项目 `.imfine/`。
- 从阶段 2 开始建设多 Agent 编排能力和 OpenSpec / Superpowers / BMAD 的源码级吸收产物。

当前已落地：

- 核心 agent 已包括 Orchestrator、Intake、Project Analyzer、Product Planner、Architect、Task Planner、Dev、QA、Reviewer、Conflict Resolver、Committer、Archive、Technical Writer、Risk Reviewer、Project Knowledge Updater。
- skills 已包括 clarify、project-analysis、write-delivery-plan、execute-task-plan、tdd、systematic-debugging、parallel-agent-dispatch、code-review、archive-confirmation。
- templates 已包括 handoff schema、task graph schema、requirement-analysis、solution-design、task、archive-report。

### 阶段 3：项目分析和需求设计闭环

状态：已完成

目标：

- 支持 `/imfine run` 从一句话或文档创建 run。
- 自动判断新项目 / 已有项目。
- 生成需求分析、影响面、设计、验收标准。
- 新项目能生成产品和技术方案。
- 已有项目能生成证据化项目上下文。

验收：

- 所有项目结论有文件证据或 unknown 标记。
- run 产物完整。
- 不进入开发前能形成可审查设计。
- 阶段 3 的 `/imfine run` 只生成项目分析、需求分析和设计产物，不生成任务图、不开发、不测试、不 review、不 commit、不 push、不归档。

当前已落地：

- `/imfine run` 可从文本或需求文件创建 delivery run。
- 自动判断 `new_project` / `existing_project`。
- 生成 request、project context、requirement analysis、impact analysis、risk analysis、product analysis、solution design、architecture decisions、technical solution 和 acceptance。
- 结论带文件证据或 unknown 标记。

### 阶段 4：任务图和执行 plan

状态：已完成

目标：

- 生成 task graph。
- 每个任务包含 `read_scope`、`write_scope`、依赖、dev/test/review/commit plan。
- 判断可并行任务。
- 对不可拆分任务生成串行或冲突解决策略。

验收：

- Runtime 能校验 task graph。
- 并行任务边界不重叠。
- 任务粒度能映射到 commit。

当前已落地：

- runtime 生成并校验 task graph、ownership、execution plan、commit plan 和每个任务的 dev/test/review plan。
- task graph 校验包含必填字段、依赖存在性、循环、并行任务 `write_scope` 重叠检查。
- 边界不清或校验失败时 Orchestrator 进入 Task Planner replan，而不是继续执行不安全并行。

### 阶段 5：worktree 并行开发

状态：已完成

目标：

- 创建 `imfine/<run-id>` 分支。
- 为任务创建独立 worktree。
- Dev Agent 在独立 worktree 执行。
- 收集 patch。
- 校验 patch 越界。

验收：

- 多个非重叠任务可并行完成。
- 越界 patch 会被发现。
- 任务输出包含 patch、命令、测试证据。

当前已落地：

- runtime 创建 `imfine/<run-id>` run branch 和 `imfine/<run-id>-<task-id>` task worktree。
- Dev / Technical Writer Agent 在独立 worktree 中产出 patch。
- patch collect 会收集 binary diff、commands、task evidence，并校验 `write_scope`。
- patch risk scanner 会记录高风险变更并生成 Risk Reviewer 输入。

### 阶段 6：QA、Review、返工闭环

状态：已完成

目标：

- QA Agent 独立验证。
- Reviewer Agent 独立审查。
- 失败自动生成 fix task。
- 设计不成立自动回流 Architect / Task Planner。

验收：

- QA 失败可自动返工。
- Review changes_requested 可自动返工。
- 重复 QA / Review 失败时持续生成有边界的返工任务，由 Orchestrator 自主推进解决；不因固定重试次数直接阻塞。

当前已落地：

- QA Agent handoff 支持 `pass|fail|blocked`，Reviewer handoff 支持 `approved|changes_requested|blocked`。
- QA 失败和 Review changes_requested 会生成 scoped fix task，并推进 `needs_dev_fix`。
- 设计不成立可进入 Architect / Task Planner rework。
- role-specific handoff gate 防止非法 handoff 推进后续动作；已覆盖 Dev、QA、Reviewer、Archive、Conflict Resolver、Committer、Risk Reviewer、Technical Writer、Project Knowledge Updater。

### 阶段 7：commit 和 push

状态：已完成

目标：

- 支持任务级 commit。
- 支持集成 commit。
- 支持 push 到 `origin imfine/<run-id>`。
- 记录 commit / push 证据。

验收：

- 边界明确任务保留多个 task commit。
- 冲突场景可由 Conflict Resolver 合并后 commit。
- 无 remote / 无权限时清晰阻塞。

当前已落地：

- runtime 支持 task commit、integration commit 和 resolved integration commit。
- Committer Agent 负责 readiness / strategy handoff，runtime 负责实际 git commit / push。
- Orchestrator 会消费 Committer handoff；只有 `ready` 会推进 runtime commit，`blocked` 会阻止 commit 并保留证据。
- Conflict Resolver resolved 后自动 QA、Review、commit，并继续 push / archive。
- push 支持 no remote、permission、network、branch conflict、generic failure 分类和 evidence。

### 阶段 8：归档和长期知识更新

状态：已完成

目标：

- Archive Agent 确认产物。
- 生成 run archive。
- 生成用户报告。
- 更新 `.imfine/project`。

验收：

- 归档报告能还原完整交付链路。
- 项目知识库反映新的架构、能力、测试策略和风险。

当前已落地：

- Archive 前会调度 Technical Writer 和 Project Knowledge Updater 支撑整理。
- Archive 前会消费 Technical Writer / Project Knowledge Updater 的 run-level handoff，确认文档整理和项目知识更新是否 ready、not needed 或 blocked。
- Archive 确认 requirement、design、task、QA、Review、commit、push evidence。
- Archive 更新 `.imfine/project/**`、`.imfine/reports/<run-id>.md` 和 `.imfine/project/capabilities/<run-id>/spec.md`。
- push blocked 时仍可归档，并在报告中记录阻塞原因和用户后续动作。

### 阶段 9：新项目完整创建

状态：已完成

目标：

- 从一句话创建新项目。
- 自动初始化代码、测试、文档、git、`.imfine`。
- 完成首个 delivery run。

验收：

- 空目录中可完成项目初始化和首批功能交付。
- 能本地 commit。
- remote 缺失时 push 阶段明确阻塞。

当前已落地：

- 新项目 `/imfine run "需求"` 默认进入 Architect / Task Planner 模型规划路径。
- 当前大模型会话尚未执行 Architect / Task Planner 时，runtime 生成执行包并进入 `waiting_for_model`。
- 当前大模型会话执行并写回 Agent 产物后，可继续完成 stack decision、task graph、worktree、实现、QA、Review、commit、push blocked 记录和 archive。
- deterministic Node.js vertical slice 仅作为内部 debug/test 路径保留。

## 19. 已确认实现决策

1. imfine runtime 使用 TypeScript/npm 实现和分发。
2. npm 包主入口为 `imfine`，内部确定性 runtime bin 可命名为 `imfine-runtime`。
3. 安装入口只支持 `npx github:<owner>/<repo> install ...`，不支持直接 `imfine install ...`。
4. 安装时支持 `--target codex|claude|all` 和 `--lang zh|en`，默认 `--target all --lang zh`。
5. Codex 的 `/imfine` 按 skill 入口设计。
6. Claude 的 `/imfine` 第一阶段只生成 `~/.claude/commands/imfine.md`。
7. 新项目默认技术栈完全由 Agent 决策。
8. 自动安装依赖默认允许，但只限项目内包管理器命令，且必须记录命令、输出和失败原因。
9. push 使用 `doctor` 前置检查：检查通过后默认自动 push；检查失败或 push 失败则阻塞并记录原因。
10. push blocked 不阻止归档，Archive Agent 需要在报告中记录阻塞原因和后续动作。
11. 新项目不自动创建远程仓库，只做本地 git 初始化、分支和 commit。
12. `.imfine` 默认可提交进业务仓库；项目知识库和报告建议提交，runs 中的大量 agent 中间日志可配置忽略。
13. 分阶段实现：阶段 1 不强求真实多 Agent；阶段 2 开始建设 Agent / Skill 库；后续逐步实现真实多角色编排。
14. 多 Agent 并行覆盖 Intake、Project Analysis、Architect、Task Planner、Dev、QA、Review、Archive、Technical Writer 等角色，不只限 Dev Agent。
15. `/imfine init` 是新项目和已有项目的统一初始化入口；已有项目必须生成架构文档草稿，并由 Architect Agent 基于证据补全。
16. imfine 是应用级、项目级 harness；完整流程是长时任务，默认由 Orchestrator 自主调度、恢复、返工和解决问题，尽量减少人工介入。
17. 多 Agent 并行包括同一角色的多个 Agent 实例并行；是否并行由边界和依赖决定，不由角色名称决定。

## 20. 参考来源

- OpenSpec：提供 AI coding assistant slash command、change artifacts、capability specs、archive 思路。公开文档显示其支持 Codex 和 Claude Code，并使用 proposal/design/tasks/spec delta 组织变更。
- Superpowers：提供 brainstorming、TDD、systematic debugging、subagent development with code review、execute-plan/write-plan 等工程纪律。
- BMAD Method：提供多角色 Agent、Analysis / Planning / Solutioning / Implementation 阶段、Project Context、Quick Flow、Developer / Architect / PM / Technical Writer 等角色和 workflow。
- 本地 `harness-test`：提供 `/auok` 的 Codex/Claude 双目标安装形态、`~/.auok/runtime`、slash command 入口、runtime 与 Agent 判断分离的实现参考。
