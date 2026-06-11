---
name: imfine-status
description: Inspect imfine run status, gates, blockers, and next actions.
---

# imfine Status Workflow

Show current imfine status without mutating delivery artifacts.

## Steps

1. Resolve the target run from user input or `.imfine/state/current.json`.
2. Collect summary status:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js status --story
   ```
3. Use debug status only when the user needs artifact-level diagnosis:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js status --debug
   ```
4. Explain current run state, blockers, gate status, Agent-authored evidence, runtime-derived evidence, and next owner.

## Rules

- Status is read-only.
- Keep Agent-authored and runtime-derived evidence visually distinct.
- Do not hide blocked gates behind a success summary.
