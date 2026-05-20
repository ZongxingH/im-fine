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
- archive agent handoff exists but runtime archive finalization did not run;
- acceptance matrix was not authored by an Agent.

Use these files to debug:

- `orchestration/provider-capability.json`
- `orchestration/provider-capability-resolution.json`
- `orchestration/provider-receipts/*.json`
- `orchestration/parallel-execution.json`
- `orchestration/action-ledger.json`
- `orchestration/final-gates.json`
- `orchestration/true-harness-evidence.json`
