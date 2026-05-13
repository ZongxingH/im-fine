# Skill: write-delivery-plan

## Trigger

Use after requirement analysis and design are available.

## Inputs

- Requirement analysis.
- Solution design.
- Project context.

## Steps

1. Identify the smallest independently deliverable implementation units.
2. Assign read and write scopes before deciding task count.
3. Split units with non-overlapping `write_scope` into separate tasks by default.
4. Add dependencies only when one task truly produces an input required by another.
5. Define verification and review plans per task.
6. Decide task-level or integration commit mode without collapsing safe parallelism.
7. Emit a task graph that runtime can validate.

## Outputs

- `task-graph.json`.
- `ownership.json`.
- `execution-plan.md`.
- Per-task plan files.

## Failure Handling

If boundaries are unclear, stop and record the missing dependency or missing ownership fact. Do not silently emit one broad serial task.

## Prohibited

- Do not create overlapping parallel write scopes.
- Do not use `strategy=serial` without a concrete dependency reason.
- Do not hide multiple business sub-capabilities inside one generic dev task when file boundaries allow separation.
- Do not omit verification.
