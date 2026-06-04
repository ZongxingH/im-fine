import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const plan = fs.readFileSync(path.join(root, "docs", "IMFINE_PHASED_IMPLEMENTATION_PLAN.md"), "utf8");

const sectionStart = plan.indexOf("### 18.5 Harness Evolution Records");
assert.ok(sectionStart >= 0, "missing harness evolution section");
const sectionEnd = plan.indexOf("### 18.6", sectionStart);
const section = plan.slice(sectionStart, sectionEnd);

for (const phrase of [
  "`predicted_outcomes` 必须绑定 fixture 和 component id",
  "每条 prediction 必须有对应 observed outcome",
  "若 `falsified_predictions` 非空，record 不能是 `verified`",
  "必须 `rollback_required=true`"
]) {
  assert.match(section, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

console.log("harness evolution outcomes ok");
