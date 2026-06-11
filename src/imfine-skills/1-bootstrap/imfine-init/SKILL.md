---
name: imfine-init
description: Initialize an imfine project workspace. Use when the user wants to prepare `.imfine` context and runtime state for a project.
---

# imfine Init Workflow

Initialize the project through an Agent/Skill workflow while preserving the runtime-owned `.imfine` artifact contract.

## Steps

1. Inspect the project root read-only and classify it as empty or existing.
2. Identify language, framework, entry points, modules, tests, build configuration, and middleware evidence.
3. Run the deterministic backend:
   ```bash
   node ~/.imfine/runtime/dist/cli/imfine-runtime.js init
   ```
4. Read `.imfine/project/**` and the init runtime result.
5. For existing projects, dispatch or use Project Analyzer / Architect reasoning to confirm architecture evidence.
6. Report generated project context, architecture evidence, and next recommended imfine entry.

## Required Compatibility

The runtime must continue to create compatible `.imfine` artifacts, including `.imfine/state/current.json`, `.imfine/project/architecture.md`, `.imfine/project/tech-stack.md`, `.imfine/project/module-map.md`, and `.imfine/project/test-strategy.md` when applicable.

Do not hand-write runtime-owned state files when the runtime has a deterministic writer for them.
