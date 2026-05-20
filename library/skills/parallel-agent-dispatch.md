# Skill: parallel-agent-dispatch

## Trigger

Use when the task graph contains multiple runnable tasks or multiple roles that can proceed independently.

## Inputs

- Task graph.
- Ownership map.
- Agent capacity.
- Current locks and state.

## Steps

1. Select tasks whose dependencies are satisfied.
2. Group tasks by non-overlapping write scopes.
3. Prefer the largest ready batch that preserves boundary safety.
4. Assign agents with explicit inputs, outputs, and boundaries from dispatch contracts.
5. Launch each assigned role as an independent native subagent from the current provider session.
6. Record the provider-origin agent id, session id, task handle, and output path.
7. Collect handoffs, write provider-origin completion receipts, and release locks.

## Outputs

- Agent assignments.
- Locks and queue updates.
- Provider-origin receipt records for completed native subagents.
- Parallel execution summary.

## Failure Handling

If boundaries overlap, do not serialize by default. First isolate the conflicting tasks, then ask Task Planner to replan the minimum conflicting slice.

## Prohibited

- Do not dispatch agents without write boundaries.
- Do not collapse a ready batch into serial execution when write scopes are independent.
- Do not accept a task graph that marks everything serial without explicit dependency evidence.
- Do not ask the user to coordinate agents.
- Do not use runtime-only receipts as proof that a native provider subagent ran.
