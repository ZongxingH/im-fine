# imfine-demo true harness 问题与解决方案

本文整理 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo` 验证 demo 中暴露的 true harness 契约问题，并按“问题 / 影响 / 解决方案”记录。

## 整改状态

**已完成。**

本轮已在 runtime 中实现可执行门禁，而不是仅收紧提示词：

- 新增 `src/core/role-purity.ts`，统一审计 Orchestrator 角色纯度、角色产物归属、provider-origin receipt、handoff、返工 dispatch、deviation、Agent close 安全性。
- `true-harness-evidence.json` 新增 `role_purity` 分项；`true_harness_passed=true` 必须同时满足 role purity pass。
- `final-gates.json` 新增 required gate：`role_purity`。
- run 创建阶段写入 `role-purity-policy.json`，并在 `orchestrator-input.md` 中明确 Orchestrator-only 写入边界。
- dispatch contract 增加 `close_preconditions` 和 `role_purity_policy`。
- 新增 `test/role-purity.mjs`，覆盖 demo 中“Orchestrator 直接改 backend/tests、Reviewer blocker 没有 rework dispatch、范围降级未被接受”的失败路径。
- `test/harness-acceptance.mjs` 补齐 agent-authored acceptance matrix，证明完整证据闭环的 happy path 仍可 completed。

## 1. Orchestrator 越权生成规划产物

**问题**

demo 输出中出现：

```text
我本地补齐编排 session、contracts 和任务图的初版
现在先落盘 Orchestrator session 和任务图
```

`orchestrator-session.json` 属于 Orchestrator 职责，但 `task-graph.json`、`ownership.json`、`execution-plan.md`、`commit-plan.md` 等规划产物更应由 Task Planner 子 Agent 首次产出。当前会话先写初版，再派 Task Planner 审阅修正，角色边界不够干净。

**影响**

- Task Planner 产物来源不清晰。
- 容易被误判为 Orchestrator 代写子 Agent 产物。
- true harness 审计时难以证明规划决策来自独立 Agent。

**解决方案**

- Orchestrator 只写 `orchestration/orchestrator-session.json` 和 dispatch intent。
- Task Planner 子 Agent 负责首产 `planning/**` 中的任务图、归属、执行计划、提交计划。
- 如需 Orchestrator 提供草案，应写入 `orchestration/**` 下的调度说明，不直接写入 Task Planner 产物路径。

**实现状态：已完成**

- `src/core/role-purity.ts` 将 `planning/task-graph.json`、`planning/ownership.json`、`planning/execution-plan.md`、`planning/commit-plan.md` 归属给 `task-planner`。
- 若 authorship 证据显示 Orchestrator 写入这些路径，`role-purity-audit.json.status=blocked`。

## 2. Orchestrator 直接执行 Dev 修复

**问题**

Reviewer 发现阻塞项后，demo 输出中出现：

```text
我准备做三处最小改动
我会编辑 5 个文件
已编辑 6 个文件
补丁已经落地
```

这些动作直接修改了 `backend/**`、`frontend/**`、`tests/**`，属于 Backend Dev、Frontend Dev、QA 等子 Agent 的职责，不应由 Orchestrator 当前会话直接完成。

**影响**

- 多 Agent 工作流退化为单 Agent 编码。
- 修复产物没有对应 Dev Agent 的 provider-origin 证据。
- Reviewer findings 到修复之间缺少可审计的返工链路。

**解决方案**

- Reviewer findings 必须转成 remediation dispatch。
- 派发 Backend Fix Agent 处理后端和后端测试。
- 派发 Frontend Fix Agent 处理前端修复。
- 修复后派发 QA Recheck Agent 和 Reviewer Recheck Agent。
- Orchestrator 只负责创建 dispatch、收集 handoff、决定继续或 blocked。

**实现状态：已完成**

- `src/core/role-purity.ts` 将 `backend/**`、`frontend/**`、`src/**`、`tests/**`、`test/**` 归属给 Dev/Merge/QA 等对应角色。
- `test/role-purity.mjs` 验证 Orchestrator 直接写 `backend/app.py`、`tests/test_api.py` 会阻断 `role_purity` 和 `true_harness`。

## 3. Orchestrator 直接跑测试并形成判断

**问题**

demo 输出中多次出现：

```text
本地复跑后端测试
前端语法检查
测试暴露了一个边界
```

Orchestrator 可以做有限的 sanity check，但不能把自己的测试结果作为 QA gate 或最终验收结论。测试证据、验收矩阵、复测结论应由 QA Agent 产出。

**影响**

- QA 角色被当前会话部分替代。
- 测试通过结论缺少独立 Agent handoff。
- final gate 可能建立在 Orchestrator 自测而非 QA evidence 上。

**解决方案**

- QA Agent 负责运行测试、记录命令、输出测试证据和 acceptance matrix。
- Orchestrator 的本地 sanity check 只能作为辅助观察，不得替代 QA gate。
- final gates 必须引用 QA Agent 的 handoff 和 evidence。

**实现状态：已完成**

- `src/core/role-purity.ts` 将 `evidence/test-results.md` 归属给 `qa`。
- `src/core/archive.ts` 和 `src/core/reconcile.ts` 的 final gate 读取 role purity 结果；Orchestrator 自测不能让 `role_purity` 通过。

## 4. 返工阶段缺少子 Agent dispatch

**问题**

Reviewer 找到阻塞项后，demo 中直接进入当前会话修复：

```text
Reviewer 找到了 3 个阻塞项，我会先修它们
```

缺少明确的 rework dispatch 链路。

**影响**

- Review -> 修复 -> 复测 -> 复审的闭环不可审计。
- 难以区分哪些问题由哪个角色修复。
- 后续 true-harness-evidence 难以判断返工是否真实由子 Agent 完成。

**解决方案**

返工阶段固定走以下流程：

```text
Reviewer findings
-> Orchestrator 创建 remediation plan
-> Backend/Frontend Fix Agent 执行修复
-> QA Recheck Agent 复测
-> Reviewer Recheck Agent 复审
-> Orchestrator 决定 final gates 或继续返工
```

**实现状态：已完成**

- `src/core/role-purity.ts` 检测 QA/Reviewer blocker 后是否存在 fix/rework/remediation/recheck dispatch，并要求 `quality-lineage.summary.recheck_fix_loop=pass`。
- 缺失返工 dispatch 时生成 `rework-dispatch.*` P0 violation。

## 5. provider-origin receipt 闭环不清晰

**问题**

demo 日志中可以看到“已生成智能体”“Agent 已完成”，但没有清晰展示每个 required Agent 都通过 runtime 记录 provider-origin completed receipt。

true harness 要求每个原生子 Agent 完成后记录：

```bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agent complete <run-id> <action-id> \
  --provider <codex|claude> \
  --provider-agent-id <provider-agent-id> \
  --provider-session-id <provider-session-id> \
  --provider-task-handle <provider-task-handle> \
  --provider-trace-id <provider-trace-id-if-available> \
  --output-path <handoff-or-output-path>
```

**影响**

- “创建过子 Agent”无法等价于“true harness 证据闭合”。
- runtime 无法校验 required dispatch contract 是否都有真实 provider receipt。
- final report 可能误报 true harness passed。

**解决方案**

- 每个 required Agent 完成后必须调用 `agent complete`。
- receipt 必须来自真实 provider run，不允许占位 id。
- final gates 前校验 `agent-runs.json`、`parallel-execution.json`、`true-harness-evidence.json` 是否闭合。

**实现状态：已完成**

- `src/core/role-purity.ts` 对每个 agent dispatch contract 要求 valid provider-origin receipt。
- `src/core/true-harness-evidence.ts` 将 `provider_receipts_closed` 纳入 `role_purity` 分项和 true harness 必过条件。

## 6. 子 Agent 数量上限处理存在审计风险

**问题**

demo 中 Technical Writer 派发失败后，关闭了已经完成的 Architect、Task Planner、Backend、Frontend 线程释放名额。

**影响**

- 如果关闭前没有记录 handoff 和 receipt，可能丢失 provider session 证据。
- 后续审计可能无法追踪已关闭 Agent 的产物来源。

**解决方案**

- 关闭任何子 Agent 前，先确认 handoff 已写入、receipt 已记录、输出文件已落盘。
- 在 `agent-runs.json` 或同等运行记录中标明 Agent 已 completed。
- 只有 completed 且 receipt closed 的 Agent 才允许释放线程。

**实现状态：已完成**

- `src/core/role-purity.ts` 支持读取 `orchestration/agent-close-ledger.json`。
- 若记录了关闭 Agent 但缺少 handoff 或 provider receipt，会生成 `agent-close.*` P0 violation。
- dispatch contract 新增 `close_preconditions`。

## 7. 用户需求存在未正式记录的范围降级

**问题**

原需求包含“用户端小程序页面和管理后台页面”，demo 中采用“静态页面表达小程序端与后台端核心流程”。

这是 demo 中可理解的简化，但属于范围降级，不能只在对话中说明。

**影响**

- 验收时可能误以为已完成真实小程序工程。
- 用户需求覆盖矩阵不准确。
- acceptance gate 无法区分完整实现和 demo 等价实现。

**解决方案**

- 在 acceptance deviation 中明确记录：

```text
小程序页面 -> 静态用户端页面等价演示
```

- 标明降级原因、影响范围、后续补齐路径。
- final report 中不得把该项报告为完整小程序实现。

**实现状态：已完成**

- `src/core/role-purity.ts` 同时读取 runtime-derived 和 agent-authored acceptance matrix。
- required scope 的 `demo-substitute` / `deviation` 未被 QA/Reviewer 正式接受时，生成 `deviation.*` P0 violation。
- `test/role-purity.mjs` 覆盖未接受范围降级会 blocked。

## 8. runtime 与 Orchestrator 的产物职责边界混杂

**问题**

demo 中出现 Orchestrator 手工创建 `.imfine/runs/**/planning`、`evidence`、`agents/**` 等目录和初始产物的行为。

runtime 应负责确定性目录、schema、contract 的物化；Orchestrator 应负责读取上下文、写 session、调度 Agent、协调 handoff。

**影响**

- 确定性 runtime 和模型决策边界变模糊。
- 手工创建的 contract 容易被误认为 runtime 校验产物。
- 后续 schema 演进时容易出现不一致结构。

**解决方案**

- runtime 负责创建 run 目录、基础 schema、dispatch contract 模板和状态文件。
- Orchestrator 只填充自己职责范围内的 session 和 dispatch 决策。
- 如果 runtime 未物化必要结构，应修 runtime，而不是让 Orchestrator 手工补全 runtime 结构。

**实现状态：已完成**

- `src/core/run.ts` 在 run 创建阶段物化 `orchestration/role-purity-policy.json`。
- `src/core/dispatch.ts` 在 contract 中物化角色关闭前置条件和 role purity policy。

## 9. 当前会话缺少 Orchestrator-only 写入限制

**问题**

当前会话仍可直接编辑源码、测试、README、planning、QA/Review 证据等文件。仅靠 prompt 约束时，遇到 bug fix 容易退回普通 coding agent 模式。

**影响**

- Orchestrator 角色边界无法稳定维持。
- true harness 执行会在返工阶段退化。
- 审计结果依赖模型自觉，而不是机制约束。

**解决方案**

增加 Orchestrator 写入白名单：

```text
.imfine/runs/<run-id>/orchestration/**
.imfine/runs/<run-id>/agents/orchestrator/**
必要的 runtime dispatch/status 文件
```

默认禁止 Orchestrator 直接写：

```text
backend/**
frontend/**
tests/**
README.md
planning/**
agents/<non-orchestrator>/**
reports/**
acceptance-matrix.json
final-gates.json
```

如确需 emergency override，必须记录 deviation，并且不能标记为 pure true harness pass。

**实现状态：已完成**

- `src/core/run.ts` 的 `orchestrator-input.md` 明确 Orchestrator-only 写入边界。
- `src/core/role-purity.ts` 通过 authorship 证据和 trace 证据执行硬门禁。
- `true_harness_passed` 依赖 `role-purity-audit.json.status=pass`。

## 10. demo 容易误导为“有子 Agent 就等于 true harness”

**问题**

demo 中确实创建了多个子 Agent，但关键返工阶段由当前会话直接完成。创建子 Agent 本身不能证明 true harness 成立。

**影响**

- 用户可能误以为 spawned agents 等价于 true harness。
- final report 可能忽略 role purity、receipt closure、handoff completeness。
- 验证标准不够严格。

**解决方案**

final report 和 evidence 中拆分展示：

```text
spawned_agents: true/false
provider_receipts_closed: true/false
required_handoffs_present: true/false
orchestrator_role_purity: pass/fail
qa_reviewer_archive_gates_closed: true/false
true_harness_passed: true/false
```

只有所有 required 条件均通过，才能标记 `true_harness_passed=true`。

**实现状态：已完成**

- `src/core/true-harness-evidence.ts` 输出 `role_purity` 分项：
  - `spawned_agents`
  - `provider_receipts_closed`
  - `required_handoffs_present`
  - `orchestrator_role_purity`
  - `qa_reviewer_archive_gates_closed`
  - `deviations_closed`
  - `rework_dispatch_closed`
  - `agent_close_safe`
- `true_harness_passed=true` 必须满足上述审计通过。

## 11. final gates 与 Archive/Committer 前置条件需要更硬

**问题**

demo 中提到了 final gates、archive、committer，但在返工阶段出现 Orchestrator 直接修复后，后续 gate 如果继续推进，必须重新确认 QA/Reviewer/Committer/Archive 的完整闭环。

**影响**

- 修复后的代码可能没有经过独立 QA 和 Reviewer recheck。
- final gates 可能基于过期证据。
- archive 可能记录了不完整或不纯净的 harness 执行。

**解决方案**

- 任意源码或测试变更后，自动失效旧 QA/Review gate。
- 必须重新派发 QA Recheck 和 Reviewer Recheck。
- Committer 和 Archive 只能在 fresh final gates 全部 pass 后执行。
- final gates 应检查 evidence freshness，不能只检查文件是否存在。

**实现状态：已完成**

- `src/core/final-gates.ts` 将 `role_purity` 加入 required final gates。
- `src/core/archive.ts` 和 `src/core/reconcile.ts` 在 final gates 中生成 `role_purity` gate。
- `src/core/true-harness-evidence.ts` 继续执行 evidence freshness 校验，且生成顺序已调整为先刷新 role purity，再生成 true harness evidence。

## 总体整改方向

imfine-demo 的主要问题不是没有子 Agent，而是 Orchestrator 没有被机制性限制在编排角色内。整改重点应放在三件事：

1. Orchestrator 写入白名单和角色产物写入隔离。
2. Reviewer/QA findings 后强制 rework dispatch，不允许当前会话直接修复。
3. provider-origin receipt、handoff、final gates、archive evidence 的闭环校验。

只有同时满足“子 Agent 真实执行”“角色产物来源清晰”“runtime evidence 闭合”“Orchestrator role purity 通过”，demo 才能被判定为严格 true harness。

**最终状态：已完成。**
