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

console.log("plan validation ok");
