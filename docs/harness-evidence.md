# Harness 证据说明

`true-harness-evidence.json` 是 true harness run 的最终证明摘要。

一个 completed true harness run 必须满足：

- 当前会话 Orchestrator 有明确声明；
- provider capability 显示支持原生 subagent；
- 每个 dispatch contract 都有一个有效 provider-origin completed receipt；
- handoff 文件和 wave history 匹配；
- QA、Review、Committer、Archive 和 Project Knowledge gates 闭合；
- 不缺少 required Agent-authored acceptance matrix evidence。

常见失败原因：

- 缺 provider-origin receipt；
- 使用 runtime-only 或 synthetic provider receipt；
- 缺 handoff；
- handoff 引用的 evidence 缺失；
- 缺 completed wave；
- provider capability blocked 或 unknown；
- `true-harness-evidence.json` stale：生成后 session、dispatch、receipts、handoffs、acceptance 或 final gates 又发生变化；
- Archive Agent handoff 存在，但 runtime archive finalization 没有执行；
- acceptance matrix 不是 Agent-authored。

Provider UI 截图和聊天观察可以存放到 `orchestration/provider-observations/`，作为诊断 artifact。它们可以记录 screenshot path、observed display names、closed count、timestamp 和用户备注，但不能作为 native subagent proof。只有带 metadata、output snapshot 和 integrity 的 provider-origin completed receipt 才能满足 true harness evidence。

当 provider capability 是 `unknown` 时，检查：

- `provider-capability.json`：provider 未识别或 installed entry 未检测到。
- `dispatch-contracts.json`：当前会话 Orchestrator 没有物化 dispatch contract。
- `provider-receipts/*.json`：subagent 可能运行过，但 Orchestrator 没有记录 provider-origin completion。
- Receipt metadata：缺 provider agent id、provider session id、provider task handle、output snapshot 或 sha256 integrity，都会导致证明无效。
- `provider-capability-resolution.json`：`resolved_by_receipts=false` 表示 runtime 无法从有效 receipts 推导 provider capability。

调试时重点看这些文件：

- `orchestration/provider-capability.json`
- `orchestration/provider-capability-resolution.json`
- `orchestration/provider-receipts/*.json`
- `orchestration/provider-observations/*.json`
- `orchestration/agent-name-map.json`
- `orchestration/parallel-execution.json`
- `orchestration/action-ledger.json`
- `orchestration/final-gates.json`
- `orchestration/true-harness-evidence.json`
