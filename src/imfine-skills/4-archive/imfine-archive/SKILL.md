---
name: imfine-archive
description: Confirm imfine final gates and archive a completed or ready run.
---

# imfine Archive Workflow

Archive an imfine run only after deterministic final gates and Agent evidence are closed.

## Steps

1. Resolve the target run from user input or `.imfine/state/current.json`.
2. Confirm required Agent handoffs, QA evidence, review evidence, commit/push policy, and project knowledge updates.
3. Run deterministic reconcile/finalize/archive actions as needed.
4. Verify `orchestration/final-gates.json` is runtime-generated and required gates pass.
5. Report archive artifacts, blocked items, and follow-up owners.

## Rules

- Agent-authored root-level final gates do not count.
- Missing provider-origin receipts block true-harness completion.
- Archive must not hide accepted deviations or follow-up risks.
