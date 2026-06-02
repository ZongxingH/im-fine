import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const evolutionDir = path.join(root, "docs", "harness-evolution");
const backlog = fs.readFileSync(path.join(root, "docs", "HARNESS_ISSUE_BACKLOG.md"), "utf8");

assert.ok(fs.existsSync(evolutionDir), "missing docs/harness-evolution");

const records = fs.readdirSync(evolutionDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

assert.ok(records.length > 0, "at least one harness evolution record is required");

for (const file of records) {
  const recordPath = path.join(evolutionDir, file);
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  assert.equal(record.schema_version, 1, `${file} schema_version`);
  assert.equal(typeof record.record_id, "string", `${file} record_id`);
  assert.ok(record.record_id.length > 0, `${file} record_id empty`);
  assert.ok(["planned", "verified", "failed", "superseded"].includes(record.status), `${file} invalid status`);
  assert.ok(Array.isArray(record.source_failures) && record.source_failures.length > 0, `${file} source_failures`);
  assert.ok(Array.isArray(record.affected_components) && record.affected_components.length > 0, `${file} affected_components`);
  assert.ok(Array.isArray(record.predicted_impact) && record.predicted_impact.length > 0, `${file} predicted_impact`);
  assert.ok(record.verification && Array.isArray(record.verification.commands) && record.verification.commands.length > 0, `${file} verification.commands`);
  assert.equal(typeof record.verification.observed_result, "string", `${file} observed_result`);
  assert.ok(record.verification.observed_result.trim().length > 0, `${file} observed_result empty`);
  assert.ok(Array.isArray(record.regression_risks) && record.regression_risks.length > 0, `${file} regression_risks`);

  for (const failure of record.source_failures) {
    assert.match(failure.issue_id, /^H-\d{3}$/);
    assert.match(backlog, new RegExp(`### ${failure.issue_id}\\b`));
    assert.equal(typeof failure.summary, "string");
    assert.ok(failure.summary.trim().length > 0);
  }

  for (const component of record.affected_components) {
    assert.equal(typeof component, "string");
    assert.ok(component.trim().length > 0);
  }
}

console.log("harness evolution ok");
