import assert from "node:assert/strict";
import { validateTaskGraph } from "../dist/core/plan.js";

const graph = {
  run_id: "overlap-test",
  strategy: "parallel",
  tasks: [
    {
      id: "T1",
      title: "A",
      type: "dev",
      depends_on: [],
      read_scope: ["src/**"],
      write_scope: ["src/**"],
      acceptance: ["done"],
      dev_plan: ["dev"],
      test_plan: ["test"],
      review_plan: ["review"],
      verification: ["test"],
      commit: { mode: "task", message: "feat: a" }
    },
    {
      id: "T2",
      title: "B",
      type: "dev",
      depends_on: [],
      read_scope: ["src/**"],
      write_scope: ["src/components/**"],
      acceptance: ["done"],
      dev_plan: ["dev"],
      test_plan: ["test"],
      review_plan: ["review"],
      verification: ["test"],
      commit: { mode: "task", message: "feat: b" }
    }
  ]
};

const result = validateTaskGraph(graph);
assert.equal(result.passed, false);
assert.ok(result.errors.some((error) => error.includes("overlapping write_scope")));
assert.ok(result.replanRecommended);

const semantic = validateTaskGraph({
  run_id: "semantic-test",
  strategy: "parallel",
  tasks: [{
    id: "T1",
    title: "Too broad",
    type: "dev",
    depends_on: [],
    read_scope: ["src/**"],
    write_scope: ["src/**"],
    acceptance: ["done"],
    dev_plan: ["dev"],
    test_plan: ["test"],
    review_plan: ["review"],
    verification: ["unknown verify"],
    commit: { mode: "task", message: "feat: semantic" }
  }]
});
assert.equal(semantic.passed, true);
assert.ok(semantic.warnings.some((warning) => warning.includes("broad write_scope")));
assert.ok(semantic.warnings.some((warning) => warning.includes("unverifiable acceptance")));
assert.ok(semantic.replanRecommended);

const inconsistentEdges = validateTaskGraph({
  run_id: "edge-mismatch-test",
  strategy: "serial",
  edges: [],
  tasks: [
    {
      id: "T1",
      title: "A",
      type: "dev",
      depends_on: [],
      read_scope: ["src/a"],
      write_scope: ["src/a"],
      acceptance: ["implemented with evidence"],
      dev_plan: ["change src/a"],
      test_plan: ["node test/a.mjs"],
      review_plan: ["review src/a"],
      verification: ["node test/a.mjs"],
      commit: { mode: "task", message: "feat: a" }
    },
    {
      id: "T2",
      title: "B",
      type: "qa",
      depends_on: ["T1"],
      read_scope: ["src/a"],
      write_scope: ["test/a"],
      acceptance: ["verified with evidence"],
      dev_plan: ["prepare verification"],
      test_plan: ["node test/a.mjs"],
      review_plan: ["review verification"],
      verification: ["node test/a.mjs"],
      commit: { mode: "task", message: "test: a" }
    }
  ]
});
assert.equal(inconsistentEdges.passed, false);
assert.ok(inconsistentEdges.errors.some((error) => error.includes("missing from task graph edges")));

const consistentEdges = validateTaskGraph({
  run_id: "edge-consistent-test",
  strategy: "serial",
  edges: [{ from: "T1", to: "T2" }],
  tasks: [
    {
      id: "T1",
      title: "A",
      type: "dev",
      depends_on: [],
      read_scope: ["src/a"],
      write_scope: ["src/a"],
      acceptance: ["implemented with evidence"],
      dev_plan: ["change src/a"],
      test_plan: ["node test/a.mjs"],
      review_plan: ["review src/a"],
      verification: ["node test/a.mjs"],
      commit: { mode: "task", message: "feat: a" }
    },
    {
      id: "T2",
      title: "B",
      type: "qa",
      depends_on: ["T1"],
      read_scope: ["src/a"],
      write_scope: ["test/a"],
      acceptance: ["verified with evidence"],
      dev_plan: ["prepare verification"],
      test_plan: ["node test/a.mjs"],
      review_plan: ["review verification"],
      verification: ["node test/a.mjs"],
      commit: { mode: "task", message: "test: a" }
    }
  ]
});
assert.equal(consistentEdges.passed, true);

console.log("plan validation ok");
