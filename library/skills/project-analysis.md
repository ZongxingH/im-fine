# Skill: project-analysis

## Trigger

Use during init or the first run in a project, and after archive when long-term project knowledge may need updates.

## Inputs

- Repository files.
- Package/config files.
- Existing docs.
- `.imfine/project/**`.

## Steps

1. Detect project type and package manager.
2. Identify modules, entry points, test locations, and build commands.
3. Record evidence for each conclusion.
4. Mark unsupported or unclear conclusions as unknown.
5. Update project knowledge files conservatively.

## Outputs

- `.imfine/project/overview.md`.
- `.imfine/project/tech-stack.md`.
- `.imfine/project/module-map.md`.
- `.imfine/project/test-strategy.md`.
- `.imfine/project/infrastructure.md`.

## Failure Handling

If evidence is insufficient, keep the field unknown and continue.

## Prohibited

- Do not infer architecture without file evidence.
- Do not rewrite unrelated project docs.
