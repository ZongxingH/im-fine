import fs from "node:fs";

export interface FinalGateValidation {
  passed: boolean;
  errors: string[];
  gates: Record<string, string>;
}

const REQUIRED_FINAL_GATES = [
  "planning",
  "dispatch",
  "qa",
  "review",
  "recheck_fix_loop",
  "runtime_requirements",
  "committer",
  "push",
  "archive",
  "true_harness",
  "role_purity",
  "project_knowledge"
];

export function validateRuntimeFinalGates(file: string): FinalGateValidation {
  if (!fs.existsSync(file)) {
    return { passed: false, errors: [`missing final gates: ${file}`], gates: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { passed: false, errors: [`final gates is not valid JSON: ${file}`], gates: {} };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { passed: false, errors: ["final gates must be a JSON object"], gates: {} };
  }
  const record = parsed as Record<string, unknown>;
  const gates = typeof record.gates === "object" && record.gates !== null && !Array.isArray(record.gates)
    ? Object.fromEntries(Object.entries(record.gates as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
    : {};
  const errors: string[] = [];
  if (record.generated_by !== "imfine-runtime") errors.push("final gates must be generated_by imfine-runtime");
  for (const gate of REQUIRED_FINAL_GATES) {
    if (gates[gate] !== "pass") errors.push(`final gate ${gate} is ${gates[gate] || "missing"}`);
  }
  return { passed: errors.length === 0, errors, gates };
}
