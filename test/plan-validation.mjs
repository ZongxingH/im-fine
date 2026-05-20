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

console.log("plan validation ok");
