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

Codex discovers imfine from the shared `~/.agents/skills/imfine-*` entries. Claude discovers imfine from command pointer files that load the same shared skills. imfine no longer installs a single `~/.codex/skills/imfine/SKILL.md` or `~/.claude/commands/imfine.md` behavior source.

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

After installing, restart the Codex or Claude session so the newly installed entries are discovered.

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

The installer exposes the full BMAD-style imfine roster, not only the shortcut entries. The current package contains 17 Agent entries and 22 Skill entries:

- Agents: `imfine-agent-orchestrator`, `imfine-agent-intake`, `imfine-agent-project-analyzer`, `imfine-agent-product-planner`, `imfine-agent-architect`, `imfine-agent-task-planner`, `imfine-agent-dev`, `imfine-agent-qa`, `imfine-agent-reviewer`, `imfine-agent-risk-reviewer`, `imfine-agent-merge-agent`, `imfine-agent-committer`, `imfine-agent-archive`, `imfine-agent-technical-writer`, `imfine-agent-project-knowledge-updater`, `imfine-agent-harness-auditor`, `imfine-agent-ux-designer`.
- Primary/helper skills: `imfine-help`, `imfine-init`, `imfine-run`, `imfine-status`, `imfine-observe`, `imfine-archive`.
- Workflow skills: `imfine-brainstorming`, `imfine-product-brief`, `imfine-validate-requirement`, `imfine-implementation-readiness`, `imfine-correct-course`, `imfine-retrospective`, `imfine-clarify`, `imfine-project-analysis`, `imfine-write-delivery-plan`, `imfine-execute-task-plan`, `imfine-tdd`, `imfine-systematic-debugging`, `imfine-parallel-agent-dispatch`, `imfine-code-review`, `imfine-archive-confirmation`, `imfine-harness-audit`.

## Demo Validation

To validate imfine itself on a demo project, install imfine, restart Codex or Claude, then run these entries from inside the demo project:

```text
imfine-agent-orchestrator
imfine-init
imfine-run "Build a small todo demo with add, complete, delete, and local persistence."
imfine-status
imfine-observe
```

The expected behavior is not that runtime completes everything by itself. A credible demo shows:

- `imfine-run` creates the run context and waits for Orchestrator/Agent output when `orchestrator-session.json` is missing.
- The current Codex or Claude session acts as Orchestrator and writes `orchestration/orchestrator-session.json`.
- Native provider Agents perform role-specific work when the provider supports subagents.
- Runtime records provider-origin receipts, handoff evidence, gates, commits, archive reports, and true-harness evidence.
- `imfine-observe` audits the run and returns `pass`, `pass_with_risks`, `blocked`, or `misleading_demo` with artifact references.

If native subagent capability or provider-origin receipts are unavailable, the demo should be reported as blocked or single-session skill fallback, not as a passing true harness.

## Runtime Evidence And Diagnostics

Every run is evidence-first. In addition to agent handoffs and final reports, imfine records harness-level diagnostics under each run:

- `orchestration/provider-capability.json`
- `orchestration/provider-capability-resolution.json`
- `orchestration/provider-receipts/`
- `orchestration/provider-outputs/`
- `orchestration/provider-observations/`
- `orchestration/harness-components.json`
- `orchestration/run-trace.jsonl`
- `orchestration/gate-trace.jsonl`
- `orchestration/agent-runs.json`
- `orchestration/parallel-plan.json`
- `orchestration/parallel-execution.json`
- `orchestration/final-gates.json`
- `analysis/harness-debug-overview.md`
- `analysis/harness-debug-detail.json`
- `orchestration/runtime-requirements.json`
- `orchestration/sandbox-verification.json`
- `archive/final-report.md`

`imfine-status` surfaces recent blocker trace, debugger report paths, sandbox verification status, and the next owner. If QA evidence says a run passed but sandbox verification fails, status reports an environment or verification mismatch instead of treating the run as completed.

`imfine-observe` loads `imfine-agent-harness-auditor` and `imfine-harness-audit` to inspect an existing run's observability. It reports whether the demo is `pass`, `pass_with_risks`, `blocked`, or `misleading_demo`, citing run artifacts instead of relying on natural-language claims.

## Runtime Boundary

The installed runtime lives at `~/.imfine/runtime`, but runtime commands are backend actions, not the normal user workflow. Public usage should stay on the installed Agent/Skill entries.

Internal runtime commands exist for deterministic materialization, validation, provider receipts, evidence collection, commit/push, reconcile, finalize, and archive reporting.

They do not include any `launch`, `spawn`, or `start provider agent` entry. If provider metadata is unavailable, runtime keeps `true_harness_passed=false` and reports the missing receipt evidence.

`imfine-run` does not include an auto-orchestrator or a plan-only branch. It creates a run, materializes request/analysis/orchestration context, returns the current Orchestrator snapshot, and then expects the current Codex or Claude session to drive Agent/Skill execution.

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
- `.imfine/runs/<run-id>/**`: request, analysis, orchestration, planning, dispatch contracts, agent handoffs, provider receipts, provider output snapshots, evidence, gates, traces, debugger reports, sandbox verification, and archive artifacts.
- `.imfine/harness-experiments/<experiment-id>/**`: harness experiment input, patch, verification, and change evaluation.
- `.imfine/reports/<run-id>.md`: final run report.

The current implementation contract is [IMFINE_IMPLEMENTATION.md](./docs/IMFINE_IMPLEMENTATION.md). The BMAD migration rationale is kept in [IMFINE_BMAD_MIGRATION_PLAN.md](./docs/IMFINE_BMAD_MIGRATION_PLAN.md).
