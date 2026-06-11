---
name: imfine-correct-course
description: Manage significant imfine run changes when requirements, architecture, task graph, or verification direction must change.
---

# imfine Correct Course Workflow

Use this workflow when a run needs a material change after planning or execution has started.

This workflow absorbs BMAD `bmad-correct-course` and Superpowers review/verification discipline.

## Triggers

- User changes scope or acceptance.
- Architecture decision proves wrong.
- Task graph cannot be executed safely.
- QA/Review uncovers a blocker requiring replan.
- Runtime evidence shows the run cannot become true harness under current assumptions.
- External dependency, environment, or provider capability changes.

## Process

1. Identify the change source and evidence.
2. Classify impact: requirement, product, architecture, task graph, execution, QA, review, commit/push, archive, or harness.
3. Freeze affected dispatch until impact is understood.
4. Decide the minimum correction: clarify, brainstorm, product brief, architecture update, task replan, fix loop, or blocked.
5. Write correction record.
6. Re-run implementation readiness before resuming execution.

## Outputs

- `.imfine/runs/<run-id>/orchestration/course-correction.md`.
- Changed assumptions and affected artifacts.
- Required owner actions.
- Updated next_actions guidance for Orchestrator.

## Prohibited

- Do not keep executing stale task graph slices after material assumptions changed.
- Do not hide scope changes inside Dev implementation.
- Do not clear blockers without recheck evidence.
