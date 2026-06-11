# Step 03: Implementation Boundaries

Goal: create boundaries that Task Planner can turn into safe parallel work.

Define:

- read scopes
- write scopes
- shared files that require serialization
- generated files or runtime-owned files
- test files and verification commands
- handoff evidence paths

Rules:

- Non-overlapping write scopes should enable parallel execution.
- Shared schema, shared config, migrations, and global routing often force serial dependencies.
- Runtime-owned `.imfine` state must be updated through runtime, not hand-written by implementation Agents.

Output:

- Boundary table suitable for task graph creation.
- Serial dependency notes with evidence.
