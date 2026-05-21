# Harness Evidence

`true-harness-evidence.json` is the final proof summary for a true harness run.

A completed true harness run requires:

- Orchestrator declaration from the current session;
- provider capability showing native subagent support;
- one valid provider-origin completed receipt per dispatch contract;
- matching handoff files and wave history;
- QA, review, committer, archive, and project knowledge gates;
- no missing required Agent-authored acceptance matrix evidence.

Common failure causes:

- missing provider-origin receipt;
- runtime-only or synthetic provider receipt;
- missing handoff;
- handoff references missing evidence;
- missing completed wave;
- provider capability blocked or unknown;
- `true-harness-evidence.json` is stale because session, dispatch, receipts, handoffs, acceptance, or final gates changed after it was generated;
- archive agent handoff exists but runtime archive finalization did not run;
- acceptance matrix was not authored by an Agent.

Provider UI screenshots and chat observations can be stored under `orchestration/provider-observations/` as diagnostic artifacts. They may list screenshot paths, observed display names, closed counts, timestamps, and user notes. They do not count as native subagent proof. Only provider-origin completed receipts with metadata, output snapshot, and integrity can satisfy true harness evidence.

When provider capability is `unknown`, check:

- `provider-capability.json`: provider was not identified or the installed entry was not detected.
- `dispatch-contracts.json`: no current-session Orchestrator dispatch contract was materialized.
- `provider-receipts/*.json`: subagents may have run, but the Orchestrator did not record provider-origin completion.
- Receipt metadata: missing provider agent id, provider session id, provider task handle, output snapshot, or sha256 integrity keeps proof invalid.
- `provider-capability-resolution.json`: `resolved_by_receipts=false` means runtime could not upgrade capability from valid receipts.

Use these files to debug:

- `orchestration/provider-capability.json`
- `orchestration/provider-capability-resolution.json`
- `orchestration/provider-receipts/*.json`
- `orchestration/provider-observations/*.json`
- `orchestration/agent-name-map.json`
- `orchestration/parallel-execution.json`
- `orchestration/action-ledger.json`
- `orchestration/final-gates.json`
- `orchestration/true-harness-evidence.json`
