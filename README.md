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
- `imfine library sync`
- imfine-owned source-level agents, skills, and artifact templates

Phase 3 adds:

- `imfine run <requirement text|requirement-file>`
- delivery run creation from text or requirement files
- project context, requirement analysis, impact analysis, risk analysis, solution design, architecture decisions, and acceptance criteria

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

- `imfine run <requirement text|requirement-file>` full delivery for empty new-project directories
- `imfine run <requirement text|requirement-file> --plan-only` to stop at analysis/planning
- new project delivery with git init, code, tests, docs, local commits, push-blocked evidence, and archive

Orchestrator recovery adds:

- `imfine resume <run-id>`
- state-driven next-action inference, queue persistence, infrastructure gate persistence, agent run registry, parallel plan, and conflict resolver handoff routing

Model agent execution adds:

- `imfine agents prepare <run-id>` to generate agent/skill-backed model execution packages
- `imfine agents execute <run-id> --executor "<command>"` to run ready agents through a configured model executor
- `imfine agents execute <run-id> --dry-run` to validate dispatch without invoking a model

Existing-project automatic orchestration adds:

- `imfine run <requirement text|requirement-file> --auto --executor "<command>"`
- `imfine orchestrate <run-id> --executor "<command>"`
- model-driven agent execution with deterministic runtime progression through worktree preparation, patch collection, QA evidence, Review evidence, commit, push evidence, and archive

New-project automatic orchestration adds:

- `imfine run <requirement text|requirement-file> --auto --executor "<command>"`
- Architect Agent stack decision output at `.imfine/runs/<run-id>/design/stack-decision.json`
- Task Planner Agent task graph output before runtime prepares worktrees
- runtime validation of the model-selected stack decision and task graph before delivery proceeds

Install from GitHub and enable `/imfine` in both Codex and Claude:

```bash
npx github:<owner>/<repo> install
```

`install` defaults to `--target all --lang zh`. Use `--target codex` or `--target claude` to install only one entry. Use `--lang en` to generate English Codex/Claude artifacts.

The design baseline is `IMFINE_PHASED_IMPLEMENTATION_PLAN.md`.
