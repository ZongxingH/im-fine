# Skill: tdd

## Trigger

Use when adding or changing behavior with testable acceptance criteria.

## Inputs

- Acceptance criteria.
- Existing test strategy.
- Relevant source files.

## Steps

1. Identify the smallest meaningful failing test or scenario.
2. Add or update the test.
3. Run it to confirm failure when practical.
4. Implement the behavior.
5. Run targeted and affected tests.
6. For frontend/backend contract changes, add at least a fetch-level contract test or browser smoke test that exercises the real backend routes.

## Outputs

- Test changes.
- Implementation changes.
- Test command evidence.

## Failure Handling

If a failing-first run is impractical, record why and still add regression coverage when possible.

## Prohibited

- Do not skip tests because the implementation seems simple.
- Do not use syntax checks as the only proof for user-facing frontend flows.
- Do not weaken existing tests.
