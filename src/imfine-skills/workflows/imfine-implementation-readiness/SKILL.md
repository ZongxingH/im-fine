---
name: imfine-implementation-readiness
description: Check whether imfine requirement, product, architecture, task graph, and evidence contracts are ready for execution.
---

# imfine Implementation Readiness Workflow

Use this workflow after requirement/product/architecture planning and before Dev dispatch.

This workflow absorbs BMAD `bmad-check-implementation-readiness` and adapts it to imfine true-harness gates.

## Required Inputs

- Normalized requirement.
- Product brief or accepted brainstorming direction when applicable.
- Architecture decisions and implementation boundaries.
- Task graph and ownership plan.
- Runtime provider capability snapshot when a run exists.
- Acceptance candidates or Agent-authored acceptance matrix input.

## Readiness Gates

1. Requirement is clear enough to implement.
2. Product scope and non-goals are explicit.
3. Architecture decisions prevent inconsistent Agent implementation.
4. Task graph has valid ids, dependencies, scopes, verification, review, and commit plan.
5. Parallel groups have non-overlapping write scopes.
6. QA and Review plans exist per task.
7. Provider native subagent capability is supported or explicitly blocked.
8. Runtime evidence paths and handoff outputs are declared.
9. Archive, project knowledge, and true-harness evidence are accounted for.

## Outputs

- `.imfine/runs/<run-id>/orchestration/implementation-readiness.md`.
- Readiness verdict: `ready`, `needs_replan`, `needs_clarification`, or `blocked`.
- Required fixes with owner.

## Prohibited

- Do not dispatch Dev Agents when readiness is `blocked`.
- Do not treat a syntactically valid task graph as implementation-ready if product or architecture evidence is missing.
- Do not use runtime validation as a substitute for Agent-authored planning judgment.
