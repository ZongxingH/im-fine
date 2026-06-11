# Step 01: Architecture Context

Goal: establish the evidence base before making architecture decisions.

Actions:

1. Read normalized requirement and acceptance candidates.
2. Read `.imfine/project/project-context.md`, `architecture.md`, `module-map.md`, `tech-stack.md`, and `test-strategy.md` when present.
3. Inspect source/config files cited by Project Analyzer.
4. Classify the work as new surface, brownfield extension, refactor, integration, data change, frontend/backend contract change, or harness/runtime change.
5. Record unknowns that materially affect architecture.

Output:

- Context summary with file references.
- Architecture problem classification.
- Evidence-backed unknowns.

Stop if the requirement or project evidence is too thin to make architecture decisions safely.
