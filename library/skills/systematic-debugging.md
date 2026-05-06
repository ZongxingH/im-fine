# Skill: systematic-debugging

## Trigger

Use when tests, build, lint, review, merge, or runtime checks fail.

## Inputs

- Failure output.
- Reproduction command.
- Recent changes.
- Relevant task and acceptance criteria.

## Steps

1. Reproduce or validate the failure.
2. Classify the failure.
3. Form a focused hypothesis.
4. Inspect evidence.
5. Apply a minimal fix.
6. Rerun the failing command and affected checks.

## Outputs

- Root cause note.
- Fix patch.
- Verification evidence.

## Failure Handling

If not reproducible, record environment facts and classify as flaky or infrastructure blocked.

## Prohibited

- Do not make broad speculative changes.
- Do not suppress failures without understanding them.
