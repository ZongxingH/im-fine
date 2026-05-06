import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFileIfMissing(file: string, content: string, created: string[], preserved: string[]): void {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file)) {
    preserved.push(file);
    return;
  }
  fs.writeFileSync(file, content);
  created.push(file);
}

export function writeJsonIfMissing(file: string, value: unknown, created: string[], preserved: string[]): void {
  writeFileIfMissing(file, `${JSON.stringify(value, null, 2)}\n`, created, preserved);
}

export function writeText(file: string, content: string): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content);
}

export function copyDirectory(source: string, target: string, options: { exclude: Set<string> }): void {
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (options.exclude.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(from, to, options);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    }
  }
}

export function copyFileIfChanged(source: string, target: string, created: string[], updated: string[], preserved: string[]): void {
  ensureDir(path.dirname(target));
  const next = fs.readFileSync(source);
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, next);
    created.push(target);
    return;
  }

  const current = fs.readFileSync(target);
  if (Buffer.compare(current, next) === 0) {
    preserved.push(target);
    return;
  }

  fs.writeFileSync(target, next);
  updated.push(target);
}
