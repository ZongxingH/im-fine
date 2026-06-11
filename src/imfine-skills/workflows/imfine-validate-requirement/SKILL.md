---
name: imfine-validate-requirement
description: Validate imfine requirements or product briefs before architecture and task planning.
---

# imfine Validate Requirement Workflow

Use this workflow before architecture or task planning when a requirement, product brief, PRD-like artifact, or brainstorming result needs validation.

This workflow absorbs BMAD `bmad-validate-prd` and adapts it to imfine acceptance matrix and true-harness evidence needs.

## Checks

- Purpose and user value are explicit.
- Required capabilities are distinguishable from optional ideas.
- Non-goals are present.
- Acceptance candidates are observable.
- Constraints are stated with evidence or marked as assumptions.
- Ambiguity is either safe, accepted, or blocking.
- Verification strategy is plausible.
- Runtime/harness requirements are not contradicted.

## Outputs

- Requirement validation summary under `.imfine/runs/<run-id>/analysis/requirement-validation.md`.
- Structured blockers for Intake/Product Planner/Orchestrator if validation fails.
- Recommended next step: brainstorming, product brief, architecture, task planning, or blocked.

## Prohibited

- Do not silently fix product meaning while validating.
- Do not approve requirements that cannot drive acceptance matrix authoring.
- Do not confuse implementation details with acceptance unless user-visible or operationally required.
