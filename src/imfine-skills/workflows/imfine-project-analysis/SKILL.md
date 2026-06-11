---
name: imfine-project-analysis
description: Analyze project context for imfine planning and architecture evidence.
---

# imfine Project Analysis

Use this workflow to inspect the current project and produce project context, architecture signals, module map, technology stack, and test strategy evidence for imfine runs.

## Outputs

- `.imfine/project/project-context.md`
- `.imfine/project/architecture.md`
- `.imfine/project/tech-stack.md`
- `.imfine/project/module-map.md`
- `.imfine/project/test-strategy.md`

## Rules

- Cite concrete files for every claim.
- Prefer existing project evidence over assumptions.
- Use runtime only to persist deterministic state.
