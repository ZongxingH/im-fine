---
name: imfine-brainstorming
description: Explore unclear or open-ended imfine requirements before planning, using Superpowers and BMAD brainstorming patterns.
---

# imfine Brainstorming Workflow

Use this workflow when a request needs discovery before it can safely become a requirement, design, or task graph.

This workflow absorbs:

- Superpowers `brainstorming`: context first, one question at a time, 2-3 approaches, design approval, spec self-review.
- BMAD `bmad-brainstorming`: facilitation stance, technique batches, divergence/convergence, resumable memory, finalize handoff.

## When To Use

Use before implementation planning when:

- the request is a new product, feature, user experience, workflow, or open-ended behavior change;
- success criteria are unclear;
- multiple plausible approaches exist;
- user intent, constraints, or non-goals need exploration;
- a UI/UX surface needs concept alternatives;
- requirement ambiguity could cause expensive rework.

Skip only when the request is already implementation-ready, such as a precise bugfix, approved story, or existing task graph. If skipped, record `brainstorming_skipped_reason`.

## Modes

Choose one mode and keep it for the session:

- `facilitator`: ask prompts and help the user generate ideas; do not supply your own ideas unless asked.
- `creative_partner`: facilitate and contribute ideas with clear authorship.
- `autonomous`: generate options yourself for headless or explicitly delegated exploration.

## Process

### 1. Explore Context

- Read `.imfine/project/**` and relevant source/docs.
- Identify existing product shape, architecture constraints, test strategy, and known risks.
- If the request spans multiple independent subsystems, decompose before ideating details.

### 2. Frame The Session

- Ask what is being explored and why.
- Pick or infer mode.
- Write a lightweight memlog under `.imfine/runs/<run-id>/analysis/brainstorming-memlog.md` when a run exists, otherwise `.imfine/project/brainstorming-memlog.md`.
- Log ideas, decisions, questions, constraints, and user direction.

### 3. Diverge

- Ask one question at a time in interactive modes.
- Use 2-4 technique lenses per batch, such as constraint inversion, user journey, risk-first, simplest useful version, edge-case walk, or competitor contrast.
- Aim for alternatives before convergence; do not jump to the first workable answer.

### 4. Compare Approaches

Present 2-3 candidate approaches with:

- scope
- user value
- technical implications
- risks
- verification strategy
- recommendation

### 5. Converge

When enough ideas exist:

- narrow to the strongest approach;
- record accepted assumptions and rejected options;
- identify non-goals;
- convert ideas into acceptance candidates and design constraints.

### 6. Finalize

Write:

- `.imfine/runs/<run-id>/analysis/brainstorming.md` when a run exists;
- otherwise `.imfine/project/brainstorming.md`.

The final artifact must include:

- topic and goal
- selected mode
- explored approaches
- chosen direction
- assumptions
- non-goals
- acceptance candidates
- unresolved questions
- recommended next skill: `imfine-product-brief`, `imfine-write-delivery-plan`, `imfine-implementation-readiness`, or `imfine-correct-course`

## Hard Gate

Do not proceed to planning or implementation from a brainstorming-required request until the final direction is explicit enough for Product Planner, Architect, or Task Planner.

## Prohibited

- Do not turn a vague idea directly into a task graph.
- Do not ask several unrelated questions in one message.
- Do not hide rejected approaches.
- Do not claim user approval unless it is explicit or the run is headless/autonomous and marked as such.
