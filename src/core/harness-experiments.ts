import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { componentIdsForIssue } from "./harness-components.js";
import { runCommand } from "./shell.js";

export interface HarnessExperimentVerification {
  commands: string[];
  status: "pass" | "blocked" | "fail";
  output: string;
}

export interface HarnessExperimentResult {
  experimentId: string;
  dir: string;
  files: string[];
}

function workspace(cwd: string): string {
  return path.join(cwd, ".imfine", "harness-experiments");
}

function experimentDir(cwd: string, experimentId: string): string {
  return path.join(workspace(cwd), experimentId);
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "experiment";
}

function git(cwd: string, args: string[]): string {
  const result = runCommand("git", args, cwd);
  return result.code === 0 ? result.stdout.trim() : result.stderr.trim() || result.error || "unavailable";
}

function gitOutput(cwd: string, args: string[]): string {
  const result = runCommand("git", args, cwd);
  return result.stdout.trim() || result.stderr.trim() || result.error || "";
}

function timestampId(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function createHarnessExperiment(cwd: string, issueIds: string[]): HarnessExperimentResult {
  const normalizedIssues = Array.from(new Set(issueIds.map((item) => item.trim()).filter(Boolean))).sort();
  if (normalizedIssues.length === 0) throw new Error("Harness experiment requires at least one issue id");
  const experimentId = safeId(`exp-${timestampId()}-${normalizedIssues.join("-")}`);
  const dir = experimentDir(cwd, experimentId);
  const inputDir = path.join(dir, "input");
  const evolveDir = path.join(dir, "evolve");
  const resultDir = path.join(dir, "result");
  ensureDir(inputDir);
  ensureDir(evolveDir);
  ensureDir(resultDir);
  const baseline = git(cwd, ["rev-parse", "HEAD"]);
  const components = Array.from(new Set(normalizedIssues.flatMap((issueId) => componentIdsForIssue(issueId)))).sort();
  const files = [
    path.join(inputDir, "baseline-commit.txt"),
    path.join(inputDir, "source-failures.json"),
    path.join(inputDir, "replay-fixtures.json"),
    path.join(evolveDir, "changed-components.json"),
    path.join(evolveDir, "patch.diff"),
    path.join(dir, "experiment.json")
  ];
  writeText(files[0], `${baseline}\n`);
  writeText(files[1], `${JSON.stringify({
    schema_version: 1,
    experiment_id: experimentId,
    issue_ids: normalizedIssues
  }, null, 2)}\n`);
  writeText(files[2], `${JSON.stringify({
    schema_version: 1,
    experiment_id: experimentId,
    fixtures: normalizedIssues.map((issueId) => ({
      issue_id: issueId,
      replay_coverage_source: "test/replay-coverage.mjs"
    }))
  }, null, 2)}\n`);
  writeText(files[3], `${JSON.stringify({
    schema_version: 1,
    experiment_id: experimentId,
    component_ids: components
  }, null, 2)}\n`);
  writeText(files[4], "");
  writeText(files[5], `${JSON.stringify({
    schema_version: 1,
    experiment_id: experimentId,
    created_at: new Date().toISOString(),
    baseline_commit: baseline,
    issue_ids: normalizedIssues,
    component_ids: components,
    phases: ["input", "evolve", "result"]
  }, null, 2)}\n`);
  return { experimentId, dir, files };
}

export function recordHarnessExperimentPatch(cwd: string, experimentId: string): HarnessExperimentResult {
  const dir = experimentDir(cwd, experimentId);
  if (!fs.existsSync(dir)) throw new Error(`Harness experiment not found: ${experimentId}`);
  const evolveDir = path.join(dir, "evolve");
  ensureDir(evolveDir);
  const patch = path.join(evolveDir, "patch.diff");
  const changedFiles = path.join(evolveDir, "changed-files.json");
  const diff = git(cwd, ["diff", "--", "."]);
  const diffNames = git(cwd, ["diff", "--name-only", "--", "."])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const statusEntries = git(cwd, ["status", "--short"])
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => ({
      status: line.slice(0, 2),
      file: line.length > 3 ? line.slice(3).trim() : line.trim()
    }))
    .filter((entry) => entry.file !== ".imfine" && !entry.file.startsWith(".imfine/"));
  const untrackedFiles = statusEntries
    .filter((entry) => entry.status === "??")
    .map((entry) => entry.file)
    .filter((file) => file !== ".imfine" && !file.startsWith(".imfine/"));
  const untrackedPatch = untrackedFiles
    .map((file) => gitOutput(cwd, ["diff", "--no-index", "--", "/dev/null", file]))
    .filter(Boolean)
    .join("\n");
  const files = Array.from(new Set([
    ...diffNames,
    ...statusEntries.map((entry) => entry.file),
    ...untrackedFiles
  ])).filter((file) => file !== ".imfine" && !file.startsWith(".imfine/"));
  writeText(patch, [diff, untrackedPatch].filter(Boolean).join("\n"));
  writeText(changedFiles, `${JSON.stringify({
    schema_version: 1,
    experiment_id: experimentId,
    recorded_at: new Date().toISOString(),
    files
  }, null, 2)}\n`);
  return { experimentId, dir, files: [patch, changedFiles] };
}

export function finalizeHarnessExperiment(cwd: string, experimentId: string, verification: HarnessExperimentVerification): HarnessExperimentResult {
  const dir = experimentDir(cwd, experimentId);
  if (!fs.existsSync(dir)) throw new Error(`Harness experiment not found: ${experimentId}`);
  const resultDir = path.join(dir, "result");
  ensureDir(resultDir);
  const verificationFile = path.join(resultDir, "verification.json");
  const evaluationFile = path.join(resultDir, "change-evaluation.json");
  const changedFilesFile = path.join(dir, "evolve", "changed-files.json");
  const changedComponentsFile = path.join(dir, "evolve", "changed-components.json");
  const changedFiles = fs.existsSync(changedFilesFile) ? readJson<{ files?: string[] }>(changedFilesFile).files || [] : [];
  const changedComponents = fs.existsSync(changedComponentsFile) ? readJson<{ component_ids?: string[] }>(changedComponentsFile).component_ids || [] : [];
  writeText(verificationFile, `${JSON.stringify({
    schema_version: 1,
    experiment_id: experimentId,
    recorded_at: new Date().toISOString(),
    commands: verification.commands,
    status: verification.status,
    output: verification.output
  }, null, 2)}\n`);
  writeText(evaluationFile, `${JSON.stringify({
    schema_version: 1,
    experiment_id: experimentId,
    generated_at: new Date().toISOString(),
    verification_status: verification.status,
    changed_files: changedFiles,
    changed_components: changedComponents,
    comparable_result_key: `${verification.status}:${verification.commands.join(" && ")}`
  }, null, 2)}\n`);
  return { experimentId, dir, files: [verificationFile, evaluationFile] };
}
