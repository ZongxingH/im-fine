---
name: imfine-parallel-agent-dispatch
description: Dispatch imfine native provider subagents for independent ready tasks while preserving write-scope safety and provider receipts.
---

# imfine Parallel Agent Dispatch Workflow

Use this workflow when the task graph contains multiple runnable tasks or multiple roles that can proceed independently.

This workflow absorbs Superpowers `dispatching-parallel-agents` and `subagent-driven-development`, with imfine-specific provider receipt and write-scope constraints.

## Core Principle

Fresh native subagent per task or role, with exact context and explicit boundaries. The Orchestrator constructs the context; the subagent should not inherit the whole session.

## Inputs

- Task graph.
- Ownership map.
- Agent capacity.
- Current locks and state.

## Dispatch Eligibility

A task is dispatchable only when:

- all dependencies are satisfied;
- write scope does not overlap with another task in the same batch;
- required inputs exist;
- expected output/handoff path is declared;
- provider native subagent support is confirmed or can be resolved by provider-origin receipt;
- runtime dispatch contract exists or can be materialized from the orchestrator session.

## Steps

1. Select tasks whose dependencies are satisfied.
2. Group tasks by non-overlapping write scopes.
3. Prefer the largest ready batch that preserves boundary safety.
4. Assign agents with explicit `action_id`, inputs, outputs, and boundaries from dispatch contracts.
5. Launch each assigned role as an independent native subagent from the current provider session.
6. Record the provider-origin agent id, session id, task handle, and output path.
7. Collect handoffs, write provider-origin completion receipts, and release locks.

## Action Mapping Contract

- Every native subagent assignment must carry the exact `action_id` from `next_actions[].id`.
- Do not dispatch two same-role agents in the same `parallelGroup` without distinct `action_id` values.
- If a task has no `taskId`, the `action_id` is mandatory.
- Do not let runtime infer backend/frontend, QA/review, or implementation/readiness intent from display names.
- Expected handoff path and provider receipt path must be unique per action.

## Outputs

- Agent assignments.
- Locks and queue updates.
- Provider-origin receipt records for completed native subagents.
- Parallel execution summary.
- Completed handoff files for each native subagent.
- Runtime action ledger entries for runtime gates only.

## Review Loop

For implementation tasks:

1. Dev Agent implements and self-checks.
2. QA Agent verifies acceptance and command evidence.
3. Reviewer Agent checks scope, quality, and regression risk.
4. Dev Agent fixes QA/Review blockers.
5. QA/Reviewer recheck before blocker closure.

## Prompt Templates

Use these imfine-adapted Superpowers templates when dispatching native subagents:

- `references/implementer-prompt.md`
- `references/spec-reviewer-prompt.md`
- `references/code-quality-reviewer-prompt.md`

## Failure Handling

If boundaries overlap, do not serialize by default. First isolate the conflicting tasks, then ask Task Planner to replan the minimum conflicting slice.

## Prohibited

- Do not dispatch agents without write boundaries.
- Do not dispatch agents without an explicit `action_id`.
- Do not collapse a ready batch into serial execution when write scopes are independent.
- Do not accept a task graph that marks everything serial without explicit dependency evidence.
- Do not ask the user to coordinate agents.
- Do not use runtime-only receipts as proof that a native provider subagent ran.
- Do not dispatch multiple implementation agents to the same write scope.
- Do not move to the next phase while a review loop has open required issues.
