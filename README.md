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
- `run` always enters the orchestration path. The current session's `orchestrator agent` is expected to launch independent native subagents directly.
- Runtime only materializes state, contracts, execution artifacts, and evidence from an explicit `orchestrator agent` decision file.
- The only execution mode is `true_harness`.
- Planning artifacts and execution artifacts are separate runtime products.
- Internal runtime commands still exist in the codebase, but they are deterministic backend actions, not part of the user-facing `/imfine` contract.

Install from GitHub and enable `/imfine` in both Codex and Claude:

```bash
npx github:<owner>/<repo> install
```

`install` defaults to `--target all --lang zh`. Use `--target codex` or `--target claude` to install only one entry. Use `--lang en` to generate English Codex/Claude artifacts.

The design baseline is `IMFINE_PHASED_IMPLEMENTATION_PLAN.md`.
