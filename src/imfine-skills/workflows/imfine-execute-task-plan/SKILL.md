---
name: imfine-execute-task-plan
description: Execute imfine task plans through Dev, QA, Review, and handoff evidence.
---

# imfine Execute Task Plan

Use this workflow to drive task implementation through native Agents and runtime validation.

This workflow absorbs Superpowers `executing-plans` and `subagent-driven-development`, then binds them to imfine's provider-origin receipt and handoff gates.

## Steps

### 1. Load And Critically Review The Plan

1. Read the full task graph and per-task context.
2. Check for missing read/write scopes, missing verification, overlapping write scopes, or vague acceptance.
3. If a critical gap prevents dispatch, stop and return to Task Planner.
4. If valid, create the execution todo list from the task graph.

### 2. Dispatch Fresh Native Agents

For each ready task:

1. Dispatch a fresh Dev Agent with complete task text, read scope, write scope, acceptance, verification command, and expected handoff path.
2. Do not make the subagent read the whole plan when the Orchestrator can provide the exact task context.
3. If the task is mechanical and small, use the least powerful capable model; use stronger models for integration, design, debugging, or review.
4. Record provider-origin ids, session ids, task handles, and output paths when the Agent completes.

### 3. Two-Stage Review Per Task

After Dev handoff:

1. Dispatch QA for spec/acceptance verification and command evidence.
2. Dispatch Reviewer for code quality, scope, maintainability, and regression risk.
3. If QA or Reviewer returns blockers, route back to Dev through a fix loop.
4. Recheck the same blocker with fresh evidence before closing it.

### 4. Runtime Materialization

Use runtime only for deterministic backend work:

- patch collection and validation
- provider receipt validation
- handoff validation
- quality lineage
- acceptance matrix validation
- reconcile/finalize gates

Runtime evidence never replaces Agent judgment.

### 5. Stop Conditions

Stop only when:

- a required native subagent capability is unavailable;
- a task is blocked by missing context, credentials, destructive risk, or invalid plan;
- QA/Review/fix loop cannot close a blocker;
- all tasks and gates have closed.

## Rules

- Agent handoffs must be explicit.
- Runtime-owned evidence is validation, not Agent judgment.
- Fix loops require closed recheck evidence.
- Do not ask the user whether to continue between routine tasks.
- Do not dispatch multiple implementation Agents against overlapping write scopes.
- Do not accept `DONE` from an Agent without checking diff, handoff, and verification evidence.
- Do not move to Archive until QA, Review, Committer, and true harness evidence are closed.
