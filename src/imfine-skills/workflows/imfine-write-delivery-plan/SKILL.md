---
name: imfine-write-delivery-plan
description: Write an imfine delivery plan and task graph for a requirement.
---

# imfine Write Delivery Plan

Use this workflow to transform normalized requirements and project context into a runtime-valid task graph.

## Outputs

- `planning/task-graph.json`
- Agent role plan
- Acceptance coverage plan
- Parallel and serial boundaries

## Rules

- Runtime validates the task graph; the Agent owns planning judgment.
- Include `depends_on`, read scope, write scope, verification, review, and commit plan per task.
- Do not invent safe parallelism when dependencies are uncertain.
