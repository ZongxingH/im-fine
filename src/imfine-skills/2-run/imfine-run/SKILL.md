---
name: imfine-run
description: Run the full imfine multi-agent delivery workflow for a requirement.
---

# imfine Run Workflow

Execute a full imfine delivery run using native provider Agents and deterministic runtime evidence gates.

This workflow now includes a discovery and readiness lane. It borrows Superpowers brainstorming and BMAD product/planning gates, but keeps imfine's true-harness runtime evidence as the execution authority.

Internal Agent and Workflow definitions are not public Codex/Claude entries. Load them from `~/.imfine/runtime/src/imfine-skills/` when needed.

## Steps

1. Normalize the requirement text or requirement file path from the user request.
2. Decide whether discovery is required:
   - load internal workflow `workflows/imfine-brainstorming/SKILL.md` for open-ended product, UX, workflow, or unclear success criteria;
   - load internal workflow `workflows/imfine-product-brief/SKILL.md` when product scope or acceptance needs structure;
   - load internal workflow `workflows/imfine-validate-requirement/SKILL.md` before architecture or task graph when ambiguity remains;
   - record `brainstorming_skipped_reason` when skipping discovery.
3. Ask runtime to create and materialize the run context:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js run <requirement>
   ```
4. Read `.imfine/runs/<run-id>/orchestration/orchestrator-input.md`.
5. Run or request Product Planner / Architect / Task Planner outputs as needed.
6. Run internal workflow `workflows/imfine-implementation-readiness/SKILL.md` before dispatching Dev Agents.
7. As Orchestrator, write `orchestration/orchestrator-session.json` with true-harness execution intent, `next_actions`, `agent_runs`, dependencies, and parallel groups.
8. Launch native subagents for required roles when the provider supports them.
9. Between Agent handoffs, call runtime only for deterministic materialization, validation, receipts, gates, archive, commit, and push.
10. If material assumptions change, run internal workflow `workflows/imfine-correct-course/SKILL.md` and re-run readiness before resuming.
11. Stop only when the run is completed, blocked, or awaiting explicit user approval.

## Rules

- Do not silently downgrade to a single-Agent workflow.
- Do not ask the user which Agent should run next.
- Do not mark completed until runtime final gates and true-harness evidence close.
- Do not turn vague brainstorming output directly into Dev dispatch.
- Do not continue with stale task graph after a material course correction.
