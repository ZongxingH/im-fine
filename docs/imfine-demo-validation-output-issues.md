# imfine-demo 验证输出问题与处理方案

本文基于 `/Users/zongxinghuang/MyWorks/work-ifly/research/ai/imfine-demo` 的验证数据和截图中的长屏输出，整理当前 demo 暴露的问题与对应处理方案。重点不是否定 true harness 主线，而是指出当前 demo 数据、runtime 状态收敛和展示层之间仍存在断裂。

## 1. Demo 存在多个 run，当前指针指向不完整 run

**问题**

`.imfine/state/current.json` 当前指向 `20260608-...--2`，该 run 仍停在 `waiting_for_agent_output`，还没有进入完整交付闭环；同时不带 `--2` 的 run 中已经存在大量 Agent handoff、provider receipt、QA/Reviewer 证据。

**影响**

- demo 输出呈现为“当前 run 还在等 Agent”，但另一个 run 里已有大量完成证据。
- 用户难以判断哪一次 run 才是有效验证结果。
- 截图中的长屏输出容易被理解为系统不断重跑或状态混乱。

**处理方案**

- demo 前增加 run 选择校验：只允许一个 active/current run 进入演示。
- `status` 输出中显式提示“current run 与最近完成证据不一致”。
- 提供只读诊断命令或 summary：

```text
runs:
- current: <run-id> waiting_for_agent_output
- previous: <run-id> blocked, provider receipts 17/17, handoffs 17

warning:
- current run does not contain the richest validation evidence
```

- 增加 demo reset/prepare 步骤，避免旧 run 与新 run 混在同一演示里。

## 2. Agent 产物已完成，但 run 状态没有收敛

**问题**

不带 `--2` 的 run 中存在多个 `provider_native_subagent` completed receipt，并且 T001-T005 的 dev、QA、Reviewer handoff 基本齐全；但 `run.json` 仍为 `blocked`，没有生成 final gates、archive report、用户 report。

**影响**

- 用户看到大量 Agent 完成证据，却得不到最终完成/阻塞结论。
- runtime 显得像卡在内部状态，而不是可靠地推进收敛。
- true harness 可信度下降：证据齐了但状态没跟上。

**处理方案**

- 增加 reconciliation pass：基于现有 provider receipts、handoffs、QA/Review 证据重算 run 状态。
- 当所有 required Agent action 都有 completed receipt 和合法 handoff 时，自动推进到 commit/archive/finalize gate。
- 对无法推进的情况生成唯一阻塞原因，不再保留旧 blocker 噪声。

## 3. 旧 blocker 没有被后续事实清除

**问题**

`handoff-validation.json` 仍记录 Architect 缺少 `design/design.md`，但实际 `design/design.md` 和 `agents/architect/handoff.json` 已存在。`blocker-summary.json` 也仍引用 provider capability 未确认、Architect handoff invalid 等早期问题。

**影响**

- demo 输出出现“已经补齐还说缺失”的矛盾。
- 用户会误以为 runtime 校验不可靠。
- 阻塞项不再代表当前真实状态。

**处理方案**

- blocker summary 必须是派生状态，每次 status/reconcile 时从最新证据重算。
- 为 blocker 加 `stale` 判定：当 required evidence 已存在并通过校验，自动移除旧 blocker。
- 输出中区分当前 blocker 与历史 blocker：

```text
Current blockers:
- none

Resolved history:
- architect handoff evidence missing -> resolved
```

## 4. quality-lineage 覆盖不完整但 summary 显示 pass

**问题**

`quality-lineage.json` 的 summary 显示 `qa=pass, review=pass, recheck=pass`，但 lineages 只包含 T001 的 QA/Reviewer；T002-T005 的 QA/Reviewer handoff 已存在，却没有进入 lineage。

**影响**

- gate summary 可能显示全局通过，但证据链实际只覆盖部分任务。
- demo 中 QA/Review 结果不可信。
- final gate 依赖该 summary 时可能产生误判。

**处理方案**

- quality lineage 必须按 task graph 中所有 required task 重算覆盖率。
- summary 增加覆盖信息：

```text
quality lineage:
- QA: pass, coverage 5/5
- Review: pass, coverage 5/5
- Recheck loop: pass, coverage 5/5
```

- 如果有 task 缺 lineage，summary 必须为 blocked，而不是 pass。
- 增加测试：存在 5 个任务时，只记录 1 个任务 lineage 不得通过。

## 5. parallel-execution wave 历史重复且过于底层

**问题**

`parallel-execution.json` 中同一 action 多次出现 `waiting_for_agent_output`，随后又出现 `completed`；iteration 混合了 runtime materialized dispatch、auto orchestrator batch 和 agent completion。

**影响**

- 审计文件可解释，但默认 demo 输出会显得系统反复调度同一 Agent。
- 用户难以区分“历史事件”和“当前状态”。
- 截图中长屏感被 wave 历史放大。

**处理方案**

- 保留完整 wave history 作为 debug 证据。
- 默认 demo 输出使用 logical event 聚合：

```text
Wave 04 implementation:
- T001 Dev: completed
- T002 Dev: completed
- T003 Dev: completed
- T004 Dev: completed
- T005 Docs: completed
```

- 同一 action 的多次 waiting/completed 只显示最终状态。
- debug 模式才展开每次 iteration。

## 6. orchestrator-session 和 queue 未反映真实 completion

**问题**

`orchestrator-session.json` 和 `queue.json` 中大量 action 仍是 `ready`，但对应 provider receipt 与 handoff 已 completed。状态没有从 evidence 回写到 session/queue。

**影响**

- demo 输出可能同时显示 ready 与 completed。
- Orchestrator 看起来不断要求 dispatch 已经完成的 Agent。
- runtime resume/auto-orchestrate 容易重复处理旧 action。

**处理方案**

- 增加 evidence adoption 机制：读取 provider receipt + handoff 后，更新 action ledger/queue/session 的 effective status。
- 区分 authored session 和 runtime effective state：

```text
Authored session:
- agent-dev-T003: ready

Effective runtime state:
- agent-dev-T003: completed by provider receipt
```

- 默认 demo 只展示 effective runtime state。

## 7. commit/archive/final report 链路没有形成闭环

**问题**

`.imfine/reports` 只有 `.gitkeep`，没有用户可读报告；run 中也缺少 final gates。虽然实现代码、测试、QA、Review 证据已大量存在，但没有最终交付报告。

**影响**

- demo 缺少终局结论。
- 用户无法看到“完成了什么、哪些 gate 通过、是否还有阻塞”。
- true harness 的最终可信证据没有落地。

**处理方案**

- reconcile 成功后自动进入 final gates。
- final gates 通过后必须生成：
  - `.imfine/runs/<run-id>/archive/final-report.md`
  - `.imfine/reports/<run-id>.md`
- 如果 archive 不能执行，必须输出唯一阻塞原因，例如 commit policy、push remote、missing acceptance matrix，而不是停在旧 Agent blocker。

## 8. demo 工程 Git 工作区未建立干净 baseline

**问题**

`git status --untracked-files=all` 显示几百个未跟踪文件，包括 `.imfine`、源码、`backend/target` 编译产物和 surefire 报告。`.gitignore` 未忽略 `backend/target/`。

**影响**

- commit/archive gate 容易被构建产物污染。
- demo 中用户会看到大量文件变化，无法判断哪些是 Agent 交付物。
- runtime 可能把测试产物误认为交付范围的一部分。

**处理方案**

- demo 初始化时建立 baseline commit。
- 更新 `.gitignore`：

```gitignore
backend/target/
backend/db/*.sqlite3
```

- commit gate 只允许源代码、测试、文档和必要 `.imfine` 证据进入提交。
- archive summary 中区分 source changes 与 generated build artifacts。

## 9. 默认展示层仍偏诊断，不够 demo/story

**问题**

即使 runtime 噪声已部分降级，当前输出仍容易出现 Gate phase、Gates、Blocker、session summary 等诊断信息叠加，缺少面向用户的主线叙事。

**影响**

- 用户仍要自己拼出“谁完成了什么、现在卡在哪里”。
- demo 截图会显得长且机械。
- Orchestrator/Agent/runtime 边界不够直观。

**处理方案**

- 默认 demo 输出只展示压缩视图：

```text
Run: <run-id>
State: blocked

Agent progress:
- Architect: completed
- Task Planner: completed
- Dev: 5/5 completed
- QA: 5/5 passed
- Review: 5/5 approved

Gates:
- provider receipts: 17/17
- handoffs: 17/17
- quality lineage: blocked, coverage mismatch
- archive: not ready

Next:
- runtime reconcile quality lineage from existing handoffs
```

- `--debug` 才展示路径、iteration、trace、JSON 文件。
- 对重复 wave、历史 blocker、内部 runtime action 做聚合。

## 10. 缺少针对 demo 输出的回归测试

**问题**

当前验证主要依赖功能测试和手工截图，没有针对 demo 输出质量的稳定断言。

**影响**

- 输出容易再次变长。
- 内部路径、`node ... imfine-runtime`、重复 waiting wave、旧 blocker 可能回归。
- 难以自动判断 demo 是否“可讲故事”。

**处理方案**

- 增加 demo output fixture 测试：
  - 默认 status 输出行数上限。
  - 默认输出不得包含 `node ... imfine-runtime`。
  - 默认输出不得展开 `.imfine/runs/.../orchestration/*.json` 细节路径。
  - 已完成 receipt/handoff 不得继续显示为 ready。
  - stale blocker 不得出现在 current blockers。
- 为 `imfine-demo` 的真实 run 数据增加 replay 测试，覆盖状态收敛和展示压缩。

## 总体修复方向

当前 demo 问题本质上不是“Agent 没工作”，而是：

1. demo run 数据没有被清理和选定。
2. runtime 没有从最新 Agent evidence 重算有效状态。
3. 旧 blocker、queue、quality lineage 没有随事实更新。
4. 默认展示层仍暴露了过多诊断过程。

建议按以下顺序处理：

1. 引入 evidence adoption/reconcile，先让已有 receipts + handoffs 能收敛为 effective state。
2. 修复 quality lineage 覆盖率和 stale blocker 清理。
3. 生成 final gates 和 final report，形成交付闭环。
4. 清理 demo baseline 和 `.gitignore`。
5. 增加 demo story summary 与输出回归测试。

## 修复状态

已完成。

- 已修复 current run 与历史 run 证据不一致的默认告警。
- 已修复 provider receipt、handoff、queue、dispatch contract 的 effective state 收敛。
- 已修复 stale blocker 从旧文件直读导致的误报。
- 已修复 quality-lineage 只覆盖部分 task 仍显示 pass 的问题。
- 已修复默认 status/story 输出缺少 Agent progress 与覆盖率摘要的问题。
- 已修复 final report 只落在 run 内部、不生成 `.imfine/reports/<run-id>.md` 的问题。
- 已修复 demo/runtime 默认 `.gitignore` 缺少 `backend/target/`、`backend/db/*.sqlite3` 的问题，并避免该运行时维护项阻塞 worktree/commit 分支切换。
- 已补充 demo 输出、reconcile、quality-lineage、stale blocker、queue effective state、用户报告生成等回归测试。
