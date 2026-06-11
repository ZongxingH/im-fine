---
name: imfine-run
description: Run the full imfine multi-agent delivery workflow for a requirement.
---

# imfine Run Workflow

Execute a full imfine delivery run using native provider Agents and deterministic runtime evidence gates.

## Steps

1. Normalize the requirement text or requirement file path from the user request.
2. Ask runtime to create and materialize the run context:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js run <requirement>
   ```
3. Read `.imfine/runs/<run-id>/orchestration/orchestrator-input.md`.
4. As Orchestrator, write `orchestration/orchestrator-session.json` with true-harness execution intent, `next_actions`, `agent_runs`, dependencies, and parallel groups.
5. Launch native subagents for required roles when the provider supports them.
6. Between Agent handoffs, call runtime only for deterministic materialization, validation, receipts, gates, archive, commit, and push.
7. Stop only when the run is completed, blocked, or awaiting explicit user approval.

## Rules

- Do not silently downgrade to a single-Agent workflow.
- Do not ask the user which Agent should run next.
- Do not mark completed until runtime final gates and true-harness evidence close.
