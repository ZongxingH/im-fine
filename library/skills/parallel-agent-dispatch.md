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
3. Assign agents with explicit inputs, outputs, and boundaries.
4. Record locks.
5. Collect handoffs and release locks.

## Outputs

- Agent assignments.
- Locks and queue updates.
- Parallel execution summary.

## Failure Handling

If boundaries overlap, reduce parallelism or ask Task Planner to replan.

## Prohibited

- Do not dispatch agents without write boundaries.
- Do not ask the user to coordinate agents.
