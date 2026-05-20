# Runtime Boundary

imfine has three layers:

- Method layer: role, workflow, skill, and template knowledge.
- Model orchestration layer: the current provider session Orchestrator and its native subagents.
- Deterministic runtime layer: local state, validation, patch, git, evidence, and archive materialization.

The runtime may:

- create run directories and deterministic artifacts;
- validate task graph structure and engineering semantics;
- materialize dispatch contracts;
- validate handoffs, receipts, evidence files, and final gates;
- collect patches, run git operations, and write archive reports.

The runtime must not:

- infer product shape from requirement keywords;
- decide architecture, task decomposition, QA verdicts, review verdicts, or archive readiness as model judgment;
- launch provider subagents;
- turn runtime-only receipts into true harness proof.

Agent-authored artifacts carry product, architecture, acceptance, QA, review, and archive judgments. Runtime artifacts only verify that those artifacts exist, satisfy schemas, and reference evidence.
