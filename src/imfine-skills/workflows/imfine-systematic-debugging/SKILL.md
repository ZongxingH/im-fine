---
name: imfine-systematic-debugging
description: Apply imfine systematic debugging when tests, build, lint, review, merge, or runtime checks fail.
---

# imfine Systematic Debugging Workflow

Use this workflow when tests, build, lint, review, merge, or runtime checks fail.

This workflow absorbs Superpowers `systematic-debugging`: reproduce, classify, hypothesize, fix minimally, verify. It also feeds imfine quality lineage so fix loops can be audited.

## Inputs

- Failure output.
- Reproduction command.
- Recent changes.
- Relevant task and acceptance criteria.

## Debugging Discipline

1. Do not patch before reproducing or validating the failure.
2. Classify the failure: test bug, product bug, environment issue, flaky timing, merge conflict, missing dependency, or runtime evidence failure.
3. Form one focused hypothesis at a time.
4. Inspect evidence that can falsify the hypothesis.
5. Apply the smallest fix.
6. Re-run the failing command and the nearest affected checks.
7. Record root cause, targeted fix, and verification in handoff evidence.

## imfine Evidence Requirements

- Link the fix to the original blocker id when present.
- Record before/after command output.
- Update quality lineage for recheck closure.
- If not reproducible, record environment facts and keep the blocker open or classify as infrastructure blocked.

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
- Do not close a QA/Review blocker without recheck evidence.
- Do not convert an environment failure into success without sandbox/runtime evidence.
