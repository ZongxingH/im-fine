---
name: imfine-status
description: Inspect imfine run status, gates, blockers, and next actions.
---

# imfine Status Workflow

Show current imfine status without mutating delivery artifacts.

This workflow absorbs BMAD `sprint-status` and Superpowers `verification-before-completion`: status is a readiness and blocker dashboard, not a success narrator.

## Steps

1. Resolve the target run from user input or `.imfine/state/current.json`.
2. Collect summary status:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js status --story
   ```
3. Use debug status only when the user needs artifact-level diagnosis:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js status --debug
   ```
4. Explain current run state, blockers, gate status, Agent-authored evidence, runtime-derived evidence, and next owner.

## Status Sections

- Run identity and source request.
- Current state and consistency.
- Next owner and next action.
- Agent runs and native provider receipts.
- Dispatch / parallel execution status.
- QA, Review, Risk, Committer, Archive gates.
- Acceptance matrix and accepted deviations.
- True-harness evidence freshness.
- Runtime requirements and sandbox verification.
- Project knowledge freshness.
- Course correction or readiness blockers.

## Rules

- Status is read-only.
- Keep Agent-authored and runtime-derived evidence visually distinct.
- Do not hide blocked gates behind a success summary.
- Do not claim completion from `run.json` alone.
- Do not treat missing final gates as a cosmetic issue.
- Do not advance state unless the user invoked an explicit reconcile/finalize workflow.
