import fs from "node:fs";
import path from "node:path";
import { copyFileIfChanged, ensureDir } from "./fs.js";
import { packageRoot } from "./paths.js";

export type LibraryKind = "agents" | "skills" | "templates" | "workflows";

export interface LibraryEntry {
  id: string;
  file: string;
  kind: LibraryKind;
  directory?: string;
}

export interface LibrarySyncResult {
  workspace: string;
  created: string[];
  updated: string[];
  preserved: string[];
}

const KINDS: LibraryKind[] = ["agents", "skills", "templates", "workflows"];

export function libraryRoot(): string {
  return path.join(packageRoot(), "src", "imfine-skills");
}

function walkDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const child = path.join(dir, entry.name);
    result.push(child, ...walkDirs(child));
  }
  return result;
}

function skillEntries(kind: LibraryKind): LibraryEntry[] {
  const root = libraryRoot();
  const dirs = walkDirs(root).filter((dir) => fs.existsSync(path.join(dir, "SKILL.md")));
  return dirs
    .filter((dir) => {
      const relative = path.relative(root, dir).split(path.sep);
      if (kind === "agents") return relative[0] === "agents";
      return relative[0] !== "agents";
    })
    .map((dir) => ({
      id: path.basename(dir),
      file: path.join(dir, "SKILL.md"),
      directory: dir,
      kind
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function fileEntries(kind: LibraryKind, dir: string): LibraryEntry[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") || file.endsWith(".json") || file.endsWith(".yaml"))
    .sort()
    .map((file) => ({
      id: file.replace(/\.(md|json|yaml)$/, ""),
      file: path.join(dir, file),
      kind
    }));
}

export function listLibrary(kind: LibraryKind): LibraryEntry[] {
  if (kind === "agents" || kind === "skills") return skillEntries(kind);
  if (kind === "templates") return fileEntries(kind, path.join(libraryRoot(), "templates"));
  return fileEntries(kind, path.join(libraryRoot(), "runtime-workflows"));
}

export function readLibrary(kind: LibraryKind, id: string): string {
  const entries = listLibrary(kind);
  const entry = entries.find((item) => item.id === id || path.basename(item.file) === id);
  if (!entry) {
    throw new Error(`Unknown ${kind} entry: ${id}`);
  }
  return fs.readFileSync(entry.file, "utf8");
}

export function syncLibrary(cwd: string): LibrarySyncResult {
  const workspace = path.join(cwd, ".imfine", "debug", "imfine-skills-snapshot");
  const created: string[] = [];
  const updated: string[] = [];
  const preserved: string[] = [];

  for (const kind of KINDS) {
    const targetDir = path.join(workspace, kind);
    ensureDir(targetDir);
    for (const entry of listLibrary(kind)) {
      const targetName = entry.directory ? path.join(entry.id, "SKILL.md") : path.basename(entry.file);
      copyFileIfChanged(entry.file, path.join(targetDir, targetName), created, updated, preserved);
    }
  }

  return { workspace, created, updated, preserved };
}

export function parseKind(value: string): LibraryKind {
  if (value === "agents" || value === "skills" || value === "templates" || value === "workflows") return value;
  throw new Error("Expected one of: agents, skills, templates, workflows.");
}
