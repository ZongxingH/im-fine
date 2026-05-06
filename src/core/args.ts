import type { CliArgs } from "./types.js";

export function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }

    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
    if (inlineValue !== undefined) {
      flags[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { positional, flags };
}

export function readStringFlag(args: CliArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function readBooleanFlag(args: CliArgs, name: string): boolean {
  return args.flags[name] === true;
}
