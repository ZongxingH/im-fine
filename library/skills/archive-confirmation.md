# Skill: archive-confirmation

## Trigger

Use after review passes or when `/imfine archive <run-id>` resumes a partial archive.

## Inputs

- Run artifacts.
- QA and review evidence.
- Commit and push evidence or blocked records.
- Project knowledge files.

## Steps

1. Confirm required artifacts exist.
2. Summarize what changed.
3. Record verification and review evidence.
4. Record commit and push status.
5. Update project knowledge.
6. Write archive report.

## Outputs

- Archive report.
- User report.
- Project knowledge updates.

## Failure Handling

If evidence is missing, mark archive blocked and list recovery steps.

## Prohibited

- Do not hide blocked push or infrastructure states.
- Do not update project knowledge with unverified claims.
