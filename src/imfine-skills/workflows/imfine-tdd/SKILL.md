---
name: imfine-tdd
description: Apply imfine TDD workflow when adding or changing behavior with testable acceptance criteria.
---

# imfine TDD Workflow

Use this workflow when adding or changing behavior with testable acceptance criteria.

This workflow absorbs Superpowers `test-driven-development` and binds it to imfine Dev/QA handoff evidence.

## Iron Law

No production behavior change without a failing test first, unless the task is explicitly classified as a documented exception.

Exceptions require Orchestrator-visible rationale:

- throwaway prototype
- generated code
- configuration-only change
- test infeasible because of missing environment, with alternate verification specified

## Inputs

- Acceptance criteria.
- Existing test strategy.
- Relevant source files.

## Red-Green-Refactor

### RED

- Write one minimal test showing the behavior or regression.
- Test real behavior, not only mocks, unless external integration makes mocks unavoidable.
- Run the exact test command and confirm the failure is expected.

### GREEN

- Write the smallest implementation that makes the test pass.
- Do not add options, abstractions, or unrelated cleanup beyond the test.
- Run targeted tests and affected checks.

### REFACTOR

- Only refactor after green.
- Keep tests green after every refactor.
- Do not add new behavior during refactor.

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
- Do not write implementation first and then keep it as a reference.
- Do not change tests to fit an incorrect implementation.
- Do not report completion until QA evidence confirms the command output.
