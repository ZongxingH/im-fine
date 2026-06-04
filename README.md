# imfine

imfine is a project-level autonomous multi-agent harness for Codex and Claude.

It gives a project a single `/imfine` workflow for initialization, requirement delivery, status tracking, evidence collection, QA/review gates, commit/push, and archive reporting. The goal is not to expose a large CLI menu. The user-facing interface is intentionally small, while the deterministic runtime records state and evidence under `.imfine/`.

## What It Is

imfine combines three layers:

- Method layer: absorbs useful ideas from OpenSpec, Superpowers, and BMAD.
- Agent orchestration layer: the current Codex or Claude session acts as Orchestrator and launches independent native subagents.
- Deterministic runtime layer: writes project state, validates contracts, records provider receipts, collects evidence, runs backend actions, and produces archive reports.

The only supported execution mode is `true_harness`. imfine does not silently fall back to a single-agent workflow when native subagents are unavailable.

Runtime/CLI never launches Codex or Claude provider agents. Native subagents are launched only by the current Codex or Claude session Orchestrator, and runtime records the handback with provider-origin receipts, output snapshots, and integrity.

## Requirements

- Node.js 20 or newer.
- Codex and/or Claude installed locally.
- A project directory where imfine can create `.imfine/`.

## Install

Install from GitHub:

```bash
npx github:ZongxingH/im-fine install
```

By default this installs Chinese `/imfine` entries for both Codex and Claude:

- Codex skill: `~/.codex/skills/imfine/SKILL.md`
- Claude command: `~/.claude/commands/imfine.md`
- Runtime: `~/.imfine/runtime`

Install only one target:

```bash
npx github:ZongxingH/im-fine install --target codex
npx github:ZongxingH/im-fine install --target claude
```

Generate English entries:

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
rm -rf ~/.codex/skills/imfine
rm -f ~/.claude/commands/imfine.md
rm -rf ~/.imfine/runtime
```

This only removes the global imfine installation. Existing project workspaces are stored in each project under `.imfine/`; delete a project's `.imfine/` directory only if you no longer need its run evidence, reports, or project knowledge.

## Usage

Use imfine from inside Codex or Claude through the slash command:

```text
/imfine init
/imfine run "<requirement>"
/imfine run <requirement-file>
/imfine status
```

### Initialize A Project

Run this once in a project:

```text
/imfine init
```

imfine inspects the current project, creates `.imfine/`, records project knowledge, and prepares the deterministic runtime workspace. For existing projects it records architecture, tech stack, module map, test strategy, and freshness evidence.

### Run A Delivery

Ask imfine to implement a requirement:

```text
/imfine run "Add password reset email flow with tests"
```

or point it at a requirement file:

```text
/imfine run docs/requirements/password-reset.md
```

The current session acts as Orchestrator. It is responsible for planning, dispatching native subagents, coordinating handoffs, and driving Dev, QA, Review, Committer, Archive, and project-knowledge updates until the run is completed or blocked.

### Check Status

```text
/imfine status
```

Status reads the current `.imfine` workspace and reports the active run, gates, blockers, final consistency, and relevant evidence paths.

## Runtime Evidence And Diagnostics

Every run is evidence-first. In addition to agent handoffs and final reports, imfine now records harness-level diagnostics under each run:

- `orchestration/harness-components.json`: the harness component registry snapshot for the run.
- `orchestration/run-trace.jsonl`: runtime event stream for ingest, evidence writing, gate evaluation, status checks, archive, and finalization.
- `orchestration/gate-trace.jsonl`: gate-specific trace events, including blocked gate reasons.
- `analysis/harness-debug-overview.md`: readable blocked-run diagnosis.
- `analysis/harness-debug-detail.json`: machine-readable debugger claims with artifact or trace references.
- `orchestration/runtime-requirements.json`: declared runtime, observed runtime versions, and QA evidence checks.
- `orchestration/sandbox-verification.json`: local sandbox verification result when sandbox verification is run.

`/imfine status` surfaces recent blocker trace, debugger report paths, sandbox verification status, and the next owner. If QA evidence says a run passed but sandbox verification fails, status reports an environment / verification mismatch instead of treating the run as completed.

## Runtime Boundary

The installed runtime lives at `~/.imfine/runtime`, but runtime commands are backend actions, not the normal user workflow. Public usage should stay on:

- `/imfine init`
- `/imfine run ...`
- `/imfine status`

Internal runtime commands exist for deterministic materialization, validation, provider receipts, evidence collection, commit/push, reconcile, finalize, and archive reporting.

They do not include any `launch`, `spawn`, or `start provider agent` entry. If provider metadata is unavailable, runtime keeps `true_harness_passed=false` and reports the missing receipt evidence.

Default commit policy is recorded in each run:

- `auto_commit_allowed=true`
- `commit_requires_user_approval=false`
- `push_allowed=true`
- `push_requires_remote=true`
- new projects without `HEAD` require an initial baseline commit, or `awaiting_user_approval` if runtime cannot create one.

If a run requires user approval or the user declines commit/push, imfine must not report `completed`; it remains `awaiting_user_approval`, `ready_for_commit`, or `blocked` with evidence.

## Harness Evolution

Harness changes are tracked as verifiable engineering changes:

- Design and evolution source of truth: `docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md`.
- Component registry: `src/core/harness-components.ts`.
- Experiment workspaces: `.imfine/harness-experiments/<experiment-id>/`.
- Config overlays: `configs/harness/base.json` and `configs/harness/experiments/*.json`.

Each non-trivial harness change records affected components, source failures, predicted outcomes, observed outcomes, verification commands, regression risks, `experiment_id`, and `config_id`. The test suite validates the plan and runtime artifacts so harness behavior changes remain tied to fixtures and observed results.

## Project Artifacts

imfine writes run and project evidence under `.imfine/`, including:

- `.imfine/project/**`: project knowledge and capability traces.
- `.imfine/runs/<run-id>/**`: request, analysis, planning, agent handoffs, provider receipts, evidence, gates, traces, debugger reports, sandbox verification, and archive artifacts.
- `.imfine/harness-experiments/<experiment-id>/**`: harness experiment input, patch, verification, and change evaluation.
- `.imfine/reports/<run-id>.md`: final run report.

The design baseline is [IMFINE_PHASED_IMPLEMENTATION_PLAN.md](./docs/IMFINE_PHASED_IMPLEMENTATION_PLAN.md).
