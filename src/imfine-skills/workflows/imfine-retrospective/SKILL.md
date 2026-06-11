---
name: imfine-retrospective
description: Run an imfine post-run retrospective to extract lessons, project knowledge, and harness evolution signals.
---

# imfine Retrospective Workflow

Use this workflow after archive, after blocked run closure, or after a non-trivial harness/demo validation cycle.

This workflow absorbs BMAD `bmad-retrospective` and adapts it to imfine project knowledge, harness evolution, and replay coverage.

## Inputs

- Archive report and final report.
- Final gates and true-harness evidence.
- QA/Review/Risk findings.
- Blocker matrix and fix loop history.
- Commit/push/archive evidence.
- Harness debugger report, trace, and component registry.

## Process

1. Summarize intended outcome and actual outcome.
2. Identify what worked.
3. Identify blockers, rework, stale assumptions, and evidence gaps.
4. Extract project knowledge updates.
5. Extract harness evolution candidates.
6. Decide whether replay coverage or new regression tests are needed.
7. Write retrospective artifact and handoff to Project Knowledge Updater.

## Outputs

- `.imfine/runs/<run-id>/archive/retrospective.md`.
- Project knowledge update candidates.
- Harness evolution candidates with affected component ids.
- Replay/test recommendations.

## Prohibited

- Do not use retrospective to relabel a failed run as successful.
- Do not add project knowledge without archive-confirmed evidence.
- Do not propose harness evolution without source failure and predicted impact.
