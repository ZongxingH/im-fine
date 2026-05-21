# Harness 工程问题池

这是 imfine harness 工程的统一问题池。它不绑定任何特定 demo。只要问题出现在任意 run、截图、handoff、报告或 replay fixture 中，就先归入这里，直到 runtime 能确定性地阻断、解释或修复它。

## 目标

imfine 必须把模型侧多 Agent 工作转化为 runtime 可审计证据。

一个 run 不能因为 Agent 写了代码、handoff 或 archive 文本就算 completed。一次 completed true harness run 必须具备 dispatch contracts、provider-origin receipts、wave history、有效 handoff、QA/Review gate、acceptance matrix、fresh true harness evidence、commit/push policy 处理、runtime final gates，以及一致的 run/session/report 状态。

## 原则

- Runtime 负责记录、校验、reconcile 和 finalize；不负责启动 Codex 或 Claude provider agent。
- 当前 provider 会话中的 Orchestrator 负责启动原生子 Agent，并把事实回填给 runtime。
- 截图、聊天文本和 provider UI observation 只能作为诊断证据，不能作为 true harness proof。
- Agent 文字总结不能绕过 runtime gates。
- stale evidence 不能满足 final gate。
- 每个反复出现的问题都必须变成 fixture 或回归测试。

## 历史复盘来源

本问题池整合了早期 demo 复盘材料中的问题。后续不再按某个 demo 单独维护问题清单；所有问题都归并到本文的 H-xxx 条目。

已合并的典型证据包括：

- 模型侧截图显示多个原生子 Agent 曾运行，但 runtime 没有可验证 receipt。
- `run.json.status` 和 `orchestration/state.json.status` 长时间停在 `waiting_for_agent_output`。
- `orchestrator-session.json` 写出 action 或自称 completed，但 runtime 没有正式 ingest。
- `orchestration/agent-runs.json.agents = []`。
- `orchestration/dispatch-contracts.json.contracts = []`。
- `orchestration/parallel-execution.json.wave_history = []`。
- `orchestration/provider-capability.json.provider = unknown`。
- `orchestration/provider-receipts/` 缺失。
- `orchestration/true-harness-evidence.json.true_harness_passed = false`。
- `true-harness-evidence.json` 早于后续 session 或 handoff 更新，成为 stale evidence。
- QA / Review 初始 block 后存在 recheck pass，但 status 仍显示 QA / Review missing。
- Committer / Archive 只写出 handoff 或报告，没有 runtime final gates。
- 缺少 `orchestration/acceptance-matrix.json`。
- 缺少 `orchestration/final-gates.json`。
- 新项目不是 git 仓库或没有 commit，导致交付版本不可追踪。
- 业务测试依赖特定 runtime 版本，但项目没有声明可复现环境。

这些证据分别归入 H-001 到 H-016。以后如果新 run 暴露相同问题，只更新本文对应条目或新增 H-xxx，不再新建 demo 专属问题文档。

## P0 问题

### H-001 Orchestrator 输出没有被 runtime ingest

问题：
Agent 可以写出 `orchestrator-session.json`、`agents/*/handoff.json`、业务代码和 archive 文本，但 `run.json` 与 `orchestration/state.json` 仍停在 `waiting_for_agent_output`。

影响：
Runtime 没有权威状态视图。`status`、`reconcile` 和 `finalize` 无法可靠判断 run 是 ready、blocked 还是 completed。

解决方案：

- 增加 runtime-internal `ingest` 步骤。
- 校验 `orchestrator-session.json`。
- 将 session actions 物化为 dispatch contracts。
- 将 handoff 绑定到 action id。
- 更新 `agent-runs.json`、`parallel-execution.json` 和一致性 artifact。
- 在 `status`、`reconcile`、`finalize` 前执行 ingest。

验收标准：

- session 有 action 但 runtime artifact 为空时，run 必须显示 inconsistent。
- ingest 后，每个 required action 都能追溯到 dispatch contract、handoff expectation 和 gate。
- ingest 不能在没有 provider-origin receipts 的情况下让 true harness 通过。

### H-002 Dispatch contracts 和 wave history 缺失

问题：
模型侧子 Agent 可能已经运行，但 `dispatch-contracts.json`、`agent-runs.json` 和 `parallel-execution.json` 仍为空。

影响：
缺少可审计 execution graph，无法证明并行、依赖、ownership 和完成状态。

解决方案：

- 每个 planned agent action 都必须物化为 dispatch contract。
- 每个 contract 记录 dependencies、parallel group、role、expected handoff、expected receipt 和 expected outputs。
- Runtime 记录 wave started / completed 事实。
- 缺 completed wave 时阻断 true harness evidence。

验收标准：

- Required contracts 数量与 required actions 数量一致。
- 每个 required contract 都有 started/completed wave，或有明确 blocker。
- 缺 wave history 时，status 必须显示缺失的 action id。

### H-003 Provider-origin receipts 缺失

问题：
即使截图或 handoff 暗示子 Agent 已运行，provider capability 仍可能是 unknown，且 `orchestration/provider-receipts/` 缺失。

影响：
run 无法证明原生子 Agent 执行。截图不足以作为 true harness proof。

解决方案：

- 为 Codex 和 Claude 定义 Orchestrator handback 协议。
- 记录 provider、provider agent id、provider session id、task handle 或 trace id、output snapshot、output sha256、started_at、completed_at。
- 将 provider UI observation 单独存放在 `orchestration/provider-observations/`。
- provider metadata 不可得时，保持 `true_harness_passed=false`。

验收标准：

- 每个 required agent contract 都有有效 provider-origin completed receipt。
- receipt 缺 metadata、output snapshot 或 integrity 时校验失败。
- provider observation 永远不能满足 receipt gate。

### H-004 True harness evidence 变 stale

问题：
`true-harness-evidence.json` 可能早于后续 session、handoff、dispatch contract、receipt、final gate 或 acceptance evidence 更新。

影响：
旧 evidence 可能被误读为当前证明。

解决方案：

- 在 true harness evidence 中记录 source artifact 的 mtime 和 content hash。
- `status`、`reconcile`、`finalize` 必须检查 freshness。
- `reconcile` 重新生成 stale evidence。
- `finalize` 必须阻断 stale evidence。

验收标准：

- 任意 source artifact 修改后，true harness evidence 必须被标记为 stale。
- stale evidence 不能满足 archive 或 final gate。
- status 必须指出导致 stale 的 source artifact。

### H-005 Handoff 存在但未被 runtime 采纳

问题：
标准 `agents/*/handoff.json` 可能已经存在，但 runtime 没有把它们采纳到 `agent-runs.json`、evidence collector、gate status 或 final report 中。

影响：
Agent 工作仍只是旁路文本证据，而不是权威 run 状态。

解决方案：

- ingest 按 role schema 校验每个 handoff。
- handoff 必须链接到 dispatch contract。
- handoff 引用的 evidence 必须存在。
- Markdown report 只能作为 handoff 引用的 evidence，不能替代 handoff。

验收标准：

- 有效 handoff 必须能在 agent run state 中看到。
- handoff evidence 缺失或无效时，相关 gate blocked。
- markdown-only report 不能通过 final gates。

### H-006 QA / Review recheck 结果没有建模

问题：
初始 QA 或 Review action 可以 block，后续 rework 和 recheck 可以 pass，但 status 和 gates 仍显示 QA / Review missing 或 blocked。

影响：
Runtime 无法表达正常 fix-loop 行为。

解决方案：

- 建模 action lineage：original check、finding、rework、recheck、resolves、supersedes。
- Gate 计算使用同一 lineage 中最新有效结果。
- recheck pass 必须引用其解决的 blocker 或 finding。
- evidence collector 同时索引原始 finding 和 resolved recheck evidence。

验收标准：

- 初始 QA block 加关联 QA recheck pass 时，QA gate 通过。
- 初始 Review findings 加关联 reviewer recheck pass 时，Review gate 通过。
- recheck 缺 evidence 或 lineage 时，不能覆盖早先 block。

### H-007 Final gates 缺失或被绕过

问题：
Archive 或 Committer Agent 可以写 handoff 或报告，但 `orchestration/final-gates.json` 缺失。

影响：
用户可能看到 archive 文本就误以为 completed，但 runtime 从未 finalize。

解决方案：

- 只有 runtime archive finalize 可以写 final gates。
- Archive Agent handoff 是 finalize 的输入，不是 finalization 本身。
- 只有 final gates 通过后，run status 才能变为 `completed`。
- final gates 通过前生成的报告必须标记为 pre-archive 或 blocked。

验收标准：

- Archive handoff 存在但 final gates 缺失时，run 保持 blocked 或 ready_for_commit。
- 没有 final gates pass 时不能生成 `Final Archive Report`。
- run status、session status、report status 必须一致。

### H-008 Acceptance matrix 缺失

问题：
run 可以交付代码，但没有结构化矩阵说明每个 required requirement 是通过、替代实现还是偏离需求。

影响：
Runtime 无法区分完整交付、合理 demo substitute 和未接受 deviation。

解决方案：

- 要求 Agent-authored acceptance matrix。
- 覆盖所有 required 用户需求。
- 建模 `pass`、`blocked`、`demo-substitute`、`deviation`。
- deviation 必须被 QA/Review 接受。

验收标准：

- 缺 acceptance matrix 时 final gates blocked。
- Required deviation 未被 QA/Review 接受时 final gates blocked。
- Runtime 只校验 schema 和 evidence，不按关键词判断产品语义。

### H-009 Commit / push policy 未强制执行

问题：
新项目 run 可能不是 git 仓库，可能没有 commit，或跳过 push，但仍生成类似 archive 的输出。

影响：
交付代码版本不可追踪。

解决方案：

- run 创建时记录 commit policy。
- 检测 git 初始化状态和 HEAD baseline。
- 对新项目，如果策略允许则创建 baseline / implementation commit；否则进入 `awaiting_user_approval` 或 `ready_for_commit`。
- 只有 remote policy 和 origin 允许时才 push。

验收标准：

- 没有 commit evidence 时 run 不能 completed。
- 没有 remote 时输出明确 push blocker 或 no-remote 状态。
- completed final report 必须引用 commit hash。

### H-010 Status 基于文件存在性而不是 gate 状态

问题：
status 有时只检查固定文件，例如 `evidence/test-results.md`，而不是从 runtime artifacts、handoff lineage、receipts 和 final gates 推导状态。

影响：
status 可能在有效 recheck handoff 存在时仍显示 QA/Review missing，也可能遗漏真正 blocker。

解决方案：

- status 读取 ingest 和 gate calculation 生成的标准 runtime state。
- 显示 latest QA/Review lineage result。
- 显示 stale evidence source。
- 显示缺失的 receipt/action/handoff id。
- 显示 next owner：Orchestrator、Agent、runtime、provider、user 或 project code。

验收标准：

- status 输出足以决定下一步动作。
- status 不需要用户手工重建目录状态。
- status 与 reconcile/finalize 结论一致。

## P1 问题

### H-011 Evidence collector 未统一标准路径

问题：
QA、Review、commit、push 和 archive evidence 可能散落在 handoff、agent 目录或临时 report 文件中。

解决方案：

- 将引用 evidence 收敛到 run-local 标准路径：
  - `evidence/test-results.md`
  - `evidence/review.md`
  - `evidence/risk-review.md`
  - `evidence/commits.md`
  - `evidence/push.md`
- 保留原始引用。

验收标准：

- Gate calculation 可以依赖标准 evidence 路径。
- status 能说明缺失的是哪个标准路径。

### H-012 Provider observation 诊断不完整

问题：
截图和 UI observation 能帮助人工审计 run，但目前没有稳定保存和证明边界说明。

解决方案：

- 增加 `orchestration/provider-observations/*.json`。
- 记录截图路径、observed display names、closed count、timestamp 和用户备注。
- true harness evidence 明确区分 observation 和 verified receipt。

验收标准：

- status 可以显示 provider observations present。
- observations 永远不能满足 receipt gates。

### H-013 Agent name mapping 缺失

问题：
Provider display name 无法追溯到 action id。

解决方案：

- 启动子 Agent 时写 `orchestration/agent-name-map.json`。
- 映射 provider display name、action id、role、parallel group、expected output 和 started_at。

验收标准：

- 截图中的 agent name 能追溯到 action id、dispatch contract、handoff、receipt 和 gate。

### H-014 Demo 项目 runtime requirements 未声明

问题：
生成项目可能在某个解释器或 runtime 版本下测试通过，但在另一个版本下失败，且没有声明版本要求。

解决方案：

- 新项目交付必须包含 README 或 runbook。
- 语言版本要求必须写入 `.python-version`、`pyproject.toml`、`package.json` 或等价文件。
- QA 和 archive evidence 必须记录实际 runtime version 和测试输出。

验收标准：

- runtime 版本错误时显示环境 blocker，而不是误报为产品失败。
- Archive 中的测试数量必须与实际命令输出一致。

## P2 问题

### H-015 Replay fixtures 缺失

问题：
反复出现的问题仍靠人工发现，没有进入测试。

解决方案：

- 为每个 P0 问题增加 minimized replay fixture。
- 将 fixtures 纳入 `npm test`。
- 断言 status/reconcile/finalize 行为。

验收标准：

- handoff 存在但 receipt 缺失的 fixture 不能通过。
- Archive handoff 存在但 final gates 缺失的 fixture 不能 completed。
- stale evidence fixture 必须阻断 finalize。

### H-016 Harness 改进没有跨 run 评估

问题：
修改 harness 时，没有结构化记录它针对哪个失败，以及是否真正修复。

解决方案：

- 对非平凡 harness 修改使用 harness evolution record。
- 链接 source failure、affected components、predicted impact、verification run、observed result 和 regression risks。

验收标准：

- 一个 harness 修改可以从失败追溯到验证结果。
- 反复出现的问题能被识别为 evolution record 未完成或验证失败。

## 彻底解决方案

### 阶段 1：冻结失败形态

在修改行为前，先为 H-001 到 H-010 创建 minimized fixtures。

每个 fixture 必须断言：

- `status` 显示 blocked 或 inconsistent；
- `reconcile` 不能把 run 推成 completed；
- `finalize` 不能生成 completed final report；
- blocker 必须指出 required evidence 和 owner layer。

### 阶段 2：建设 ingest 管线

实现 runtime-internal ingest，并让它成为 status、reconcile、finalize 的前置步骤。

输出：

- `session-validation.json`
- `handoff-validation.json`
- `dispatch-contracts.json`
- `agent-runs.json`
- `parallel-execution.json`
- `orchestrator-runtime-consistency.json`

### 阶段 3：建设 evidence 和 lineage

实现 provider receipt handback、handoff validation、evidence collector 和 QA/Review recheck lineage。

输出：

- `provider-receipts/*.json`
- `provider-observations/*.json`
- `agent-name-map.json`
- 标准 `evidence/*.md`
- action ledger 或 dispatch contracts 中的 lineage 字段

### 阶段 4：建设 runtime final gates

Final gates 只能由 runtime 计算。

输入：

- session validation
- dispatch 和 wave state
- provider receipts
- standard handoffs
- QA/Review latest lineage
- acceptance matrix
- commit/push evidence
- true harness evidence freshness
- project knowledge freshness

输出：

- `acceptance-matrix.json`
- `final-gates.json`
- fresh `true-harness-evidence.json`
- `.imfine/reports/<run-id>.md`

### 阶段 5：让 status 成为真实驾驶舱

Status 必须显示：

- consistency state
- latest gate state
- stale evidence source
- missing action/receipt/handoff ids
- commit/push/archive state
- next owner 和 next required artifact

### 阶段 6：强制项目可复现性

新项目交付必须包含可复现运行契约：

- README 或 runbook
- runtime version requirements
- test command
- actual test output
- archive verification freshness

## 完成定义

只有满足以下条件，run 才能 completed：

- required dispatch contracts 存在；
- required waves completed；
- required provider-origin receipts 校验通过；
- required handoffs 校验通过；
- QA/Review latest lineage 通过；
- acceptance matrix 存在且校验通过；
- true harness evidence fresh 且通过；
- commit/push policy 已满足，或明确 blocked 且不进入 completed；
- final gates 通过；
- run/session/report status 一致。

在这些条件满足前，imfine 可以生成有价值的业务 demo，但不能声称完成了 completed true harness delivery。
