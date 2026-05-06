# Skill: write-delivery-plan

## Trigger

Use after requirement analysis and design are available.

## Inputs

- Requirement analysis.
- Solution design.
- Project context.

## Steps

1. Identify implementation units.
2. Assign read and write scopes.
3. Define dependencies.
4. Define verification and review plans.
5. Decide task-level or integration commit mode.
6. Emit a task graph that runtime can validate.

## Outputs

- `task-graph.json`.
- `ownership.json`.
- `execution-plan.md`.
- Per-task plan files.

## Failure Handling

If boundaries are unclear, reduce parallelism and record why.

## Prohibited

- Do not create overlapping parallel write scopes.
- Do not omit verification.
