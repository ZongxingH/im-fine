---
name: imfine-code-review
description: Review imfine task or run changes for quality, scope, and regression risks.
---

# imfine Code Review

Use this workflow to review code changes against requirements, task graph, architecture, and QA evidence.

This workflow absorbs Superpowers `requesting-code-review` and `receiving-code-review`: review early, review with precise context, and treat feedback as technical evidence to verify rather than social performance.

## When To Review

Mandatory:

- After each task implementation before merge/commit readiness.
- After major feature completion.
- Before archive/finalize.
- After non-trivial fix-loop remediation.

Optional but useful:

- When stuck and a fresh perspective is needed.
- Before broad refactors.
- After complex bug fixes.

## Reviewer Context

The Reviewer must receive curated context, not the Orchestrator's whole session history:

- requirement and normalized acceptance
- task graph and task id
- design or architecture decisions
- changed files or patch
- QA evidence and commands
- base/head commit ids when available
- known deviations or accepted risks

## Output

- `evidence/review.md`
- Reviewer handoff
- Severity-classified findings

## Finding Policy

- Critical: blocks progression immediately.
- High/Important: must be fixed or explicitly accepted before proceeding.
- Medium/Low: may be deferred only with owner and rationale.
- Every finding must cite a file, line, artifact, or missing evidence path.

## Receiving Review Feedback

When feedback arrives:

1. Read the complete feedback before acting.
2. Restate unclear technical requirements or ask for clarification.
3. Verify each suggestion against current codebase reality.
4. Push back with evidence when a suggestion is wrong, violates YAGNI, or conflicts with accepted architecture.
5. Implement one item at a time and verify each fix.
6. Re-run affected QA/Review gates before closing the blocker.

## Rules

- Findings must include file or artifact references.
- Important and critical issues block progression.
- Approved means requirements and evidence are both satisfactory.
- Do not skip review because the change looks simple.
- Do not proceed with unfixed Important/Critical findings.
- Do not use performative agreement as a substitute for technical verification.
- Do not let passing tests override acceptance, scope, or architecture violations.
