# imfine-demo runtime 噪声问题与解决方案

本文整理 imfine-demo 验证过程中暴露的“JS/runtime 执行过多、演示观感不合理”问题，并给出对应解决方案。这里的重点不是否定 Node.js runtime，而是避免确定性 runtime 的内部动作盖过 true harness 的多 Agent 主线。

## 整改状态

**已彻底实现完成。**

- 默认 `status` 输出已改为演示摘要：只展示 run 状态、证据来源、gate phase、压缩 gate、阻塞原因和下一步。
- `status --story` 已提供面向人的流程视图，突出当前 wave、证据、gate phase、阻塞和下一步。
- `status --debug` 保留内部 runtime 细节，默认输出不再展示 harness debugger、standard evidence 等低层字段。
- `report --demo-summary` 已提供演示报告摘要，普通 `report` 仍按内部动作保护。
- final report/archive report 已加入 `Evidence Origin` 和 `Gate Phase`，明确区分 Agent-authored 与 Runtime-derived。
- 所有高层 gate 输出已统一使用 `[gate:*]` 前缀。
- 回归测试已覆盖默认降噪、story/debug 分层、gate phase、Evidence Origin 和 final report gate 压缩视图。

实现位置：

- `src/core/cli.ts`
- `src/core/format.ts`
- `src/core/status.ts`
- `src/core/archive.ts`
- `src/core/reconcile.ts`
- `test/smoke.mjs`
- `test/reconcile.mjs`

## 1. demo 输出中 JS/runtime 命令过于密集

**问题**

demo 过程中频繁出现 `node ... imfine-runtime.js ...`、内部状态刷新、文件读写、reconcile、evidence 生成等输出。用户视角会感觉整个 demo 是 JS 脚本在推进，而不是 Orchestrator 调度原生子 Agent。

**影响**

- true harness 的主线被 runtime 噪声淹没。
- 用户容易误解为“脚本 harness”，而不是“多 Agent harness”。
- demo 可读性下降，关键节点不突出。

**解决方案**

- demo 默认只展示高层事件：
  - runtime 创建 run/context。
  - Orchestrator 派发 native Agent。
  - Agent 返回 handoff。
  - runtime 记录 provider receipt。
  - QA/Reviewer/Archive gate pass 或 blocked。
- 将普通 JS 命令、内部 JSON 写入、trace 写入折叠到 verbose/debug 模式。
- 增加面向演示的 summary 输出，例如：

```text
runtime: context materialized
orchestrator: dispatched Architect, Task Planner
agent: Architect completed with provider receipt
gate: QA blocked with 3 findings
orchestrator: dispatched remediation wave
gate: true_harness blocked/pass
```

**实现状态：已完成。** 默认 `status` 已输出高层 summary，内部字段只在 `--debug` 展示，测试覆盖默认输出不包含 `current run harness debugger` 与 `current run standard evidence`。

## 2. runtime 确定性动作显得像执行主体

**问题**

runtime 在 demo 中反复创建、修补、刷新 evidence、final gates、trace、report。虽然这些动作是确定性校验职责，但输出过多会让人感觉 runtime 在“主导完成项目”。

**影响**

- 模糊 runtime 和 Orchestrator/Agent 的职责边界。
- 与 true harness 契约中“runtime 只做确定性后端”的认知冲突。
- 降低对 provider-origin Agent 产物的信任感。

**解决方案**

- runtime 输出降级为“checkpoint”风格，而不是逐文件叙述。
- 将 runtime 内部动作归类为：
  - `materialize`
  - `validate`
  - `record`
  - `gate`
  - `archive`
- 默认输出只显示动作分类和结果，不显示每个 JS 命令。
- debug 模式保留完整命令和文件路径。

**实现状态：已完成。** `formatStatusSummary` 和 `formatStatusStory` 使用 checkpoint/phase 风格输出；`formatStatusDebug` 保留完整 runtime 状态字段。

## 3. 证据链过度派生，Agent 产物不够突出

**问题**

demo 中 runtime 会生成大量 JSON/MD 证据，如 dispatch、parallel execution、quality lineage、true harness evidence、final gates、trace 等。证据完整是好事，但演示中这些派生产物过多，会掩盖真正重要的 Agent handoff 和 provider receipt。

**影响**

- 用户难以分辨哪些是 Agent 原始产物，哪些是 runtime 派生证据。
- 审计链条显得复杂，理解成本高。
- 容易产生“runtime 在补材料”的印象。

**解决方案**

- 在 demo summary 中明确区分：

```text
Agent-authored:
- agents/architect/handoff.json
- agents/task-planner/handoff.json
- agents/qa-*/handoff.json

Runtime-derived:
- dispatch-contracts.json
- provider-receipts/*.json
- true-harness-evidence.json
- final-gates.json
```

- 默认展示 Agent-authored 产物优先。
- Runtime-derived 产物只展示 pass/blocked 摘要。
- final report 中加入“Evidence Origin”小节。

**实现状态：已完成。** `status`、`report --demo-summary`、reconcile final report、archive report 均输出 `Evidence Origin`，并明确列出 `Agent-authored` 与 `Runtime-derived`。

## 4. 内部 reconcile/archive 刷新次数过多

**问题**

demo 中 reconcile、archive、true harness evidence、role purity、quality lineage 等可能多次刷新。虽然每次刷新有技术原因，但演示时看起来像 runtime 在不断“自我修补”。

**影响**

- 输出显得机械且重复。
- 用户难以判断哪一次 gate 结果才是最终结果。
- 可能误以为系统不稳定，需要反复跑 JS 才能收敛。

**解决方案**

- 引入单次 run 的 gate phase 摘要：

```text
Gate phase:
1. collect standard evidence: pass
2. quality lineage: pass
3. role purity: pass
4. true harness evidence: pass
5. final gates: pass
```

- 对重复刷新使用同一个 logical event id，输出时合并。
- 默认只显示最终 gate phase 结果。
- verbose 模式才显示每次刷新细节。

**实现状态：已完成。** `status`、`status --story`、`report --demo-summary` 和 final report/archive report 均输出 `Gate phase`/`Gate Phase` 压缩结果。

## 5. 缺少面向人的 demo 日志层

**问题**

当前输出更接近工具执行日志，而不是面向用户理解 true harness 的演示日志。它暴露了太多底层命令，却没有把流程抽象成可读事件。

**影响**

- demo 不够“讲故事”。
- 用户很难快速判断：
  - 当前谁在工作？
  - runtime 在做什么？
  - 哪些 Agent 已完成？
  - 哪个 gate 阻塞？
  - 下一步是什么？

**解决方案**

- 增加 `demo/story` 风格状态输出：

```bash
imfine-runtime status --story
```

或：

```bash
imfine-runtime report --demo-summary
```

- 已落地输出结构：

```text
Run: <run-id>
State: waiting_for_agent_output

Current wave:
- Backend Dev: running
- Frontend Dev: completed
- Task Planner: completed

Evidence:
- provider receipts: 3/5
- handoffs: 3/5
- role purity: pass

Blocked:
- Reviewer found 3 findings; remediation dispatch required

Next:
- dispatch Backend Fix Agent
- dispatch Frontend Fix Agent
- run QA recheck
```

**实现状态：已完成。** CLI 已支持 `status --story` 和 `report --demo-summary`；普通 `report` 保持内部动作保护，避免把内部报告读取暴露成主流程。

## 6. Runtime 和 Agent 的边界需要在输出中显式标注

**问题**

即使代码层已经区分 runtime 和 Agent，demo 输出如果不标注来源，用户仍然会把所有动作混在一起看。

**影响**

- 用户无法判断某个产物是不是 provider-origin。
- Orchestrator、runtime、subagent 三者职责不清。
- true harness 可信度降低。

**解决方案**

- 每条高层日志带来源前缀：

```text
[runtime] created run context
[orchestrator] dispatched Backend Dev Agent
[agent:backend-dev] wrote handoff
[runtime] recorded provider receipt
[gate:role-purity] pass
```

- 对 provider-origin 动作使用独立标识：

```text
[provider:codex] agent Backend Dev completed task handle xxx
```

- 对 runtime-derived 动作避免使用“我会修”“我会编辑”等主语。

**实现状态：已完成。** 高层输出统一使用 `[runtime]`、`[orchestrator]`、`[agent:*]`、`[gate:*]` 来源前缀，gate 压缩视图已统一为 `[gate:*]`。

## 7. JS 执行本身合理，但不应暴露为主流程

**问题**

imfine runtime 是 Node/TypeScript 实现，因此使用 JS 执行是合理的。但 demo 中如果大量展示 `node ...`，会让用户把实现语言误认为工作流主体。

**影响**

- 用户关注点从 harness 契约偏移到脚本执行。
- 容易误解 runtime 负责了需求判断、架构、实现、QA。
- 演示体验不够产品化。

**解决方案**

- 保留 Node runtime，但隐藏底层命令。
- 用户入口统一为：

```text
/imfine run <需求>
/imfine status
```

- 内部命令只在 debug 模式或失败诊断中展开：

```bash
imfine-runtime status --debug
imfine-runtime trace --debug
```

**实现状态：已完成。** 用户侧默认入口已通过 summary/story 输出隐藏底层 Node 命令语义，内部 CLI 行为仍可用 `--debug` 诊断。

## 8. gate 结果缺少压缩视图

**问题**

当前 gate 相关文件很多：quality lineage、role purity、true harness evidence、final gates、runtime requirements、acceptance matrix。demo 输出如果逐个展开，会非常重。

**影响**

- 用户难以快速看出整体结果。
- 阻塞项不聚焦。
- 通过/失败原因散落在多个 JSON/MD 文件中。

**解决方案**

- 增加 gate 压缩视图：

```text
Gates:
- planning: pass
- dispatch: pass
- provider receipts: 5/5
- handoffs: 5/5
- role purity: pass
- QA: pass
- review: blocked
- archive: not ready

Blocking reason:
- reviewer found 3 required fixes
```

- 将详细证据路径放到折叠区域或 debug 输出。

**实现状态：已完成。** 默认状态输出展示压缩 gate，final report 保留可审计路径；测试锁定 `[gate:planning]`、`[gate:role-purity]`、`[gate:final-gates]` 等压缩项。

## 9. Demo 中应减少“当前会话执行命令”的叙述

**问题**

类似下面的输出容易让人误解当前会话在亲自执行实现：

```text
我会编辑 5 个文件
我先跑测试
我来修这个边界
```

role purity gate 已在代码层拦截这类角色越界；演示输出层也需要避免这类表达。

**影响**

- 破坏 Orchestrator-only 的角色感。
- 用户会怀疑 true harness 退化成单 Agent。
- 与 provider-origin 子 Agent 证据冲突。

**解决方案**

- Orchestrator 输出统一改成 dispatch 语言：

```text
Reviewer returned 3 blocking findings.
Orchestrator will create remediation dispatches:
- Backend Fix Agent
- Frontend Fix Agent
- QA Recheck Agent
- Reviewer Recheck Agent
```

- 禁止 Orchestrator demo 输出出现：
  - “我会编辑源码”
  - “我来修”
  - “补丁已落地”
  - “我跑测试得出 QA 结论”

**实现状态：已完成。** runtime 格式化输出改为 dispatch/checkpoint/gate 语言；角色纯度 gate 已在代码层阻止 Orchestrator 产物冒充 Dev/QA/Reviewer。

## 总体完成结果

imfine-demo 的 JS/runtime 噪声问题，本质是“确定性执行细节暴露过多”。本次整改没有减少 runtime 的必要校验，而是在默认输出层完成演示抽象：

1. 默认展示高层 harness 事件，不展示每条 JS 命令。
2. 明确区分 Agent-authored 与 Runtime-derived 证据。
3. 用 `[runtime]`、`[orchestrator]`、`[agent:*]`、`[gate:*]` 前缀标注来源。
4. 已新增 story/demo summary 输出，压缩 gate 和 evidence 结果。
5. debug 模式保留完整 runtime 状态、trace、文件路径。

最终结果：用户看到的是“Orchestrator 调度多 Agent，runtime 负责确定性校验”，而不是“一堆 JS 脚本在完成 demo”。
