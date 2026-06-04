import fs from "node:fs";
import path from "node:path";

export interface HarnessConfig {
  schema_version: 1;
  config_id: string;
  extends?: string;
  enabled_gates: string[];
  trace: {
    enabled: boolean;
    include_artifact_hash: boolean;
  };
  verification: {
    commands: string[];
  };
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function configRoot(cwd: string): string {
  return path.join(cwd, "configs", "harness");
}

function configPath(cwd: string, configId: string): string {
  if (configId === "base") return path.join(configRoot(cwd), "base.json");
  return path.join(configRoot(cwd), "experiments", `${configId}.json`);
}

function mergeConfig(base: HarnessConfig, overlay: Partial<HarnessConfig>): HarnessConfig {
  return {
    ...base,
    ...overlay,
    schema_version: 1,
    config_id: overlay.config_id || base.config_id,
    enabled_gates: Array.isArray(overlay.enabled_gates) ? overlay.enabled_gates : base.enabled_gates,
    trace: {
      ...base.trace,
      ...(overlay.trace || {})
    },
    verification: {
      ...base.verification,
      ...(overlay.verification || {})
    }
  };
}

function loadFromFile(file: string, seen: Set<string>): HarnessConfig {
  if (!fs.existsSync(file)) throw new Error(`Harness config not found: ${file}`);
  const real = fs.realpathSync(file);
  if (seen.has(real)) throw new Error(`Harness config extends cycle: ${file}`);
  seen.add(real);
  const parsed = readJson<Partial<HarnessConfig>>(file);
  if (parsed.schema_version !== 1) throw new Error(`Harness config schema_version must be 1: ${file}`);
  if (typeof parsed.config_id !== "string" || !parsed.config_id.trim()) throw new Error(`Harness config missing config_id: ${file}`);
  const parent = typeof parsed.extends === "string" && parsed.extends.trim()
    ? loadFromFile(path.resolve(path.dirname(file), parsed.extends), seen)
    : null;
  const base = parent || {
    schema_version: 1,
    config_id: parsed.config_id,
    enabled_gates: [],
    trace: {
      enabled: false,
      include_artifact_hash: false
    },
    verification: {
      commands: []
    }
  };
  return mergeConfig(base, parsed);
}

export function loadHarnessConfig(cwd: string, configId = "base"): HarnessConfig {
  return loadFromFile(configPath(cwd, configId), new Set());
}

export function listHarnessConfigIds(cwd: string): string[] {
  const ids = ["base"];
  const dir = path.join(configRoot(cwd), "experiments");
  if (fs.existsSync(dir)) {
    ids.push(...fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => path.basename(file, ".json"))
      .sort());
  }
  return ids;
}
