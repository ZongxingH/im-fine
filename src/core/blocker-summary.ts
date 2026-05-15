import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

interface SummarySource {
  id: string;
  file: string;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function collectErrors(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const errors = object.errors;
  if (Array.isArray(errors)) return errors.map(String);
  if (object.blocked === true && typeof object.blocked_reason === "string") return [object.blocked_reason];
  const blockers = object.blockers;
  if (Array.isArray(blockers)) {
    return blockers.map((item) => {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return String(record.reason || record.type || JSON.stringify(record));
      }
      return String(item);
    });
  }
  const checks = object.checks;
  if (Array.isArray(checks)) {
    return checks
      .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).status !== "pass")
      .map((item) => {
        const record = item as Record<string, unknown>;
        return `${String(record.id || "check")}: ${String(record.detail || record.status || "blocked")}`;
      });
  }
  return [];
}

export function writeBlockerSummary(cwd: string, runId: string): string {
  const root = runDir(cwd, runId);
  const orchestration = path.join(root, "orchestration");
  const sources: SummarySource[] = [
    { id: "state-blockers", file: path.join(orchestration, "state-blockers.json") },
    { id: "provider-capability", file: path.join(orchestration, "provider-capability.json") },
    { id: "session-validation", file: path.join(orchestration, "session-validation.json") },
    { id: "handoff-validation", file: path.join(orchestration, "handoff-validation.json") },
    { id: "final-gates", file: path.join(orchestration, "final-gates.json") }
  ];
  const summaries = sources
    .filter((source) => fs.existsSync(source.file))
    .map((source) => ({
      id: source.id,
      file: rel(cwd, source.file),
      blockers: collectErrors(readJson(source.file))
    }));
  const file = path.join(orchestration, "blocker-summary.json");
  ensureDir(path.dirname(file));
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    status: summaries.some((summary) => summary.blockers.length > 0) ? "blocked" : "clear",
    sources: summaries
  }, null, 2)}\n`);
  return file;
}
