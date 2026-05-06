import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function homeDir(): string {
  return process.env.HOME || os.homedir();
}

export function imfineHome(): string {
  return path.join(homeDir(), ".imfine");
}

export function runtimeHome(): string {
  return path.join(imfineHome(), "runtime");
}

export function packageRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(current, "../..");
}

export function resolveCwd(value?: string): string {
  return path.resolve(value || process.cwd());
}
