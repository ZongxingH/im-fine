import fs from "node:fs";
import path from "node:path";
import type { DoctorCheck, DoctorReport } from "./types.js";
import { runCommand } from "./shell.js";

export type ImfineProvider = "codex" | "claude" | "unknown";
export type SubagentSupport = "supported" | "unsupported" | "unknown";

export interface TrueHarnessCapability {
  provider: ImfineProvider;
  subagentSupport: SubagentSupport;
  entryInstalled: boolean;
  ready: boolean;
  reason: string;
}

function check(id: string, label: string, status: DoctorCheck["status"], detail: string): DoctorCheck {
  return { id, label, status, detail };
}

function commandExists(command: string, cwd: string): boolean {
  const result = runCommand(command, ["--version"], cwd);
  return result.code === 0;
}

function detectPackageManager(cwd: string): string | null {
  const markers: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["package.json", "npm"],
    ["requirements.txt", "pip"],
    ["pyproject.toml", "python"],
    ["pom.xml", "maven"],
    ["build.gradle", "gradle"],
    ["build.gradle.kts", "gradle"],
    ["Cargo.toml", "cargo"],
    ["go.mod", "go"]
  ];
  for (const [file, manager] of markers) {
    if (fs.existsSync(path.join(cwd, file))) return manager;
  }
  return null;
}

function detectNodeScripts(cwd: string): string[] {
  const packageFile = path.join(cwd, "package.json");
  if (!fs.existsSync(packageFile)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(packageFile, "utf8")) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts || {};
    return ["test", "lint", "typecheck", "build"].filter((name) => typeof scripts[name] === "string");
  } catch {
    return [];
  }
}

function detectLockfiles(cwd: string): string[] {
  return [
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "requirements.txt",
    "uv.lock",
    "poetry.lock",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Cargo.lock",
    "go.sum"
  ].filter((file) => fs.existsSync(path.join(cwd, file)));
}

function gitCheck(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const gitAvailable = commandExists("git", cwd);
  checks.push(check("git.available", "git executable", gitAvailable ? "pass" : "fail", gitAvailable ? "git is available" : "git is not available"));
  if (!gitAvailable) return checks;

  const inside = runCommand("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  const isRepo = inside.code === 0 && inside.stdout === "true";
  checks.push(check("git.repository", "git repository", isRepo ? "pass" : "warn", isRepo ? "current directory is inside a git repository" : "current directory is not a git repository"));
  if (!isRepo) return checks;

  const branch = runCommand("git", ["branch", "--show-current"], cwd);
  checks.push(check("git.branch", "current branch", branch.code === 0 && branch.stdout ? "pass" : "warn", branch.stdout || "unable to determine current branch"));

  const remote = runCommand("git", ["remote", "get-url", "origin"], cwd);
  checks.push(check("git.remote.origin", "origin remote", remote.code === 0 && remote.stdout ? "pass" : "warn", remote.stdout || "origin remote is not configured"));

  const status = runCommand("git", ["status", "--porcelain"], cwd);
  checks.push(check("git.worktree.clean", "worktree clean", status.code === 0 && !status.stdout ? "pass" : "warn", status.stdout ? "working tree has uncommitted changes" : "working tree is clean"));

  const pushProbe = runCommand("git", ["ls-remote", "--exit-code", "origin"], cwd);
  if (remote.code !== 0) {
    checks.push(check("git.push.probe", "push/read remote probe", "warn", "skipped because origin remote is missing"));
  } else {
    checks.push(check("git.push.probe", "push/read remote probe", pushProbe.code === 0 ? "pass" : "warn", pushProbe.code === 0 ? "origin is reachable" : pushProbe.stderr || "origin reachability could not be verified"));
  }

  if (remote.code !== 0 || !branch.stdout) {
    checks.push(check("git.push.permission", "push permission dry-run", "warn", "skipped because origin remote or current branch is missing"));
  } else {
    const probeBranch = `refs/heads/imfine-doctor-${Date.now()}`;
    const pushPermission = runCommand("git", ["push", "--dry-run", "origin", `HEAD:${probeBranch}`], cwd);
    checks.push(check("git.push.permission", "push permission dry-run", pushPermission.code === 0 ? "pass" : "warn", pushPermission.code === 0 ? "dry-run push to origin succeeded" : pushPermission.stderr || "dry-run push permission could not be verified"));
  }

  return checks;
}

function toolingChecks(cwd: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const manager = detectPackageManager(cwd);
  checks.push(check("tooling.package_manager", "package manager", manager ? "pass" : "warn", manager ? `detected ${manager}` : "no package manager marker found"));

  const lockfiles = detectLockfiles(cwd);
  checks.push(check("tooling.lockfile", "lockfile or dependency marker", lockfiles.length > 0 ? "pass" : "warn", lockfiles.length > 0 ? `detected ${lockfiles.join(", ")}` : "no lockfile or dependency marker found"));

  const scripts = detectNodeScripts(cwd);
  if (fs.existsSync(path.join(cwd, "package.json"))) {
    checks.push(check("tooling.node_scripts", "node scripts", scripts.length > 0 ? "pass" : "warn", scripts.length > 0 ? `detected scripts: ${scripts.join(", ")}` : "no test/lint/typecheck/build scripts found"));
  } else {
    checks.push(check("tooling.node_scripts", "node scripts", "warn", "package.json not found"));
  }

  return checks;
}

function normalizeProvider(value: string | undefined): ImfineProvider {
  if (value === "codex" || value === "claude") return value;
  return "unknown";
}

function normalizeSubagentSupport(value: string | undefined): SubagentSupport {
  if (!value) return "unknown";
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "supported" || normalized === "yes") return "supported";
  if (normalized === "false" || normalized === "0" || normalized === "unsupported" || normalized === "no") return "unsupported";
  return "unknown";
}

function providerEntryInstalled(provider: ImfineProvider): boolean {
  if (provider === "codex") return fs.existsSync(path.join(process.env.HOME || "", ".codex", "skills", "imfine", "SKILL.md"));
  if (provider === "claude") return fs.existsSync(path.join(process.env.HOME || "", ".claude", "commands", "imfine.md"));
  return false;
}

export function detectTrueHarnessCapability(): TrueHarnessCapability {
  const provider = normalizeProvider(process.env.IMFINE_PROVIDER);
  const subagentSupport = normalizeSubagentSupport(process.env.IMFINE_SUBAGENT_SUPPORTED);
  const entryInstalled = providerEntryInstalled(provider);
  if (provider === "unknown") {
    return {
      provider,
      subagentSupport,
      entryInstalled,
      ready: false,
      reason: "current provider is unknown; set IMFINE_PROVIDER=codex or IMFINE_PROVIDER=claude inside the real orchestrating session"
    };
  }
  if (subagentSupport !== "supported") {
    return {
      provider,
      subagentSupport,
      entryInstalled,
      ready: false,
      reason: `current ${provider} session does not declare native subagent support; set IMFINE_SUBAGENT_SUPPORTED=true only when native spawn/subagent is actually available`
    };
  }
  return {
    provider,
    subagentSupport,
    entryInstalled,
    ready: true,
    reason: entryInstalled
      ? `${provider} provider entry is installed and native subagent support is declared`
      : `${provider} provider is explicitly declared and native subagent support is declared`
  };
}

function targetChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const codexSkill = path.join(process.env.HOME || "", ".codex", "skills", "imfine", "SKILL.md");
  const claudeCommand = path.join(process.env.HOME || "", ".claude", "commands", "imfine.md");
  const codexInstalled = fs.existsSync(codexSkill);
  const claudeInstalled = fs.existsSync(claudeCommand);
  const harness = detectTrueHarnessCapability();
  checks.push(check("target.codex", "Codex /imfine skill", codexInstalled ? "pass" : "warn", codexInstalled ? codexSkill : "Codex skill is not installed"));
  checks.push(check("target.claude", "Claude /imfine command", claudeInstalled ? "pass" : "warn", claudeInstalled ? claudeCommand : "Claude command is not installed"));
  checks.push(check("provider.codex.bridge", "Codex provider bridge", codexInstalled ? "pass" : "warn", codexInstalled ? "Codex /imfine entry lets the current Codex session orchestrate imfine agent packages" : "Codex provider bridge is unavailable until /imfine is installed"));
  checks.push(check("provider.claude.bridge", "Claude provider bridge", claudeInstalled ? "pass" : "warn", claudeInstalled ? "Claude /imfine command lets the current Claude session orchestrate imfine agent packages" : "Claude provider bridge is unavailable until /imfine is installed"));
  checks.push(check("provider.codex.entry_installed", "Codex provider entry installed", codexInstalled ? "pass" : "warn", codexInstalled ? `entry_installed=true path=${codexSkill}` : "entry_installed=false"));
  checks.push(check("provider.codex.session_orchestrator", "Codex session orchestrator", codexInstalled ? "pass" : "warn", codexInstalled ? "session_orchestrator=true; current Codex session executes or dispatches model Agent work" : "session_orchestrator=false"));
  checks.push(check("provider.codex.subagent_supported", "Codex subagent support", "warn", "subagent_supported=unknown; true harness remains blocked until native subagent support is explicitly confirmed"));
  checks.push(check("provider.claude.entry_installed", "Claude provider entry installed", claudeInstalled ? "pass" : "warn", claudeInstalled ? `entry_installed=true path=${claudeCommand}` : "entry_installed=false"));
  checks.push(check("provider.claude.session_orchestrator", "Claude session orchestrator", claudeInstalled ? "pass" : "warn", claudeInstalled ? "session_orchestrator=true; current Claude session executes or dispatches model Agent work" : "session_orchestrator=false"));
  checks.push(check("provider.claude.subagent_supported", "Claude subagent support", "warn", "subagent_supported=unknown; true harness remains blocked until native subagent support is explicitly confirmed"));
  checks.push(check("provider.current", "Current provider", harness.provider === "unknown" ? "fail" : "pass", `provider=${harness.provider}`));
  checks.push(check("provider.current.subagent_supported", "Current provider subagent support", harness.subagentSupport === "supported" ? "pass" : "fail", `subagent_supported=${harness.subagentSupport}`));
  checks.push(check("provider.current.true_harness_ready", "Current provider true harness readiness", harness.ready ? "pass" : "fail", harness.reason));
  return checks;
}

export function doctor(cwd: string): DoctorReport {
  const checks = [
    ...gitCheck(cwd),
    ...toolingChecks(cwd),
    ...targetChecks()
  ];
  const summary = {
    pass: checks.filter((item) => item.status === "pass").length,
    warn: checks.filter((item) => item.status === "warn").length,
    fail: checks.filter((item) => item.status === "fail").length
  };

  return {
    cwd,
    checkedAt: new Date().toISOString(),
    checks,
    summary
  };
}
