import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { harnessComponentIds } from "../dist/core/harness-components.js";

const root = path.resolve(import.meta.dirname, "..");
const evolutionDir = path.join(root, "docs", "harness-evolution");
const componentIds = harnessComponentIds();

const records = fs.readdirSync(evolutionDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

assert.ok(records.length > 0, "at least one harness evolution record is required");

for (const file of records) {
  const record = JSON.parse(fs.readFileSync(path.join(evolutionDir, file), "utf8"));
  assert.ok(Array.isArray(record.predicted_outcomes) && record.predicted_outcomes.length > 0, `${file} predicted_outcomes`);
  assert.ok(Array.isArray(record.observed_outcomes) && record.observed_outcomes.length > 0, `${file} observed_outcomes`);
  assert.ok(Array.isArray(record.falsified_predictions), `${file} falsified_predictions`);
  assert.equal(typeof record.rollback_required, "boolean", `${file} rollback_required`);

  const observedByFixture = new Map(record.observed_outcomes.map((item) => [item.fixture, item]));
  for (const prediction of record.predicted_outcomes) {
    assert.equal(typeof prediction.fixture, "string", `${file} prediction.fixture`);
    assert.ok(prediction.fixture.trim().length > 0, `${file} prediction.fixture empty`);
    assert.equal(typeof prediction.before, "string", `${file} prediction.before`);
    assert.equal(typeof prediction.expected_after, "string", `${file} prediction.expected_after`);
    assert.ok(componentIds.has(prediction.component_id), `${file} unknown prediction component ${prediction.component_id}`);
    const observed = observedByFixture.get(prediction.fixture);
    assert.ok(observed, `${file} missing observed outcome for ${prediction.fixture}`);
    assert.equal(typeof observed.actual_after, "string", `${file} observed.actual_after`);
    assert.equal(typeof observed.matched_prediction, "boolean", `${file} observed.matched_prediction`);
    assert.equal(observed.component_id, prediction.component_id, `${file} observed component mismatch for ${prediction.fixture}`);
    assert.equal(observed.matched_prediction, observed.actual_after === prediction.expected_after, `${file} matched_prediction does not match actual outcome for ${prediction.fixture}`);
  }

  if (record.falsified_predictions.length > 0) {
    assert.notEqual(record.status, "verified", `${file} verified record cannot contain falsified predictions`);
    assert.equal(record.rollback_required, true, `${file} falsified record must require rollback`);
  }
}

console.log("harness evolution outcomes ok");
