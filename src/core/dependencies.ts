import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { runCommand } from "./shell.js";
import { transitionRunState } from "./state-machine.js";

export type DependencyInstallStatus = "installed" | "skipped" | "blocked" | "failed";

export interface DependencyInstallResult {
  runId: string;
  status: DependencyInstallStatus;
  manager: string;
  command: string[];
  evidence: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  reason: string;
}

interface PackageJson {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function evidenceFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "evidence", "dependency-install.md");
}

function hasPackageDependencies(cwd: string): boolean {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PackageJson;
    return [parsed.dependencies, parsed.devDependencies, parsed.optionalDependencies]
      .some((group) => group && Object.keys(group).length > 0);
  } catch {
    return false;
  }
}

export function dependencyInstallRequired(cwd: string): boolean {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return true;
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return true;
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return true;
  if (hasPackageDependencies(cwd)) return true;
  if (fs.existsSync(path.join(cwd, "requirements.txt"))) return true;
  if (fs.existsSync(path.join(cwd, "pom.xml"))) return true;
  return false;
}

function detectCommand(cwd: string): { manager: string; command: string[]; blockedReason?: string } {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return { manager: "pnpm", command: ["pnpm", "install", "--frozen-lockfile"] };
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return { manager: "yarn", command: ["yarn", "install", "--frozen-lockfile"] };
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return { manager: "npm", command: ["npm", "ci"] };
  if (hasPackageDependencies(cwd)) return { manager: "npm", command: ["npm", "install"] };
  if (fs.existsSync(path.join(cwd, "requirements.txt"))) {
    const unixPython = path.join(cwd, ".venv", "bin", "python");
    const windowsPython = path.join(cwd, ".venv", "Scripts", "python.exe");
    const python = fs.existsSync(unixPython) ? unixPython : fs.existsSync(windowsPython) ? windowsPython : "";
    return python
      ? { manager: "pip", command: [python, "-m", "pip", "install", "-r", "requirements.txt"] }
      : { manager: "pip", command: ["python", "-m", "pip", "install", "-r", "requirements.txt"], blockedReason: "pip install requires a project-local .venv" };
  }
  if (fs.existsSync(path.join(cwd, "pom.xml"))) return { manager: "maven", command: ["mvn", "-q", "-DskipTests", "install"] };
  return { manager: "none", command: [], blockedReason: "no project dependency marker found" };
}

function writeEvidence(result: DependencyInstallResult): void {
  writeText(result.evidence, `# Dependency Install Evidence

## Result

- status: ${result.status}
- manager: ${result.manager}
- command: ${result.command.length > 0 ? result.command.join(" ") : "none"}
- exit code: ${result.exitCode ?? "not-run"}
- reason: ${result.reason}

## Stdout

\`\`\`
${result.stdout}
\`\`\`

## Stderr

\`\`\`
${result.stderr}
\`\`\`
`);
}

export function installDependencies(cwd: string, runId: string): DependencyInstallResult {
  const evidence = evidenceFile(cwd, runId);
  ensureDir(path.dirname(evidence));
  const detected = detectCommand(cwd);

  if (!detected.command.length || detected.blockedReason) {
    const result: DependencyInstallResult = {
      runId,
      status: detected.blockedReason ? "blocked" : "skipped",
      manager: detected.manager,
      command: detected.command,
      evidence,
      stdout: "",
      stderr: "",
      exitCode: null,
      reason: detected.blockedReason || "no dependency installation required"
    };
    writeEvidence(result);
    if (result.status === "blocked") {
      transitionRunState(cwd, runId, "needs_infrastructure_action", {
        dependency_install_blocked_at: new Date().toISOString(),
        dependency_install_reason: result.reason,
        dependency_install_evidence: evidence
      });
    }
    return result;
  }

  const [command, ...args] = detected.command;
  const executed = runCommand(command, args, cwd, 120_000);
  const result: DependencyInstallResult = {
    runId,
    status: executed.code === 0 ? "installed" : "failed",
    manager: detected.manager,
    command: detected.command,
    evidence,
    stdout: executed.stdout,
    stderr: executed.stderr || executed.error || "",
    exitCode: executed.code,
    reason: executed.code === 0 ? "project dependency command completed" : "project dependency command failed"
  };
  writeEvidence(result);
  if (result.status === "failed") {
    transitionRunState(cwd, runId, "needs_infrastructure_action", {
      dependency_install_failed_at: new Date().toISOString(),
      dependency_install_reason: result.reason,
      dependency_install_evidence: evidence
    });
  }
  return result;
}
