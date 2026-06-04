import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { evaluateRuntimeRequirements } from "./runtime-requirements.js";
import { runCommand } from "./shell.js";

export interface SandboxCommandResult {
  command: string;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface SandboxVerificationResult {
  schema_version: 1;
  run_id: string;
  generated_at: string;
  status: "pass" | "blocked";
  sandbox_dir: string;
  adapter: "local";
  runtime_versions: SandboxCommandResult[];
  install_commands: SandboxCommandResult[];
  test_commands: SandboxCommandResult[];
}

export interface SandboxVerificationOptions {
  installCommands?: string[];
  testCommands?: string[];
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function copyProject(sourceRoot: string, targetRoot: string, runId: string, current = sourceRoot): void {
  ensureDir(targetRoot);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const source = path.join(current, entry.name);
    const relative = path.relative(sourceRoot, source);
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
    if (relative === path.join(".imfine", "harness-experiments")) continue;
    if (relative === path.join(".imfine", "runs")) {
      const runSource = path.join(source, runId);
      if (fs.existsSync(runSource)) copyProject(sourceRoot, targetRoot, runId, runSource);
      continue;
    }
    const target = path.join(targetRoot, path.relative(sourceRoot, source));
    if (entry.isDirectory()) copyProject(sourceRoot, targetRoot, runId, source);
    else if (entry.isFile()) {
      ensureDir(path.dirname(target));
      fs.copyFileSync(source, target);
    }
  }
}

function commandParts(command: string): [string, string[]] {
  const parts = command.trim().split(/\s+/);
  return [parts[0], parts.slice(1)];
}

function execute(command: string, cwd: string): SandboxCommandResult {
  const [program, args] = commandParts(command);
  const result = runCommand(program, args, cwd, 120_000);
  return {
    command,
    exit_code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error
  };
}

function defaultTestCommands(cwd: string): string[] {
  const packageFile = path.join(cwd, "package.json");
  if (!fs.existsSync(packageFile)) return [];
  const parsed = readJson<{ scripts?: { test?: unknown } }>(packageFile);
  return typeof parsed.scripts?.test === "string" ? ["npm test"] : [];
}

function runtimeVersionCommands(cwd: string, runId: string): string[] {
  const requirements = evaluateRuntimeRequirements(cwd, runId);
  return requirements.observed_runtime_versions.map((item) => item.command);
}

export function sandboxVerificationFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "orchestration", "sandbox-verification.json");
}

export function readSandboxVerification(cwd: string, runId: string): SandboxVerificationResult | null {
  const file = sandboxVerificationFile(cwd, runId);
  if (!fs.existsSync(file)) return null;
  return readJson<SandboxVerificationResult>(file);
}

export function runSandboxVerification(cwd: string, runId: string, options: SandboxVerificationOptions = {}): SandboxVerificationResult {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), `imfine-sandbox-${runId}-`));
  copyProject(cwd, sandboxDir, runId);
  const runtimeVersions = runtimeVersionCommands(cwd, runId).map((command) => execute(command, sandboxDir));
  const installCommands = (options.installCommands || []).map((command) => execute(command, sandboxDir));
  const testCommandList = options.testCommands || defaultTestCommands(cwd);
  const testCommands = testCommandList.map((command) => execute(command, sandboxDir));
  const allCommands = [...runtimeVersions, ...installCommands, ...testCommands];
  const status = testCommands.length > 0 && allCommands.every((item) => item.exit_code === 0) ? "pass" : "blocked";
  const result: SandboxVerificationResult = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    status,
    sandbox_dir: sandboxDir,
    adapter: "local",
    runtime_versions: runtimeVersions,
    install_commands: installCommands,
    test_commands: testCommands
  };
  writeText(sandboxVerificationFile(cwd, runId), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
