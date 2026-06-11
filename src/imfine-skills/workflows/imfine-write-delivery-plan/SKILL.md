---
name: imfine-write-delivery-plan
description: Write an imfine delivery plan and task graph for a requirement.
---

# imfine Write Delivery Plan

Use this workflow to transform normalized requirements and project context into a runtime-valid task graph.

This workflow absorbs Superpowers `writing-plans` discipline and adapts it to imfine's runtime task graph contract. The plan must be concrete enough that independent native Agents can execute tasks without inheriting the Orchestrator's session history.

## Source Patterns Absorbed

- Superpowers `writing-plans`: file structure first, bite-sized task granularity, no placeholders, exact commands, self-review.
- BMAD story/sprint planning: implementation-ready context, acceptance traceability, sequencing, and handoff-ready artifacts.
- imfine runtime contract: `planning/task-graph.json`, dispatch contracts, handoff schema, provider receipts, final gates.

## Process

### 1. Scope Check

- Confirm whether the request is one deliverable or multiple independent subsystems.
- If multiple subsystems can ship independently, split the plan into separate task groups with explicit dependencies.
- Record assumptions and non-goals before creating tasks.

### 2. File Structure Map

Before defining tasks, map the files and directories that are expected to change:

- Create / modify / test paths must be exact.
- Each planned file must have one clear responsibility.
- In existing projects, follow current patterns unless the task explicitly calls for a change.
- If a file is too large and the task touches it heavily, record whether splitting is required or deliberately out of scope.

### 3. Task Granularity

Each task must be independently understandable and should complete one bounded change:

- Read scope and write scope are explicit globs.
- Verification commands are exact.
- Review expectations are explicit.
- Commit message or commit grouping is proposed.
- Dependencies are concrete, not vague sequencing preferences.

Use serial execution only when there is a real dependency. Otherwise prefer parallel-ready task groups with non-overlapping write scopes.

### 4. No Placeholder Rule

These are plan failures:

- `TBD`, `TODO`, `implement later`, `fill in details`.
- "Add appropriate error handling" without concrete cases.
- "Write tests" without naming test files, scenarios, and command.
- "Similar to Task N" when an Agent may execute the task in isolation.
- References to functions, types, endpoints, or files not introduced by evidence or a prior task.

### 5. Self-Review Before Handoff

Before handing the plan to Orchestrator:

1. Check every requirement against a task or accepted deviation.
2. Search for placeholder language and remove it.
3. Verify task ids, dependency ids, write scopes, and role assignments are internally consistent.
4. Confirm QA, Review, Committer, Archive, and Project Knowledge gates are represented.

## Outputs

- `planning/task-graph.json`
- Agent role plan
- Acceptance coverage plan
- Parallel and serial boundaries
- Per-task context suitable for fresh native subagents
- Exact verification and review commands
- Commit and archive readiness notes

## Rules

- Runtime validates the task graph; the Agent owns planning judgment.
- Include `depends_on`, read scope, write scope, verification, review, and commit plan per task.
- Do not invent safe parallelism when dependencies are uncertain.
- Do not create one broad dev task when independent file/module boundaries exist.
- Do not let runtime generate planning judgment; runtime only validates and materializes.
