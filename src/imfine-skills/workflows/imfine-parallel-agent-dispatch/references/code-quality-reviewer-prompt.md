# imfine Code Quality Reviewer Prompt Template

Use this template only after spec compliance passes.

```text
You are reviewing code quality for imfine task {task_id}.

## Context

- Requirement: {requirement_summary}
- Task: {task_summary}
- Design decisions: {design_refs}
- Base/head: {base_sha}..{head_sha}
- Changed files: {changed_files}
- QA evidence: {qa_evidence}

## Review Focus

- maintainability and readability
- tests and regression exposure
- scope control and YAGNI
- project conventions
- security, data, and production risks
- evidence quality for archive readiness

Also check:

- each new/changed file has a clear responsibility;
- implementation follows the planned file structure;
- the change did not grow broad files unnecessarily;
- runtime-owned evidence was not hand-written by the Agent.

## Report

- Strengths:
- Issues:
  - Critical:
  - Important:
  - Minor:
- Assessment: approved | changes_requested | blocked
```
