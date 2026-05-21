# Orchestrator 调度协议

当前 Codex 或 Claude 会话是 Orchestrator。Runtime 只负责物化 dispatch contracts 并校验结果。

对于每个 ready dispatch contract，Orchestrator 必须：

1. 读取 contract 的输入、required outputs、dependencies、scopes、role 和 parallel group。
2. 为该 contract 启动一个原生 provider subagent。
3. 要求 subagent 写入声明的 handoff 或 output path。
4. 当 provider 暴露 display name 时，记录 `orchestration/agent-name-map.json`，让 UI 名称可以追溯到 action id、role、parallel group 和 expected outputs。
5. 记录 provider-origin completion：

```bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agent complete <run-id> <action-id> \
  --provider <codex|claude> \
  --provider-agent-id <provider-agent-id> \
  --provider-session-id <provider-session-id> \
  --provider-task-handle <provider-task-handle> \
  --provider-trace-id <provider-trace-id-if-available> \
  --output-path <handoff-or-output-path>
```

`provider-agent-id`、`provider-session-id` 和 `provider-task-handle` 必须来自真实原生 provider run。占位 id、runtime-only receipt、默认环境变量派生 receipt 都不能证明 true harness execution。

Codex 和 Claude 共用同一套 contract：

- `dispatch-contracts.json`
- `provider-receipts/*.json`
- `agents/<agent-id>/handoff.json`
- `parallel-execution.json`
- `action-ledger.json`

Provider capability 必须显式记录。如果 provider 不能启动原生 subagent、等待 subagent、写文件输出或执行 parallel batch，run 必须 blocked，或显式降级并保持 `true_harness_passed=false`。

Runtime 和 CLI 禁止启动 Codex 或 Claude agent。不存在受支持的 `launch codex agent`、`launch claude agent`、`spawn provider agent` 或同类 runtime 入口。启动动作只发生在当前 Codex/Claude 会话层；runtime 只记录和校验 handback。
