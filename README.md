# imfine

imfine is a project-level autonomous multi-agent harness for Codex and Claude.

It installs BMAD-style native Agent/Skill entries while keeping a deterministic Node runtime for project state, evidence, provider receipts, gates, reports, and archive materialization. The user works through installed Agent/Skill entries; the runtime records and validates what happened under `.imfine/`.

## What It Is

imfine combines three layers:

- Method layer: absorbs useful ideas from OpenSpec, Superpowers, AHE, and BMAD.
- Agent/Skill layer: Codex or Claude loads imfine native skills and coordinates role-specific Agent work.
- Deterministic runtime layer: writes project state, validates contracts, records provider receipts, collects evidence, runs backend actions, and produces archive reports.

The only supported execution mode is `true_harness`. imfine does not silently fall back to a single-agent workflow when native subagents are unavailable.

Runtime/CLI never launches Codex or Claude provider agents. Native subagents are launched only by the current Codex or Claude session, and runtime records the handback with provider-origin receipts, output snapshots, and integrity checks.

## Requirements

- Node.js 20 or newer.
- Codex and/or Claude installed locally.
- A project directory where imfine can create `.imfine/`.

## Install

Install from GitHub:

```bash
npx github:ZongxingH/im-fine install
```

By default this installs Chinese imfine entries for both Codex and Claude:

- Shared native skills: `~/.agents/skills/imfine-*`
- Claude command pointers: `~/.claude/commands/imfine-*.md`
- Runtime: `~/.imfine/runtime`

Codex discovers imfine from the shared `~/.agents/skills/imfine-*` entries. imfine no longer installs a single `~/.codex/skills/imfine/SKILL.md` behavior source.

Install only one target:

```bash
npx github:ZongxingH/im-fine install --target codex
npx github:ZongxingH/im-fine install --target claude
```

Generate English Claude command pointers:

```bash
npx github:ZongxingH/im-fine install --target all --lang en
```

Preview files without writing:

```bash
npx github:ZongxingH/im-fine install --dry-run
```

Direct local `imfine install ...` is not part of the supported user surface. Use the `npx github:ZongxingH/im-fine install ...` entry.

## Uninstall

There is no dedicated uninstall command yet. Remove the installed entry files and runtime directory:

```bash
rm -rf ~/.agents/skills/imfine-*
rm -f ~/.claude/commands/imfine-*.md
rm -rf ~/.imfine/runtime
```

This only removes the global imfine installation. Existing project workspaces are stored in each project under `.imfine/`; delete a project's `.imfine/` directory only if you no longer need its run evidence, reports, or project knowledge.

## Usage

Use imfine from inside Codex or Claude through the installed entries:

```text
imfine-agent-orchestrator
imfine-init
imfine-run
imfine-status
imfine-observe
imfine-archive
```

`imfine-agent-orchestrator` is the main coordination entry. It routes initialization, delivery, status, observation, and archive requests to the narrower workflow skills.

## Runtime Evidence And Diagnostics

Every run is evidence-first. In addition to agent handoffs and final reports, imfine records harness-level diagnostics under each run:

- `orchestration/harness-components.json`
- `orchestration/run-trace.jsonl`
- `orchestration/gate-trace.jsonl`
- `analysis/harness-debug-overview.md`
- `analysis/harness-debug-detail.json`
- `orchestration/runtime-requirements.json`
- `orchestration/sandbox-verification.json`

`imfine-status` surfaces recent blocker trace, debugger report paths, sandbox verification status, and the next owner. If QA evidence says a run passed but sandbox verification fails, status reports an environment or verification mismatch instead of treating the run as completed.

`imfine-observe` loads `imfine-agent-harness-auditor` and `imfine-harness-audit` to inspect an existing run's observability. It reports whether the demo is `pass`, `pass_with_risks`, `blocked`, or `misleading_demo`, citing run artifacts instead of relying on natural-language claims.

## Runtime Boundary

The installed runtime lives at `~/.imfine/runtime`, but runtime commands are backend actions, not the normal user workflow. Public usage should stay on the installed Agent/Skill entries.

Internal runtime commands exist for deterministic materialization, validation, provider receipts, evidence collection, commit/push, reconcile, finalize, and archive reporting.

They do not include any `launch`, `spawn`, or `start provider agent` entry. If provider metadata is unavailable, runtime keeps `true_harness_passed=false` and reports the missing receipt evidence.

Default commit policy is recorded in each run:

- `auto_commit_allowed=true`
- `commit_requires_user_approval=false`
- `push_allowed=true`
- `push_requires_remote=true`
- new projects without `HEAD` require an initial baseline commit, or `awaiting_user_approval` if runtime cannot create one.

If a run requires user approval or the user declines commit/push, imfine must not report `completed`; it remains `awaiting_user_approval`, `ready_for_commit`, or `blocked` with evidence.

## Project Artifacts

imfine writes run and project evidence under `.imfine/`, including:

- `.imfine/project/**`: project knowledge and capability traces.
- `.imfine/runs/<run-id>/**`: request, analysis, planning, agent handoffs, provider receipts, evidence, gates, traces, debugger reports, sandbox verification, and archive artifacts.
- `.imfine/harness-experiments/<experiment-id>/**`: harness experiment input, patch, verification, and change evaluation.
- `.imfine/reports/<run-id>.md`: final run report.

The migration baseline is [IMFINE_BMAD_MIGRATION_PLAN.md](./docs/IMFINE_BMAD_MIGRATION_PLAN.md).
