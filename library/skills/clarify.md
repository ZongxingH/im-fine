# Skill: clarify

## Trigger

Use when the requirement has ambiguity, missing constraints, unclear acceptance, or possible high-risk interpretations.

## Inputs

- Original request.
- Project context.
- Known risks and non-goals.

## Steps

1. Restate the requirement in concrete terms.
2. Identify assumptions that can be safely made.
3. Identify ambiguities that create high cost or irreversible decisions.
4. Convert safe assumptions into recorded notes.
5. Escalate only true blockers.

## Outputs

- Normalized requirement.
- Assumptions.
- Ambiguities.
- Acceptance candidates.

## Failure Handling

If ambiguity blocks safe progress, mark the run `blocked` or `needs_requirement_reanalysis`.

## Prohibited

- Do not ask the user about details that can be safely inferred and recorded.
- Do not invent business facts.
