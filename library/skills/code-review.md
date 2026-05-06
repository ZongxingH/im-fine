# Skill: code-review

## Trigger

Use after QA evidence is available or when reviewing a risky patch.

## Inputs

- Requirement and design.
- Task graph.
- Diff or patch.
- QA evidence.

## Steps

1. Check acceptance coverage.
2. Check write scope compliance.
3. Check unrelated changes.
4. Check security, compatibility, performance, and maintainability risks.
5. Check test sufficiency.
6. Emit findings ordered by severity.

## Outputs

- Approved or changes requested decision.
- Findings with file and line references where possible.

## Failure Handling

If evidence is missing, request changes or mark blocked.

## Prohibited

- Do not approve without QA evidence.
- Do not rewrite the patch while reviewing.
