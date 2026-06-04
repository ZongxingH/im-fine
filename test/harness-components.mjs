import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HARNESS_COMPONENTS,
  HARNESS_ISSUE_COVERAGE,
  componentIdsForIssue,
  harnessComponentIds,
  harnessComponentManifest,
  validateHarnessComponentIds,
  writeHarnessComponents
} from "../dist/core/harness-components.js";

const root = path.resolve(import.meta.dirname, "..");
const componentIds = harnessComponentIds();

assert.equal(componentIds.size, HARNESS_COMPONENTS.length);
assert.deepEqual(validateHarnessComponentIds(Array.from(componentIds)), []);

for (const component of HARNESS_COMPONENTS) {
  assert.match(component.id, /^[a-z0-9]+(\.[a-z0-9-]+)+$/);
  assert.ok(component.name.trim().length > 0);
  assert.ok(component.source_files.length > 0);
  assert.ok(component.artifacts.length > 0);
  assert.ok(component.failure_modes.length > 0);
  assert.deepEqual(validateHarnessComponentIds(component.depends_on), []);
}

const expectedIssues = Array.from({ length: 16 }, (_, index) => `H-${String(index + 1).padStart(3, "0")}`);
assert.deepEqual(HARNESS_ISSUE_COVERAGE.map((item) => item.issue_id), expectedIssues);
for (const issue of expectedIssues) {
  const mapped = componentIdsForIssue(issue);
  assert.ok(mapped.length > 0, `${issue} has no component mapping`);
  assert.deepEqual(validateHarnessComponentIds(mapped), []);
}

const docs = fs.readFileSync(path.join(root, "docs", "harness-components.md"), "utf8");
for (const component of HARNESS_COMPONENTS) {
  assert.match(docs, new RegExp(component.id.replaceAll(".", "\\.")));
}

const manifest = harnessComponentManifest();
assert.equal(manifest.schema_version, 1);
assert.equal(manifest.components.length, HARNESS_COMPONENTS.length);
assert.equal(manifest.issue_coverage.length, 16);

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-harness-components-"));
const runId = "components";
const runDir = path.join(cwd, ".imfine", "runs", runId);
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ schema_version: 1, run_id: runId, status: "planned" }, null, 2) + "\n");
const file = writeHarnessComponents(cwd, runId);
const written = JSON.parse(fs.readFileSync(file, "utf8"));
assert.equal(written.components.length, HARNESS_COMPONENTS.length);
assert.equal(written.issue_coverage.length, 16);

console.log("harness components ok");
