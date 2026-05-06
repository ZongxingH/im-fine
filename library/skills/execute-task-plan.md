# Skill: execute-task-plan

## Trigger

Use when an agent receives an assigned task with a dev/test/review plan.

## Inputs

- Task plan.
- Read scope.
- Write scope.
- Acceptance criteria.

## Steps

1. Read only the context needed for the task.
2. Make scoped changes.
3. Run assigned verification.
4. Record commands and outputs.
5. Write handoff with changed files and evidence.

## Outputs

- Code or documentation changes.
- Commands evidence.
- Handoff.
- Patch when running in a worktree.

## Failure Handling

If blocked, write a blocked handoff with exact missing input or failing command.

## Prohibited

- Do not expand scope without Orchestrator approval.
- Do not claim verification without command evidence.
