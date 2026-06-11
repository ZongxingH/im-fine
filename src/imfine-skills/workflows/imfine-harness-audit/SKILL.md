---
name: imfine-harness-audit
description: Audit imfine true-harness evidence, demo quality, and observability for a run.
---

# imfine Harness Audit

Use this workflow to evaluate imfine demo quality, true-harness credibility, and observability.

## Required Evidence To Inspect

- `orchestration/orchestrator-session.json`
- `orchestration/session-validation.json`
- `orchestration/dispatch-contracts.json`
- `orchestration/agent-runs.json`
- `orchestration/parallel-execution.json`
- `orchestration/provider-receipts/`
- `orchestration/true-harness-evidence.json`
- `orchestration/final-gates.json`
- `orchestration/runtime-requirements.json`
- `orchestration/quality-lineage.json`
- `analysis/harness-debug-overview.md`
- `analysis/harness-debug-detail.json`
- `archive/final-report.md`
- `evidence/test-results.md`
- `evidence/review.md`
- `agents/*/handoff.json`

## Verdict Rules

- Treat `true_harness_passed=true` as necessary but not sufficient for `pass`; it must be fresh, runtime generated, and supported by provider-origin receipts.
- `pass`: true-harness evidence is fresh and passed, final gates are runtime generated and pass, provider-origin receipts close required contracts, and QA/Review evidence is present.
- `pass_with_risks`: demo is understandable and mostly closed, but has documented non-blocking gaps.
- `blocked`: required evidence is missing, stale, or failed, and the demo exposes the blocker.
- `misleading_demo`: visible demo claims completion while required evidence is missing, forged, stale, or contradicted by gates.

## Issue Notes

For each issue record failure evidence, root cause, targeted fix, predicted impact, and regression risk.
