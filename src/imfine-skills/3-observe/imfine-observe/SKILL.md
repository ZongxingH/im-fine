---
name: imfine-observe
description: Audit imfine demo quality and true-harness observability for a run.
---

# imfine Observe Workflow

Evaluate demo quality and true-harness observability through the Harness Auditor Agent and `imfine-harness-audit` workflow.

## Steps

1. Resolve the target run id from the prompt or `.imfine/state/current.json`.
2. Collect read-only runtime views when useful:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js status --story
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js status --debug
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js report <run-id> --demo-summary
   ```
3. Launch `imfine-agent-harness-auditor` when native subagents are available.
4. Ask the auditor to inspect `.imfine/runs/<run-id>/**` without mutating product code or delivery evidence.
5. Produce `.imfine/runs/<run-id>/analysis/demo-observation.md` when writing is appropriate.
6. Summarize verdict: `pass`, `pass_with_risks`, `blocked`, or `misleading_demo`.

## Fallback

If no native subagent capability is available, run `imfine-harness-audit` in the current session and disclose `auditor_execution=single_session_skill`.
