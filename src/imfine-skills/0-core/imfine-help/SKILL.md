---
name: imfine-help
description: Use when the user asks what imfine can do or which imfine workflow to run next.
---

# imfine Help

Use this skill to route users through the imfine BMAD-style harness.

## Public Entries

- `imfine-agent-orchestrator` - activate the main Orchestrator Agent and menu.
- `imfine-init` - initialize `.imfine` project context and runtime workspace.
- `imfine-run` - run the full multi-agent delivery workflow.
- `imfine-status` - inspect current run status, blockers, gates, and evidence.
- `imfine-observe` - audit demo quality and true-harness observability.
- `imfine-archive` - confirm final gates and archive the run.

## Runtime Boundary

Use `node ~/.imfine/runtime/dist/cli/imfine-runtime.js` only for deterministic backend actions. Do not present runtime commands as the primary user workflow.
