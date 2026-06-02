import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

export interface ProviderObservationInput {
  observedAgentNames?: string[];
  observedClosedCount?: number;
  screenshotPath?: string;
  userNote?: string;
  timestamp?: string;
}

export interface ProviderObservationRecord {
  file: string;
  observed_agent_names: string[];
  observed_closed_count: number | null;
  screenshot_path: string | null;
  user_note: string | null;
  timestamp: string | null;
}

function runDir(cwd: string, runId: string): string {
  return path.join(cwd, ".imfine", "runs", runId);
}

function rel(cwd: string, file: string): string {
  return path.isAbsolute(file) ? path.relative(cwd, file) : file;
}

function optionalJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "provider-observation";
}

export function providerObservationDir(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "orchestration", "provider-observations");
}

export function writeProviderObservation(cwd: string, runId: string, id: string, input: ProviderObservationInput): string {
  const dir = providerObservationDir(cwd, runId);
  ensureDir(dir);
  const file = path.join(dir, `${safeFilePart(id)}.json`);
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    timestamp: input.timestamp || new Date().toISOString(),
    observed_agent_names: input.observedAgentNames || [],
    observed_closed_count: typeof input.observedClosedCount === "number" ? input.observedClosedCount : null,
    screenshot_path: input.screenshotPath || null,
    user_note: input.userNote || null,
    proof_boundary: "diagnostic_only_not_true_harness_proof"
  }, null, 2)}\n`);
  return file;
}

export function providerObservationFiles(runDirPath: string): string[] {
  const dir = path.join(runDirPath, "orchestration", "provider-observations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(dir, file));
}

export function providerObservations(cwd: string, runDirPath: string): ProviderObservationRecord[] {
  return providerObservationFiles(runDirPath).map((file) => {
    const parsed = optionalJson<{
      observed_agent_names?: unknown[];
      agent_names?: unknown[];
      observed_closed_count?: unknown;
      closed_count?: unknown;
      screenshot_path?: unknown;
      screenshot?: unknown;
      user_note?: unknown;
      note?: unknown;
      timestamp?: unknown;
      observed_at?: unknown;
    }>(file) || {};
    const names = stringArray(parsed.observed_agent_names).length > 0
      ? stringArray(parsed.observed_agent_names)
      : stringArray(parsed.agent_names);
    const count = typeof parsed.observed_closed_count === "number"
      ? parsed.observed_closed_count
      : typeof parsed.closed_count === "number"
        ? parsed.closed_count
        : null;
    return {
      file: rel(cwd, file),
      observed_agent_names: names,
      observed_closed_count: count,
      screenshot_path: typeof parsed.screenshot_path === "string" ? parsed.screenshot_path : typeof parsed.screenshot === "string" ? parsed.screenshot : null,
      user_note: typeof parsed.user_note === "string" ? parsed.user_note : typeof parsed.note === "string" ? parsed.note : null,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : typeof parsed.observed_at === "string" ? parsed.observed_at : null
    };
  });
}
