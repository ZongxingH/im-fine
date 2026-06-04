import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHarnessExperiment, finalizeHarnessExperiment, recordHarnessExperimentPatch } from "../dist/core/harness-experiments.js";

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-harness-experiment-home-"));

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, HOME: tempHome } });
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "imfine-harness-experiment-"));
git(["init"], cwd);
git(["config", "user.email", "imfine@example.test"], cwd);
git(["config", "user.name", "imfine test"], cwd);
fs.writeFileSync(path.join(cwd, "README.md"), "# Experiment\n");
git(["add", "."], cwd);
git(["commit", "-m", "feat: baseline"], cwd);

const created = createHarnessExperiment(cwd, ["H-016"]);
assert.ok(created.experimentId.startsWith("exp-"));
assert.ok(fs.existsSync(path.join(created.dir, "input", "baseline-commit.txt")));
assert.ok(fs.existsSync(path.join(created.dir, "input", "source-failures.json")));
assert.ok(fs.existsSync(path.join(created.dir, "input", "replay-fixtures.json")));
assert.ok(fs.existsSync(path.join(created.dir, "evolve", "changed-components.json")));
assert.ok(fs.existsSync(path.join(created.dir, "evolve", "patch.diff")));

const components = JSON.parse(fs.readFileSync(path.join(created.dir, "evolve", "changed-components.json"), "utf8"));
assert.ok(components.component_ids.includes("runtime.harness-evolution"));
assert.ok(components.component_ids.includes("runtime.harness-experiments"));

fs.appendFileSync(path.join(cwd, "README.md"), "\nchanged\n");
fs.writeFileSync(path.join(cwd, "NEW_FILE.md"), "# New\n");
const patch = recordHarnessExperimentPatch(cwd, created.experimentId);
assert.ok(fs.existsSync(path.join(created.dir, "evolve", "patch.diff")));
assert.ok(patch.files.includes(path.join(created.dir, "evolve", "changed-files.json")));
const changed = JSON.parse(fs.readFileSync(path.join(created.dir, "evolve", "changed-files.json"), "utf8"));
assert.ok(changed.files.includes("README.md"));
assert.ok(changed.files.includes("NEW_FILE.md"));
assert.match(fs.readFileSync(path.join(created.dir, "evolve", "patch.diff"), "utf8"), /NEW_FILE.md/);

const finished = finalizeHarnessExperiment(cwd, created.experimentId, {
  commands: ["npm test"],
  status: "pass",
  output: "harness experiment ok"
});
assert.ok(finished.files.includes(path.join(created.dir, "result", "verification.json")));
assert.ok(finished.files.includes(path.join(created.dir, "result", "change-evaluation.json")));
const evaluation = JSON.parse(fs.readFileSync(path.join(created.dir, "result", "change-evaluation.json"), "utf8"));
assert.equal(evaluation.verification_status, "pass");
assert.ok(evaluation.changed_files.includes("README.md"));
assert.ok(evaluation.changed_components.includes("runtime.harness-experiments"));

console.log("harness experiments ok");
