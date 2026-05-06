import { spawnSync } from "node:child_process";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export function runCommand(command: string, args: string[], cwd: string, timeoutMs = 10_000): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs
  });

  return {
    code: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error?.message
  };
}

export function runShellCommand(command: string, cwd: string): CommandResult {
  const result = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000
  });

  return {
    code: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error?.message
  };
}
