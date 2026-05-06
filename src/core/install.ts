import fs from "node:fs";
import path from "node:path";
import type { InstallLanguage, InstallTarget } from "./types.js";
import { copyDirectory, ensureDir, writeText } from "./fs.js";
import { homeDir, packageRoot, runtimeHome } from "./paths.js";
import { claudeCommandTemplate, codexSkillTemplate } from "./templates.js";

export interface InstallResult {
  target: InstallTarget;
  language: InstallLanguage;
  runtime: string;
  written: string[];
  dryRun: boolean;
}

function validateTarget(value: string | undefined): InstallTarget {
  if (value === undefined) return "all";
  if (value === "codex" || value === "claude" || value === "all") return value;
  throw new Error("Invalid --target. Expected codex, claude, or all.");
}

function validateLanguage(value: string | undefined): InstallLanguage {
  if (value === undefined) return "zh";
  if (value === "zh" || value === "en") return value;
  throw new Error("Invalid --lang. Expected zh or en.");
}

function installRuntime(dryRun: boolean, written: string[]): void {
  const source = packageRoot();
  const target = runtimeHome();
  if (dryRun) {
    written.push(target);
    return;
  }
  if (fs.existsSync(target) && fs.realpathSync(source) === fs.realpathSync(target)) {
    written.push(target);
    return;
  }
  ensureDir(target);
  copyDirectory(source, target, {
    exclude: new Set(["node_modules", ".git", ".imfine", ".npm-cache"])
  });
  written.push(target);
}

function writeCodex(language: InstallLanguage, dryRun: boolean, written: string[]): void {
  const file = path.join(homeDir(), ".codex", "skills", "imfine", "SKILL.md");
  if (!dryRun) writeText(file, codexSkillTemplate(language));
  written.push(file);
}

function writeClaude(language: InstallLanguage, dryRun: boolean, written: string[]): void {
  const file = path.join(homeDir(), ".claude", "commands", "imfine.md");
  if (!dryRun) writeText(file, claudeCommandTemplate(language));
  written.push(file);
}

export function install(targetValue: string | undefined, languageValue: string | undefined, dryRun: boolean): InstallResult {
  const target = validateTarget(targetValue);
  const language = validateLanguage(languageValue);
  const written: string[] = [];

  installRuntime(dryRun, written);
  if (target === "codex" || target === "all") writeCodex(language, dryRun, written);
  if (target === "claude" || target === "all") writeClaude(language, dryRun, written);

  if (!dryRun) {
    fs.chmodSync(path.join(runtimeHome(), "dist", "cli", "imfine.js"), 0o755);
    fs.chmodSync(path.join(runtimeHome(), "dist", "cli", "imfine-runtime.js"), 0o755);
  }

  return {
    target,
    language,
    runtime: runtimeHome(),
    written,
    dryRun
  };
}
