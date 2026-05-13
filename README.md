# imfine

Project-level autonomous multi-agent harness for Codex and Claude.

Phase 1 provides:

- `npx github:<owner>/<repo> install [--target codex|claude|all] [--lang zh|en]`
- `imfine init`
- `imfine doctor`
- internal `imfine-runtime` aliases

Phase 2 adds:

- `imfine agents list|show <id>`
- `imfine skills list|show <id>`
- `imfine templates list|show <id>`
- `imfine workflows list|show <id>`
- `imfine library sync` for an explicit debug snapshot only
- imfine-owned source-level agents, skills, and artifact templates

Phase 3 adds:

- `imfine run <requirement text|requirement-file>`
- delivery run creation from text or requirement files
- runtime context, evidence, state, and pending-role materialization for delivery runs

Phase 4 adds:

- `imfine plan <run-id>`
- `imfine plan validate <run-id>`
- `imfine task graph validate <run-id>`
- task graph, ownership map, execution plan, commit plan, and per-task dev/test/review plans

Phase 5 adds:

- `imfine worktree prepare <run-id>`
- `imfine patch collect <run-id> <task-id>`
- `imfine patch validate <run-id> <task-id>`
- run branch creation, task worktree preparation, patch collection, and write-scope validation

Phase 6 adds:

- `imfine verify <run-id> <task-id> [--status pass|fail|blocked]`
- `imfine review <run-id> <task-id> --status approved|changes_requested|blocked`
- `imfine rework design <run-id> <task-id>`
- QA evidence capture, reviewer decision recording, repeated fix-task creation, and design rework routing

Phase 7 adds:

- `imfine commit task <run-id> <task-id>`
- `imfine commit run <run-id> [--mode task|integration]`
- `imfine commit resolved <run-id> [task-id...]`
- `imfine push <run-id>`
- task/integration commits on `imfine/<run-id>`, push to `origin imfine/<run-id>`, and commit/push evidence capture

Phase 8 adds:

- `imfine archive <run-id>`
- Archive Agent evidence confirmation, run archive reports, user reports, and `.imfine/project` knowledge updates

Phase 9 adds:

- `imfine run <requirement text|requirement-file>` materializes runtime context for empty new-project directories and waits for Architect and Task Planner model work
- empty-directory new-project runs stop at `waiting_for_model`
- runtime does not generate a default project scaffold, task graph, or verification stack for new projects

Orchestrator recovery adds:

- `imfine resume <run-id>`
- state-driven next-action inference, queue persistence, infrastructure gate persistence, agent run registry, parallel plan, and conflict resolver handoff routing

Model agent execution adds:

- `imfine agents prepare <run-id>` as a legacy bridge for generating agent/skill-backed model execution packages
- the target harness path is still the current Codex or Claude `/imfine` session acting as Orchestrator over runtime state and contracts
- `imfine agents execute <run-id> --executor "<command>"` remains an internal/testing bridge for non-interactive runners
- all bridge artifacts are debug-only and explicitly marked `legacy_debug`; they must not be used to claim true harness execution

Existing-project automatic orchestration adds:

- `/imfine run <requirement text|requirement-file>` inside Codex or Claude
- runtime progression through worktree preparation, patch collection, QA evidence, Review evidence, commit, push evidence, and archive while the current model session performs Agent judgment/work

New-project automatic orchestration adds:

- `/imfine run <requirement text|requirement-file>` inside Codex or Claude for empty project directories
- Architect Agent stack decision output at `.imfine/runs/<run-id>/design/stack-decision.json`
- Task Planner Agent task graph output before runtime prepares worktrees
- runtime waits for model-selected stack and task-graph outputs before delivery proceeds

Install from GitHub and enable `/imfine` in both Codex and Claude:

```bash
npx github:<owner>/<repo> install
```

`install` defaults to `--target all --lang zh`. Use `--target codex` or `--target claude` to install only one entry. Use `--lang en` to generate English Codex/Claude artifacts.

The design baseline is `IMFINE_PHASED_IMPLEMENTATION_PLAN.md`.
