---
name: imfine-init
description: Initialize an imfine project workspace. Use when the user wants to prepare `.imfine` context and runtime state for a project.
---

# imfine Init Workflow

Initialize the project through an Agent/Skill workflow while preserving the runtime-owned `.imfine` artifact contract.

This workflow absorbs BMAD `document-project` and `generate-project-context` patterns: init is not just directory creation; it must produce project knowledge that future Agents can cite.

## Steps

1. Inspect the project root read-only and classify it as empty or existing.
2. Identify language, framework, entry points, modules, tests, build configuration, and middleware evidence.
3. Run the deterministic backend:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js init
   ```
4. Read `.imfine/project/**` and the init runtime result.
5. For existing projects, dispatch or use Project Analyzer / Architect reasoning to confirm architecture evidence.
6. Generate or refresh project knowledge:
   - overview
   - product shape
   - architecture
   - module map
   - tech stack
   - test strategy
   - infrastructure
   - conventions
   - risks and unknowns
7. Mark limited-evidence or stale areas explicitly for `project-knowledge-freshness`.
8. Report generated project context, architecture evidence, and next recommended imfine entry.

## Required Compatibility

The runtime must continue to create compatible `.imfine` artifacts, including `.imfine/state/current.json`, `.imfine/project/architecture.md`, `.imfine/project/tech-stack.md`, `.imfine/project/module-map.md`, and `.imfine/project/test-strategy.md` when applicable.

Do not hand-write runtime-owned state files when the runtime has a deterministic writer for them.

## Project Knowledge Rules

- Every claim about the existing project should cite a file, config, command, or explicit unknown.
- Do not fill project knowledge with aspirational assumptions.
- If evidence is partial, record that as freshness risk instead of manufacturing certainty.
- Future `imfine-run`, `imfine-status`, `imfine-observe`, and `imfine-archive` must be able to consume the initialized artifacts.
