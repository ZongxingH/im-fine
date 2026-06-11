---
name: imfine-execute-task-plan
description: Execute imfine task plans through Dev, QA, Review, and handoff evidence.
---

# imfine Execute Task Plan

Use this workflow to drive task implementation through native Agents and runtime validation.

## Steps

1. Dispatch Dev for scoped implementation.
2. Collect and validate patches through runtime.
3. Dispatch QA for verification.
4. Dispatch Reviewer for code review.
5. Route failures into fix-loop recovery.
6. Continue until task evidence is closed or blocked.

## Rules

- Agent handoffs must be explicit.
- Runtime-owned evidence is validation, not Agent judgment.
- Fix loops require closed recheck evidence.
