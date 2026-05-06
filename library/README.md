# imfine Agent / Skill / Template Library

This library is imfine-owned source-level material. It is not a runtime dependency on BMAD, Superpowers, or OpenSpec.

## Source-Level Absorption

imfine adapts selected ideas into its own artifacts:

- BMAD: role separation, orchestrator/master responsibility, architect/dev/QA/review style responsibilities, project context, implementation readiness, and staged delivery thinking.
- Superpowers: clarification, planning, execution discipline, TDD, systematic debugging, subagent dispatch with review, and evidence-based completion.
- OpenSpec: proposal/design/tasks/spec-delta style artifacts, capability knowledge organization, structured acceptance, and archive-to-current-facts thinking.

## Library Layout

- `agents/`: role contracts used by `/imfine` and future orchestration.
- `skills/`: reusable engineering discipline used by agents.
- `templates/`: schemas and artifact templates copied into project `.imfine/templates`.

## Phase 2 Boundary

Phase 2 makes the library installable, syncable, and readable by Codex and Claude through `/imfine` runtime commands. It does not yet execute real multi-agent delivery runs.
