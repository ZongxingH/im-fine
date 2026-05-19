import fs from "node:fs";
import path from "node:path";
import type { DoctorCheck, DoctorReport } from "./types.js";
import { runCommand } from "./shell.js";
import { validateTrueHarnessEvidenceFiles } from "./true-harness-evidence.js";

export type ImfineProvider = "codex" | "claude" | "unknown";
export type SubagentSupport = "supported" | "unsupported" | "unknown";

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

function targetChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const codexSkill = path.join(process.env.HOME || "", ".codex", "skills", "imfine", "SKILL.md");
  const claudeCommand = path.join(process.env.HOME || "", ".claude", "commands", "imfine.md");
  const codexInstalled = fs.existsSync(codexSkill);
  const claudeInstalled = fs.existsSync(claudeCommand);
  const provider = normalizeProvider(process.env.IMFINE_PROVIDER);
  const subagentSupport = normalizeSubagentSupport(process.env.IMFINE_SUBAGENT_SUPPORTED);
  checks.push(check("target.codex", "Codex /imfine skill", codexInstalled ? "pass" : "warn", codexInstalled ? codexSkill : "Codex skill is not installed"));
  checks.push(check("target.claude", "Claude /imfine command", claudeInstalled ? "pass" : "warn", claudeInstalled ? claudeCommand : "Claude command is not installed"));
  checks.push(check("provider.codex.entry_installed", "Codex provider entry installed", codexInstalled ? "pass" : "warn", codexInstalled ? `entry_installed=true path=${codexSkill}` : "entry_installed=false"));
  checks.push(check("provider.codex.session_orchestrator", "Codex session orchestrator", codexInstalled ? "pass" : "warn", codexInstalled ? "session_orchestrator=true; current Codex session executes or dispatches model Agent work" : "session_orchestrator=false"));
  checks.push(check("provider.codex.subagent_supported", "Codex subagent support", process.env.IMFINE_PROVIDER === "codex" && subagentSupport === "supported" ? "pass" : "warn", process.env.IMFINE_PROVIDER === "codex" ? `subagent_supported=${subagentSupport}` : "subagent_supported=unknown"));
  checks.push(check("provider.claude.entry_installed", "Claude provider entry installed", claudeInstalled ? "pass" : "warn", claudeInstalled ? `entry_installed=true path=${claudeCommand}` : "entry_installed=false"));
  checks.push(check("provider.claude.session_orchestrator", "Claude session orchestrator", claudeInstalled ? "pass" : "warn", claudeInstalled ? "session_orchestrator=true; current Claude session executes or dispatches model Agent work" : "session_orchestrator=false"));
  checks.push(check("provider.claude.subagent_supported", "Claude subagent support", process.env.IMFINE_PROVIDER === "claude" && subagentSupport === "supported" ? "pass" : "warn", process.env.IMFINE_PROVIDER === "claude" ? `subagent_supported=${subagentSupport}` : "subagent_supported=unknown"));
  checks.push(check("provider.current", "Current provider", provider === "unknown" ? "warn" : "pass", `provider=${provider}`));
  checks.push(check("provider.current.entry_installed", "Current provider entry installed", provider === "unknown" ? "warn" : providerEntryInstalled(provider) ? "pass" : "warn", provider === "unknown" ? "entry_installed=unknown" : `entry_installed=${providerEntryInstalled(provider)}`));
  checks.push(check("provider.current.subagent_supported", "Current provider subagent support", subagentSupport === "supported" ? "pass" : "warn", `subagent_supported=${subagentSupport}`));
  return checks;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hashesFromText(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\b[a-f0-9]{7,40}\b/gi)).map((match) => match[0])));
}

function currentRunId(cwd: string): string | null {
  const file = path.join(cwd, ".imfine", "state", "current.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = readJson(file) as { current_run_id?: unknown };
    return typeof parsed.current_run_id === "string" ? parsed.current_run_id : null;
  } catch {
    return null;
  }
}

function runConsistencyChecks(cwd: string): DoctorCheck[] {
  const runId = currentRunId(cwd);
  if (!runId) return [];
  const runRoot = path.join(cwd, ".imfine", "runs", runId);
  const runFile = path.join(runRoot, "run.json");
  if (!fs.existsSync(runFile)) return [check("run.current.exists", "current run exists", "fail", `missing ${runFile}`)];
  const checks: DoctorCheck[] = [];
  const run = readJson(runFile) as {
    status?: unknown;
    commit_hash?: unknown;
    commit_hashes?: unknown;
    commit_set?: unknown;
    final_head?: unknown;
  };
  const status = typeof run.status === "string" ? run.status : "unknown";
  const finalGates = path.join(runRoot, "orchestration", "final-gates.json");
  let finalGateValues: Record<string, string> | null = null;
  if (fs.existsSync(finalGates)) {
    const gates = readJson(finalGates) as { gates?: Record<string, unknown> };
    finalGateValues = gates.gates ? Object.fromEntries(Object.entries(gates.gates).map(([key, value]) => [key, String(value)])) : null;
  }
  const requiredFinalGates = ["planning", "dispatch", "qa", "review", "recheck_fix_loop", "committer", "push", "archive", "true_harness", "project_knowledge"];
  const finalGatesComplete = finalGateValues !== null && requiredFinalGates.every((key) => finalGateValues?.[key] === "pass");
  checks.push(check(
    "run.final_gates",
    "current run final gates",
    status === "completed" && !finalGatesComplete
      ? "fail"
      : fs.existsSync(finalGates)
        ? "pass"
        : "warn",
    finalGateValues
      ? Object.entries(finalGateValues).map(([key, value]) => `${key}=${value}`).join(", ")
      : `missing ${finalGates}`
  ));

  const evidenceJson = path.join(runRoot, "orchestration", "true-harness-evidence.json");
  const evidenceMd = path.join(runRoot, "orchestration", "true-harness-evidence.md");
  if (fs.existsSync(evidenceJson) && fs.existsSync(evidenceMd)) {
    const consistency = validateTrueHarnessEvidenceFiles(evidenceJson, evidenceMd);
    checks.push(check(
      "run.true_harness.evidence_consistency",
      "true harness JSON/Markdown consistency",
      consistency.passed ? "pass" : "fail",
      consistency.passed ? "JSON and Markdown match" : consistency.errors.join("; ")
    ));
  }

  const dispatch = path.join(runRoot, "orchestration", "dispatch-contracts.json");
  const parallel = path.join(runRoot, "orchestration", "parallel-execution.json");
  const receiptsDir = path.join(runRoot, "orchestration", "provider-receipts");
  const agentRunsFile = path.join(runRoot, "orchestration", "agent-runs.json");
  if (fs.existsSync(evidenceJson)) {
    const json = readJson(evidenceJson) as {
      true_harness_passed?: unknown;
      provider_capability?: { subagent_supported?: unknown; blocked?: unknown };
      parallel_execution?: { missing_completed_wave_contracts?: unknown[] };
      provider_execution_receipts?: { missing_provider_receipt_contracts?: unknown[] };
      handoff_validation?: { invalid?: unknown[] };
    };
    if (json.true_harness_passed === true) {
      const dispatchCount = fs.existsSync(dispatch)
        ? ((readJson(dispatch) as { contracts?: unknown[] }).contracts || []).length
        : 0;
      const waveCount = fs.existsSync(parallel)
        ? ((readJson(parallel) as { wave_history?: unknown[] }).wave_history || []).length
        : 0;
      const receiptCount = fs.existsSync(receiptsDir)
        ? fs.readdirSync(receiptsDir).filter((file) => file.endsWith(".json")).length
        : 0;
      checks.push(check(
        "run.true_harness.runtime_evidence",
        "true harness runtime evidence",
        dispatchCount > 0 && waveCount > 0 && receiptCount > 0 ? "pass" : "fail",
        `dispatch_contracts=${dispatchCount}, waves=${waveCount}, receipts=${receiptCount}`
      ));
      checks.push(check(
        "run.provider_capability.consistency",
        "provider capability consistency",
        json.provider_capability?.subagent_supported === "supported" && json.provider_capability?.blocked === false ? "pass" : "fail",
        `subagent_supported=${String(json.provider_capability?.subagent_supported)}, blocked=${String(json.provider_capability?.blocked)}`
      ));
    }
    const missingWaves = Array.isArray(json.parallel_execution?.missing_completed_wave_contracts) ? json.parallel_execution.missing_completed_wave_contracts.length : 0;
    const missingReceipts = Array.isArray(json.provider_execution_receipts?.missing_provider_receipt_contracts) ? json.provider_execution_receipts.missing_provider_receipt_contracts.length : 0;
    const invalidHandoffs = Array.isArray(json.handoff_validation?.invalid) ? json.handoff_validation.invalid.length : 0;
    checks.push(check(
      "run.dispatch.receipts.waves",
      "dispatch, receipt, and wave traceability",
      missingWaves === 0 && missingReceipts === 0 && invalidHandoffs === 0 ? "pass" : "fail",
      `missing_waves=${missingWaves}, missing_receipts=${missingReceipts}, invalid_handoffs=${invalidHandoffs}`
    ));
  }
  if (fs.existsSync(agentRunsFile)) {
    const registry = readJson(agentRunsFile) as {
      agents?: Array<{ id?: unknown; role?: unknown; status?: unknown; executionType?: unknown; handoffFile?: unknown }>;
      runtime_gates?: unknown[];
      execution_units?: unknown[];
    };
    const agents = Array.isArray(registry.agents) ? registry.agents : [];
    const nativeWithoutHandoff = agents.filter((agent) => {
      if (agent.status !== "completed") return false;
      const handoff = typeof agent.handoffFile === "string"
        ? path.isAbsolute(agent.handoffFile) ? agent.handoffFile : path.resolve(cwd, agent.handoffFile)
        : path.join(runRoot, "agents", String(agent.id || ""), "handoff.json");
      return !fs.existsSync(handoff);
    });
    const runtimeGates = Array.isArray(registry.runtime_gates) ? registry.runtime_gates.length : 0;
    const executionUnits = Array.isArray(registry.execution_units) ? registry.execution_units.length : agents.length + runtimeGates;
    checks.push(check(
      "run.agent_registry.execution_types",
      "agent registry execution types",
      nativeWithoutHandoff.length === 0 && executionUnits >= agents.length + runtimeGates ? "pass" : "fail",
      `native_agents=${agents.length}, runtime_gates=${runtimeGates}, execution_units=${executionUnits}, native_without_handoff=${nativeWithoutHandoff.map((agent) => String(agent.id || agent.role || "unknown")).join(", ") || "none"}`
    ));
  }
  const blockerMatrix = path.join(runRoot, "review", "blocker-matrix.json");
  if (fs.existsSync(blockerMatrix)) {
    const matrix = readJson(blockerMatrix) as { rows?: unknown[] };
    const rowCount = Array.isArray(matrix.rows) ? matrix.rows.length : 0;
    const blockedGateCount = finalGateValues ? requiredFinalGates.filter((key) => finalGateValues?.[key] !== "pass").length : 0;
    checks.push(check(
      "run.review.blocker_matrix",
      "QA/Review blocker matrix",
      blockedGateCount === 0 || rowCount > 0 ? "pass" : "fail",
      `rows=${rowCount}, blocked_gates=${blockedGateCount}`
    ));
  } else if (finalGateValues && !finalGatesComplete) {
    checks.push(check(
      "run.review.blocker_matrix",
      "QA/Review blocker matrix",
      "fail",
      `missing ${blockerMatrix}`
    ));
  }

  const projectRoot = path.join(cwd, ".imfine", "project");
  if (fs.existsSync(projectRoot)) {
    const staleMarkers = ["initialized from limited evidence", "not detected", "unknown", ".gitignore only", "no source evidence", "no test evidence"];
    const staleFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && file.endsWith(".md")) {
          const text = fs.readFileSync(file, "utf8").toLowerCase();
          if (staleMarkers.some((marker) => text.includes(marker))) staleFiles.push(path.relative(cwd, file));
        }
      }
    };
    walk(projectRoot);
    checks.push(check(
      "run.project_knowledge.freshness",
      "project knowledge freshness",
      staleFiles.length === 0 ? "pass" : "warn",
      staleFiles.length === 0 ? "no stale markers found" : staleFiles.join(", ")
    ));
  }

  const gitHead = runCommand("git", ["rev-parse", "HEAD"], cwd);
  const head = gitHead.code === 0 ? gitHead.stdout.trim() : "";
  const recorded = [
    typeof run.commit_hash === "string" ? run.commit_hash : undefined,
    typeof run.final_head === "string" ? run.final_head : undefined,
    ...(Array.isArray(run.commit_hashes) ? run.commit_hashes.filter((item): item is string => typeof item === "string") : []),
    ...(Array.isArray(run.commit_set) ? run.commit_set.filter((item): item is string => typeof item === "string") : [])
  ].filter((item): item is string => Boolean(item));
  if (head && recorded.length > 0) {
    checks.push(check(
      "run.commit.final_head",
      "run final commit identity",
      recorded.some((hash) => hash === head || hash.slice(0, 12) === head.slice(0, 12)) ? "pass" : "fail",
      `head=${head}; recorded=${Array.from(new Set(recorded)).join(", ")}`
    ));
  }
  const archiveReport = path.join(runRoot, "archive", "archive-report.md");
  if (head && fs.existsSync(archiveReport)) {
    const reportHashes = hashesFromText(fs.readFileSync(archiveReport, "utf8"));
    checks.push(check(
      "run.commit.archive_report_identity",
      "archive report commit identity",
      reportHashes.length === 0 || reportHashes.some((hash) => hash === head || hash.slice(0, 12) === head.slice(0, 12)) ? "pass" : "fail",
      reportHashes.length === 0 ? "archive report has no explicit commit hash" : `head=${head}; archive_report=${reportHashes.join(", ")}`
    ));
  }

  return checks;
}

export function doctor(cwd: string): DoctorReport {
  const checks = [
    ...gitCheck(cwd),
    ...toolingChecks(cwd),
    ...targetChecks(),
    ...runConsistencyChecks(cwd)
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
