import fs from "node:fs";
import path from "node:path";
import type { DoctorCheck, DoctorReport } from "./types.js";
import { runCommand } from "./shell.js";

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

function targetChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const codexSkill = path.join(process.env.HOME || "", ".codex", "skills", "imfine", "SKILL.md");
  const claudeCommand = path.join(process.env.HOME || "", ".claude", "commands", "imfine.md");
  const codexInstalled = fs.existsSync(codexSkill);
  const claudeInstalled = fs.existsSync(claudeCommand);
  const executorConfigured = Boolean(process.env.IMFINE_AGENT_EXECUTOR);
  checks.push(check("target.codex", "Codex /imfine skill", codexInstalled ? "pass" : "warn", codexInstalled ? codexSkill : "Codex skill is not installed"));
  checks.push(check("target.claude", "Claude /imfine command", claudeInstalled ? "pass" : "warn", claudeInstalled ? claudeCommand : "Claude command is not installed"));
  checks.push(check("provider.model_executor", "model executor bridge", executorConfigured ? "pass" : "warn", executorConfigured ? "IMFINE_AGENT_EXECUTOR is configured" : "IMFINE_AGENT_EXECUTOR is not configured; autonomous model agent execution will wait for provider configuration"));
  checks.push(check("provider.codex.bridge", "Codex provider bridge", codexInstalled ? "pass" : "warn", codexInstalled ? "Codex /imfine entry can dispatch imfine model packages through the configured executor" : "Codex provider bridge is unavailable until /imfine is installed"));
  checks.push(check("provider.claude.bridge", "Claude provider bridge", claudeInstalled ? "pass" : "warn", claudeInstalled ? "Claude /imfine command can dispatch imfine model packages through the configured executor" : "Claude provider bridge is unavailable until /imfine is installed"));
  checks.push(check("provider.codex.entry_installed", "Codex provider entry installed", codexInstalled ? "pass" : "warn", codexInstalled ? `entry_installed=true path=${codexSkill}` : "entry_installed=false"));
  checks.push(check("provider.codex.executor_configured", "Codex model executor configured", executorConfigured ? "pass" : "warn", executorConfigured ? "executor_configured=true" : "executor_configured=false"));
  checks.push(check("provider.codex.subagent_supported", "Codex subagent support", "warn", "subagent_supported=unknown; imfine will wait for model execution configuration instead of silently degrading"));
  checks.push(check("provider.claude.entry_installed", "Claude provider entry installed", claudeInstalled ? "pass" : "warn", claudeInstalled ? `entry_installed=true path=${claudeCommand}` : "entry_installed=false"));
  checks.push(check("provider.claude.executor_configured", "Claude model executor configured", executorConfigured ? "pass" : "warn", executorConfigured ? "executor_configured=true" : "executor_configured=false"));
  checks.push(check("provider.claude.subagent_supported", "Claude subagent support", "warn", "subagent_supported=unknown; imfine will wait for model execution configuration instead of silently degrading"));
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
