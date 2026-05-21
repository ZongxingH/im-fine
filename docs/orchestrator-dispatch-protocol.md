# Orchestrator Dispatch Protocol

The current Codex or Claude session is the Orchestrator. Runtime only materializes dispatch contracts and validates the result.

For each ready dispatch contract:

1. Read the contract inputs, required outputs, dependencies, scopes, role, and parallel group.
2. Launch one native provider subagent for that contract.
3. Require the subagent to write the declared handoff or output path.
4. Record `orchestration/agent-name-map.json` when the provider exposes display names, so UI names can be traced to action ids, roles, parallel groups, and expected outputs.
5. Record provider-origin completion:

```bash
node ~/.imfine/runtime/dist/cli/imfine-runtime.js agent complete <run-id> <action-id> \
  --provider <codex|claude> \
  --provider-agent-id <provider-agent-id> \
  --provider-session-id <provider-session-id> \
  --provider-task-handle <provider-task-handle> \
  --provider-trace-id <provider-trace-id-if-available> \
  --output-path <handoff-or-output-path>
```

The provider agent id, session id, and task handle must come from the native provider run. Placeholder ids, runtime-only receipts, and default environment-derived receipts do not prove true harness execution.

Codex and Claude share the same contracts:

- `dispatch-contracts.json`
- `provider-receipts/*.json`
- `agents/<agent-id>/handoff.json`
- `parallel-execution.json`
- `action-ledger.json`

Provider capability is explicit. If a provider cannot launch native subagents, wait for them, write file outputs, or run a parallel batch, the run must be blocked or explicitly degraded with `true_harness_passed=false`.

Runtime and CLI must not launch Codex or Claude agents. There is no supported `launch codex agent`, `launch claude agent`, `spawn provider agent`, or equivalent runtime entry. The launch action happens only inside the current Codex or Claude session; runtime records and validates the handback.
