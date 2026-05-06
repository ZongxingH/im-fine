import fs from "node:fs";
import path from "node:path";
import { copyFileIfChanged, ensureDir } from "./fs.js";
import { packageRoot } from "./paths.js";

export type LibraryKind = "agents" | "skills" | "templates";

export interface LibraryEntry {
  id: string;
  file: string;
  kind: LibraryKind;
}

export interface LibrarySyncResult {
  workspace: string;
  created: string[];
  updated: string[];
  preserved: string[];
}

const KINDS: LibraryKind[] = ["agents", "skills", "templates"];

export function libraryRoot(): string {
  return path.join(packageRoot(), "library");
}

export function listLibrary(kind: LibraryKind): LibraryEntry[] {
  const dir = path.join(libraryRoot(), kind);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md") || file.endsWith(".json"))
    .sort()
    .map((file) => ({
      id: file.replace(/\.(md|json)$/, ""),
      file: path.join(dir, file),
      kind
    }));
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
  const workspace = path.join(cwd, ".imfine");
  const created: string[] = [];
  const updated: string[] = [];
  const preserved: string[] = [];

  for (const kind of KINDS) {
    const targetDir = path.join(workspace, kind);
    ensureDir(targetDir);
    for (const entry of listLibrary(kind)) {
      copyFileIfChanged(entry.file, path.join(targetDir, path.basename(entry.file)), created, updated, preserved);
    }
  }

  const readme = path.join(libraryRoot(), "README.md");
  if (fs.existsSync(readme)) {
    copyFileIfChanged(readme, path.join(workspace, "library.md"), created, updated, preserved);
  }

  return { workspace, created, updated, preserved };
}

export function parseKind(value: string): LibraryKind {
  if (value === "agents" || value === "skills" || value === "templates") return value;
  throw new Error("Expected one of: agents, skills, templates.");
}
