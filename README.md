# imfine

Project-level autonomous multi-agent harness for Codex and Claude.

Public user surface:

- `/imfine init`
- `/imfine run <requirement text|requirement-file>`
- `/imfine status`

Installation entry:

- `npx github:<owner>/<repo> install [--target codex|claude|all] [--lang zh|en]`

Direct local CLI `install` is not part of the supported user surface.

Runtime notes:

- `init` may call deterministic runtime JS to inspect the current project and materialize `.imfine`.
- `run` always enters the orchestration path. Runtime may materialize state and validate model outputs, but planning, orchestration, implementation, QA, review, and archive decisions are expected to come from the current model session through multi-role multi-agent + skill execution.
- Internal runtime/debug commands still exist in the codebase, but they are not part of the user-facing `/imfine` contract.
- Legacy bridge paths remain debug/testing only and are explicitly marked `legacy_debug`.
- True harness execution is blocked unless the current provider session explicitly declares native subagent support.

Install from GitHub and enable `/imfine` in both Codex and Claude:

```bash
npx github:<owner>/<repo> install
```

`install` defaults to `--target all --lang zh`. Use `--target codex` or `--target claude` to install only one entry. Use `--lang en` to generate English Codex/Claude artifacts.

The design baseline is `IMFINE_PHASED_IMPLEMENTATION_PLAN.md`.
