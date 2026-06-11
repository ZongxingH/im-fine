---
name: imfine-product-brief
description: Create a concise product brief for imfine requirements using BMAD product brief and PM patterns.
---

# imfine Product Brief Workflow

Use this workflow after brainstorming or intake when the run needs a product-facing requirement brief before architecture and task planning.

This workflow absorbs BMAD `bmad-product-brief`, `bmad-create-prd`, and PM Agent patterns while keeping imfine's artifact contract.

## Inputs

- Original request.
- Brainstorming artifact when present.
- `.imfine/project/product.md` and project context.
- Known constraints, assumptions, non-goals, and risks.

## Process

1. Identify user, job-to-be-done, and desired outcome.
2. Separate required scope from optional scope.
3. Define observable acceptance candidates.
4. Record non-goals.
5. Identify business, UX, technical, and verification constraints.
6. Mark unresolved questions as blockers only if they materially affect implementation.

## Outputs

- `.imfine/runs/<run-id>/analysis/product-brief.md` when a run exists.
- `.imfine/project/product-brief.md` when run context does not exist.
- Product Planner handoff fields for acceptance matrix authoring.

## Product Brief Structure

- Problem / opportunity
- Target user or actor
- User value
- Required capabilities
- Non-goals
- Acceptance candidates
- Constraints
- Open questions
- Recommended next owner

## Prohibited

- Do not expand scope to make the product brief more impressive.
- Do not turn technical implementation details into product requirements unless they affect acceptance.
- Do not proceed to implementation readiness with unowned material ambiguity.
