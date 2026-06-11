import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { harnessComponentIds } from "../dist/core/harness-components.js";

const root = path.resolve(import.meta.dirname, "..");
const plan = fs.readFileSync(path.join(root, "docs", "IMFINE_IMPLEMENTATION.md"), "utf8");
const componentIds = harnessComponentIds();

for (const issueId of Array.from({ length: 16 }, (_, index) => `H-${String(index + 1).padStart(3, "0")}`)) {
  assert.match(plan, new RegExp(`\\b${issueId}\\b`), `plan missing ${issueId}`);
}

for (const component of componentIds) {
  assert.match(plan, new RegExp(component.replaceAll(".", "\\.")), `plan missing component ${component}`);
}

for (const required of [
  "record_id",
  "experiment_id",
  "config_id",
  "source_failures",
  "affected_components",
  "predicted_outcomes",
  "observed_outcomes",
  "falsified_predictions",
  "rollback_required"
]) {
  assert.match(plan, new RegExp(`\\b${required}\\b`), `plan missing evolution field ${required}`);
}

assert.match(plan, /若 `falsified_predictions` 非空，record 不能是 `verified`/);
assert.match(plan, /每条 prediction 必须有对应 observed outcome/);

console.log("harness evolution ok");
