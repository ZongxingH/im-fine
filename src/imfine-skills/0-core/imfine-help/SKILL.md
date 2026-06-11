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

## Agent Entries

- `imfine-agent-orchestrator`
- `imfine-agent-intake`
- `imfine-agent-project-analyzer`
- `imfine-agent-product-planner`
- `imfine-agent-architect`
- `imfine-agent-task-planner`
- `imfine-agent-dev`
- `imfine-agent-qa`
- `imfine-agent-reviewer`
- `imfine-agent-risk-reviewer`
- `imfine-agent-merge-agent`
- `imfine-agent-committer`
- `imfine-agent-archive`
- `imfine-agent-technical-writer`
- `imfine-agent-project-knowledge-updater`
- `imfine-agent-harness-auditor`
- `imfine-agent-ux-designer`

## Workflow Entries

- `imfine-brainstorming`
- `imfine-product-brief`
- `imfine-validate-requirement`
- `imfine-implementation-readiness`
- `imfine-correct-course`
- `imfine-retrospective`
- `imfine-clarify`
- `imfine-project-analysis`
- `imfine-write-delivery-plan`
- `imfine-execute-task-plan`
- `imfine-tdd`
- `imfine-systematic-debugging`
- `imfine-parallel-agent-dispatch`
- `imfine-code-review`
- `imfine-archive-confirmation`
- `imfine-harness-audit`

## Runtime Boundary

Use `node ~/.imfine/runtime/dist/cli/imfine-runtime.js` only for deterministic backend actions. Do not present runtime commands as the primary user workflow.
