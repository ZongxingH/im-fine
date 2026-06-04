import assert from "node:assert/strict";
import path from "node:path";
import { harnessComponentIds } from "../dist/core/harness-components.js";
import { listHarnessConfigIds, loadHarnessConfig } from "../dist/core/harness-config.js";

const root = path.resolve(import.meta.dirname, "..");

const base = loadHarnessConfig(root);
assert.equal(base.config_id, "base");
assert.equal(base.trace.enabled, true);
assert.equal(base.trace.include_artifact_hash, false);
assert.ok(base.enabled_gates.includes("runtime_requirements"));
assert.deepEqual(base.verification.commands, ["npm test"]);

const strict = loadHarnessConfig(root, "strict-runtime-requirements");
assert.equal(strict.config_id, "strict-runtime-requirements");
assert.equal(strict.trace.enabled, true);
assert.equal(strict.trace.include_artifact_hash, true);
assert.ok(strict.enabled_gates.includes("runtime_requirements"));
assert.ok(!strict.enabled_gates.includes("provider_receipts"));
assert.ok(strict.verification.commands.includes("node test/reconcile.mjs"));

const provider = loadHarnessConfig(root, "provider-receipt-debug");
assert.equal(provider.config_id, "provider-receipt-debug");
assert.equal(provider.trace.include_artifact_hash, true);
assert.ok(provider.enabled_gates.includes("provider_receipts"));
assert.ok(provider.verification.commands.includes("node test/runtime-trace.mjs"));

const ids = listHarnessConfigIds(root);
assert.deepEqual(ids, ["base", "provider-receipt-debug", "strict-runtime-requirements"]);
assert.ok(harnessComponentIds().has("runtime.harness-config"));

console.log("harness config ok");
