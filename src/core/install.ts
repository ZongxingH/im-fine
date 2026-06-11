import fs from "node:fs";
import path from "node:path";
import type { InstallLanguage, InstallTarget } from "./types.js";
import { copyDirectory, ensureDir, writeText } from "./fs.js";
import { homeDir, packageRoot, runtimeHome } from "./paths.js";
import { listLibrary, type LibraryEntry } from "./library.js";

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

function imfineSkillEntries(): LibraryEntry[] {
  return [...listLibrary("agents"), ...listLibrary("skills")]
    .filter((entry) => entry.id.startsWith("imfine-") && entry.directory)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function parseDescription(skillFile: string): string {
  const text = fs.readFileSync(skillFile, "utf8");
  const match = text.match(/^description:\s*(.+)$/m);
  if (!match) return "imfine workflow skill";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function commandPointer(entry: LibraryEntry, language: InstallLanguage): string {
  const skillPath = path.join(homeDir(), ".agents", "skills", entry.id, "SKILL.md");
  const description = parseDescription(entry.file).replace(/'/g, "''");
  const instruction = language === "en"
    ? `LOAD the FULL ${skillPath}, READ its entire contents and follow its directions exactly.`
    : `加载完整的 ${skillPath}，通读全部内容，并严格按照其中的指令执行。`;
  return `---
description: '${description}'
---

${instruction}
`;
}

function removeLegacyEntries(dryRun: boolean, written: string[]): void {
  const legacyPaths = [
    path.join(homeDir(), ".codex", "skills", "imfine"),
    path.join(homeDir(), ".claude", "commands", "imfine.md")
  ];
  for (const legacyPath of legacyPaths) {
    if (!dryRun && fs.existsSync(legacyPath)) fs.rmSync(legacyPath, { recursive: true, force: true });
    written.push(`${legacyPath} (removed legacy entry if present)`);
  }
}

function installSharedSkills(dryRun: boolean, written: string[]): void {
  for (const entry of imfineSkillEntries()) {
    const source = entry.directory;
    if (!source) continue;
    const target = path.join(homeDir(), ".agents", "skills", entry.id);
    if (!dryRun) {
      fs.rmSync(target, { recursive: true, force: true });
      ensureDir(target);
      copyDirectory(source, target, {
        exclude: new Set(["node_modules", ".git", ".DS_Store"])
      });
    }
    written.push(target);
  }
}

function writeClaudeCommands(language: InstallLanguage, dryRun: boolean, written: string[]): void {
  for (const entry of imfineSkillEntries()) {
    const file = path.join(homeDir(), ".claude", "commands", `${entry.id}.md`);
    if (!dryRun) writeText(file, commandPointer(entry, language));
    written.push(file);
  }
}

function chmodRuntime(): void {
  for (const file of [
    path.join(runtimeHome(), "dist", "cli", "imfine.js"),
    path.join(runtimeHome(), "dist", "cli", "imfine-runtime.js")
  ]) {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
  }
}

export function install(targetValue: string | undefined, languageValue: string | undefined, dryRun: boolean): InstallResult {
  const target = validateTarget(targetValue);
  const language = validateLanguage(languageValue);
  const written: string[] = [];

  installRuntime(dryRun, written);
  removeLegacyEntries(dryRun, written);
  if (target === "codex" || target === "claude" || target === "all") installSharedSkills(dryRun, written);
  if (target === "claude" || target === "all") writeClaudeCommands(language, dryRun, written);

  if (!dryRun) chmodRuntime();

  return {
    target,
    language,
    runtime: runtimeHome(),
    written,
    dryRun
  };
}
