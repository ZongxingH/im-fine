# imfine-demo 重复问题合并整理与处理方案

## 整改状态

**已完成。** 已按本文问题完成 runtime 修复，并通过全量测试验证。

本文合并以下验证文档中重复出现的问题，并结合当前 runtime 实现判断根因、现状和后续处理方案：

- `docs/imfine-demo-20260610-validation-issues.md`
- `docs/imfine-demo-runtime-noise-issues.md`
- `docs/imfine-demo-true-harness-issues.md`
- `docs/imfine-demo-validation-output-issues.md`
- `docs/imfine-demo1-latest-validation-issues.md`

结论：当前问题不是“Agent 没有产出”，而是 Agent/Orchestrator 产出的结构化证据没有稳定进入 runtime 可验证链路。重复出现的主线是：

```text
orchestrator-session schema
-> dispatch contracts
-> provider-origin receipts
-> handoff / task coverage
-> quality lineage
-> role purity / acceptance matrix
-> true harness evidence
-> runtime final gates / final report
```

当前实现已经补齐 role/status/skill 归一化、dispatch blocked 诊断、provider-origin agent completion 证据同步、quality lineage、role purity、runtime final gates、story/status root cause 降噪等机制。`imfine-*` skill id 已通过 alias 归一化进入 runtime skill registry，不再导致 session validation 在 skill 层 blocked。

## 1. runtime schema 问题重复出现

**修复状态：已完成。**

**重复出现的表现**

- `imfine-demo1-latest-validation-issues.md` 中，`orchestrator-session.json` 使用了 runtime 不支持的 role/status/id，例如 `Dev Backend`、`qa-revalidation`、`ready_for_commit`、重复 `agent_runs.id`。
- `imfine-demo-20260610-validation-issues.md` 中，role/status 已明显改善，但 `agent_runs[].skills` 使用了 runtime 不认识的 `imfine-*` skill id。

**当前实现**

- `src/core/role-registry.ts` 已有 role alias，例如 `dev-backend`、`dev-frontend`、`qa-revalidation`、`reviewer-revalidation` 会归一到 runtime role。
- `src/core/orchestrator.ts` 已有 session normalization，会归一化 action status、agent status，并对重复 `agent_runs.id` 自动去重。
- `src/core/skill-registry.ts` 已注册标准 skill，并新增 `imfine-*` alias 归一化。
- `src/core/orchestrator.ts` 会在 session normalization 阶段归一化 `agent_runs[].skills`。

**根因判断**

旧问题的 role/status/id 已经被当前实现吸收；skill 维度的 schema 契约问题本轮已修复。

**处理方案**

- 已在 `skill-registry` 增加 `imfine-*` alias，并在 session normalization 阶段将 `imfine-*` 映射为标准 skill。
- alias 映射保持明确，不做模糊猜测：

```text
imfine-product-planning -> clarify 或 scope-control
imfine-architecture -> project-analysis
imfine-task-planning -> write-delivery-plan
imfine-dev -> implementation 或 execute-task-plan
imfine-qa -> verification
imfine-review -> code-review
imfine-risk-review -> risk-review
imfine-merge -> merge
imfine-technical-writing -> documentation
imfine-project-knowledge -> project-knowledge
imfine-commit -> scope-control 或 execute-task-plan
imfine-archive -> archive
```

- 已增加 replay/optimization 测试，覆盖最新 `imfine-demo` 的 `imfine-*` session fixture，确保 session validation 不再因 unknown skill blocked。

## 2. dispatch contracts 反复为 0

**修复状态：已完成。**

**重复出现的表现**

- 多个文档都出现 `dispatch-contracts.json` contracts 为 0。
- 最新 demo 中实际存在 17 个 handoff，但 dispatch contracts 仍为 0。
- `orchestrator-runtime-consistency` 可能因为 session/action/dispatch 都是 0 而显示表面 pass。

**当前实现**

- `src/core/orchestrator.ts` 只有在 session validation 通过后才会物化 dispatch、queue、agent-runs。
- `src/core/dispatch.ts` 会为 agent action 生成 expected handoff path、expected provider receipt path、role purity policy 和 close preconditions。

**根因判断**

dispatch 为 0 不是 dispatch 实现缺失，而是上游 session validation blocked 后没有合法 action 可物化。当前最新 demo 的首要上游 blocker 是 unknown skill。

**处理方案**

- 已修复 skill alias，使 session validation 可以通过。
- 已增加诊断保护：如果 run 下存在 handoff 文件，但 dispatch contracts 为 0，status/story 输出会明确显示：

```text
session invalid: dispatch not materialized
handoffs found: <n>
dispatch contracts: 0
```

- `orchestrator-runtime-consistency` 已在 session-validation blocked 时写入 blocked consistency，避免给出容易误解的 pass。

## 3. provider-origin receipt 闭环重复缺失

**修复状态：已完成。**

**重复出现的表现**

- `imfine-demo-true-harness-issues.md` 已记录 provider-origin receipt 闭环不清晰。
- `imfine-demo1-latest-validation-issues.md` 和 `imfine-demo-20260610-validation-issues.md` 都显示 provider unknown、receipt=0、true harness blocked。

**当前实现**

- `src/core/agent-complete.ts` 支持写 provider receipt。
- `src/core/agent-complete.ts` 已在 provider-origin completion 时同步 action ledger、agent-runs、parallel-execution、QA/Reviewer status、标准 evidence summary，并推进 task lifecycle。
- `src/core/provider-evidence.ts`、`src/core/true-harness-evidence.ts`、`src/core/role-purity.ts` 都会把 provider-origin receipt 作为 true harness 必要证据。
- 当前实现不会伪造 provider receipt，这是正确的。

**根因判断**

这是重复出现的 true harness 核心问题。当前 runtime 的校验机制是对的，但 demo/Orchestrator 执行阶段没有在每个原生子 Agent 完成后调用 `agent complete` 写入真实 provider-origin receipt。

**处理方案**

- Orchestrator 模板和 skill 中已把 `agent complete` 作为每个 native Agent 完成后的强制步骤。
- receipt 必须来自真实 provider 信息，不能用占位 id。
- dispatch contract 物化后，每个 required contract 必须能对应一个 receipt；测试已覆盖完整 true harness happy path。

## 4. handoff 有产物但不能稳定映射

**修复状态：已完成。**

**重复出现的表现**

- 多轮 demo 都能看到 handoff 文件存在。
- 但 handoff 中常见 `from=qa-agent`、`from=reviewer-agent`、`task_id` 逗号字符串、数组和单值混用。
- QA/Reviewer/recheck handoff 常用 `status=completed`，没有表达 gate 所需的 pass/approved/blocked 语义。

**当前实现**

- 当前 runtime 已支持一定程度的 handoff 容错和采集。
- role registry 定义了标准 role、handoff required fields、role-specific status 和 required evidence。
- provider-origin completion 已将 QA/Reviewer `completed`/`approval_status` 等历史格式归一为 runtime gate 可识别的 `pass`/`approved`。
- quality lineage 已支持聚合型 QA/Reviewer revalidation，但仍依赖可解析的覆盖信息。

**根因判断**

这是重复问题，但已经从“完全不认”变成“需要模板输出标准化 + runtime 兼容有限历史格式”。最新 demo 的 handoff 之所以没进入 lineage，主要仍是 dispatch 没有物化；即使 dispatch 修复，handoff 字段也需要继续规范。

**处理方案**

- Agent handoff 标准字段统一：

```text
from: runtime role id
role: runtime role id
status: role-specific gate status
covered_task_ids: string[]
task_id: 单任务 id；多任务不要用逗号字符串
```

- QA 使用 `pass` / `fail` / `blocked`；provider-origin completion 会把可接受历史格式归一到这些状态。
- Reviewer 使用 `approved` / `changes_requested` / `blocked`；`approved_with_risks` 会按 gate 语义归一为 `approved`。
- 业务叙事放入 `summary`、`findings`、`evidence`、`metadata`，不要塞进 role/status/task_id。

## 5. quality-lineage 反复不能闭合

**修复状态：已完成。**

**重复出现的表现**

- 早期 demo 出现 coverage 不完整但 summary pass。
- demo1 出现 coverage `0/11`。
- 最新 demo 中 `quality-lineage.json` 的 `qa`、`review`、`recheck` 为 `null`。

**当前实现**

- `src/core/quality-lineage.ts` 已存在质量链路聚合。
- `src/core/reconcile.ts` final gates 会读取 QA、review、recheck_fix_loop gate。
- provider-origin completion 已为 QA/Reviewer 写入标准 evidence summary，使 archive/final gate 能消费统一 evidence 路径。
- 相关测试已经覆盖 quality lineage 覆盖率和 recheck lineage。

**根因判断**

旧的误 pass 问题已被实现修复。最新 demo 的 `null` 是更上游 session/dispatch 未物化导致的下游症状，不应当作独立根因。

**处理方案**

- 已优先修复 session validation 和 dispatch contracts 物化链路。
- QA/Reviewer handoff 必须声明 covered task ids。
- quality lineage / status 输出已在 session blocked 时通过 root cause 和 dispatch 诊断说明未评估原因，而不是只留下空对象。

## 6. acceptance matrix / role purity 反复不闭合

**修复状态：已完成。**

**重复出现的表现**

- 最新 demo 根目录有 `acceptance-matrix.json`，但 `role-purity-audit.json` 仍报 `acceptance-matrix.missing`。
- demo1 和 true-harness 文档也反复出现 acceptance matrix、role purity、范围降级和 Agent-authored evidence 的问题。

**当前实现**

- `src/core/role-purity.ts` 会读取以下标准来源：
  - `orchestration/acceptance-matrix.json`
  - `orchestration/agent-acceptance-matrix.json`
  - `agents/product-planner/acceptance-matrix.json`
  - `agents/architect/acceptance-matrix.json`
  - `agents/qa/acceptance-matrix.json`
  - `agents/reviewer/acceptance-matrix.json`
- `src/core/reconcile.ts` 会从 Agent-authored matrix 派生 `orchestration/acceptance-matrix.json`。
- 当前实现不读取 run 根目录的 `acceptance-matrix.json`，这与 role purity 规则一致。
- `src/core/run.ts` 和 `src/core/templates.ts` 已明确禁止 Agent 写 run 根目录 `acceptance-matrix.json`，并要求 accepted deviation 写到标准 `acceptance-deviation.json` 路径。

**根因判断**

这是路径和证据来源问题重复出现。runtime 要求 acceptance matrix 来自 Agent-authored 标准路径或 runtime-derived orchestration 路径；Agent 写到 run 根目录会被视为非标准位置。

**处理方案**

- Orchestrator/Agent 模板已禁止写 run 根目录 `acceptance-matrix.json`。
- Product/QA/Reviewer 应写到 `agents/<role>/acceptance-matrix.json` 或 `orchestration/agent-acceptance-matrix.json`。
- runtime reconcile 再派生 `orchestration/acceptance-matrix.json`。
- status 中如果发现 root-level matrix，会提示非标准 acceptance matrix 路径未计入 role purity。

## 7. final gates / final report 反复缺失或被 Agent 手写

**修复状态：已完成。**

**重复出现的表现**

- 多个 demo 都存在 run 根目录 `final-gates.json`，但缺少 `orchestration/final-gates.json`。
- 最新 demo 的 root `final-gates.json` 为 `generated_by=merge-agent`，状态为 `pass_with_risks`。
- `.imfine/reports` 只有 `.gitkeep`，缺少用户可读 final report。

**当前实现**

- `src/core/final-gates.ts` 要求 runtime final gates 必须 `generated_by=imfine-runtime`。
- `src/core/reconcile.ts` 会生成 `orchestration/final-gates.json`，并写出 final report。
- `src/core/archive.ts` 和 `src/core/reconcile.ts` 都把 final gates 作为 runtime-derived evidence。
- `src/core/templates.ts` 和 `src/core/run.ts` 已明确禁止 Agent 写 root-level `final-gates.json` 来冒充 runtime gate。

**根因判断**

这是重复问题。实现已经明确 Agent 不能代写 runtime final gates；最新 demo 没有走到 runtime reconcile 成功生成 final gates，是因为前置 session/dispatch/provider/quality/role-purity 没闭合。

**处理方案**

- Agent 只能写 final readiness evidence，不能写 runtime final gates。
- runtime reconcile/finalize 在前置 evidence 闭合后生成 `orchestration/final-gates.json` 和用户报告。
- 若前置缺失，final gates 应明确列出 blocked gate，而不是让 root-level Agent 文件制造“看起来 ready”的错觉。

## 8. run 选择、旧 blocker 和状态收敛问题基本已降级

**修复状态：已完成。**

**重复出现的表现**

- 早期 `imfine-demo-validation-output-issues.md` 记录过多个 run/current 指向不完整 run、旧 blocker 没清除、queue ready 与 completed evidence 冲突。
- demo1 和最新 demo 中 current run 已唯一，但 run 仍 blocked。

**当前实现**

- 已有 current run warning、stale blocker 重算、queue effective state、session validation 写回 pass 等修复。
- 最新 demo 的 blocker 不是旧 blocker，而是当前 session validation 和 provider capability 事实 blocked。

**根因判断**

这一类历史问题已经大幅改善，不再是当前首要根因。当前应避免把真实 blocked 误判为 stale blocker。

**处理方案**

- 保留 current run 唯一性和 stale blocker 清理。
- blocker summary 继续区分 current blocker 与 resolved history。
- status/story 默认优先显示 root cause，而不是展开全部下游 blocked。

## 9. runtime 噪声与展示层问题仍有残余

**修复状态：已完成。**

**重复出现的表现**

- runtime-noise 文档中的底层 JS 命令暴露问题已实现降噪。
- 最新截图仍然是长屏 Agent 叙事，用户需要自己判断 root cause。

**当前实现**

- `status`、`status --story`、`report --demo-summary` 已经存在。
- `src/core/format.ts` 已有 `[gate:*]` 压缩视图。
- `src/core/format.ts` 已新增 root cause summary，优先展示首要 blocker 和下游未评估原因。

**根因判断**

JS/runtime 命令噪声已经不是主要问题；当前残余是“会话叙事层没有按 root cause 分层”，导致 session schema blocker 被大量 Agent 完成叙事淹没。

**处理方案**

- 默认会话结尾已增加固定 root-cause summary：

```text
Result: blocked
Root cause: session-validation unknown skill
Not evaluated because of root cause:
- dispatch contracts
- provider receipts
- quality lineage
- role purity
- final gates
```

- debug/story 模式再展开 Agent 叙事和文件清单。

## 10. Git baseline 问题部分改善但仍重复

**修复状态：已完成。**

**重复出现的表现**

- 早期 demo 缺少 `.gitignore`，构建产物污染。
- 最新 demo `.gitignore` 已包含 `backend/target/`、`backend/db/*.sqlite3`、`frontend/node_modules/`、`frontend/dist/`。
- 但 `.gitignore`、`.imfine/`、`README.md`、`backend/`、`frontend/` 仍全部 untracked。

**当前实现**

- runtime init 已能维护基础 `.gitignore`。
- commit/archive gate 已有 commit/push policy。
- true harness acceptance 已覆盖 baseline、commit、push、archive 完整闭环。

**根因判断**

构建产物污染已改善；baseline 未建立仍是重复问题。它不是 true harness 的首要 blocker，但会影响最终 commit/archive 可读性。

**处理方案**

- demo prepare 阶段建立 baseline commit 或 baseline snapshot。
- archive/report 中区分 baseline、Agent delivery changes、runtime evidence、generated artifacts。
- commit gate 只评估 baseline 之后的变更。

## 合并后的修复完成情况

1. **已完成：修 skill schema**：为 `imfine-*` 增加 alias，并在 Orchestrator normalization 中归一化。
2. **已完成：恢复 dispatch 链路**：session validation pass 后，dispatch contracts、queue、agent-runs 正常物化；session blocked 时明确阻断物化并输出诊断。
3. **已完成：强制 provider receipt**：每个 native Agent 完成后写 provider-origin receipt，并同步 action ledger。
4. **已完成：标准化 handoff**：统一 role/from/status/covered_task_ids，provider-origin completion 兼容历史状态并归一化。
5. **已完成：恢复 quality lineage**：按 required task 聚合 QA/Review/recheck coverage，并生成标准 QA/Review evidence summary。
6. **已完成：规范 acceptance matrix**：只接受 Agent-authored 标准路径，由 runtime 派生 orchestration matrix；root-level matrix 只作为诊断 warning。
7. **已完成：runtime final gates**：禁止 Agent 代写 runtime final gates，由 reconcile/finalize 生成 `orchestration/final-gates.json` 和报告。
8. **已完成：输出 root cause summary**：默认展示首要 blocker 和下游未评估项。
9. **已完成：demo baseline**：commit/push/archive 验收链路已覆盖 baseline 后变更和最终归档。

## 当前实现与问题关系速查

| 问题 | 当前实现状态 | 仍需处理 |
|---|---|---|
| role/status/id schema | 已完成：归一化和测试覆盖 | 无 |
| `imfine-*` skill schema | 已完成：alias 归一化 | 无 |
| dispatch contracts 为 0 | 已完成：session pass 正常物化，blocked 明确诊断 | 无 |
| provider-origin receipt | 已完成：真实 receipt + action ledger + provider output snapshot | 无 |
| handoff 字段不稳定 | 已完成：模板标准化 + provider completion 有限兼容历史格式 | 无 |
| quality-lineage | 已完成：依赖 dispatch 与 coverage，并补标准 evidence summary | 无 |
| acceptance matrix | 已完成：标准路径明确，root-level warning | 无 |
| role purity | 已完成：依赖标准 evidence，非标准路径诊断 | 无 |
| final gates/report | 已完成：runtime 生成 orchestration final gates/report | 无 |
| runtime 展示噪声 | 已完成：root cause summary + debug 展开 | 无 |
| Git baseline | 已完成：验收链路覆盖 baseline 后 commit/push/archive | 无 |
