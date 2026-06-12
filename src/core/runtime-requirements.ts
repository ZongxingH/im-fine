import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { runCommand } from "./shell.js";
import { appendRuntimeTraceEvent } from "./trace-events.js";

export interface RuntimeRequirementCheck {
  id: string;
  status: "pass" | "blocked";
  detail: string;
  evidence: string[];
}

export interface RuntimeRequirementsResult {
  schema_version: 1;
  run_id: string;
  generated_at: string;
  status: "pass" | "blocked";
  project_kind: string;
  declared_runtime: {
    languages: string[];
    files: string[];
  };
  observed_runtime_versions: Array<{
    runtime: string;
    command: string;
    version: string;
    status: "observed" | "unavailable";
  }>;
  qa_evidence: {
    file: string;
    records_runtime_version: boolean;
    records_test_command: boolean;
    records_test_output: boolean;
  };
  checks: RuntimeRequirementCheck[];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function relative(cwd: string, file: string): string {
  return path.isAbsolute(file) ? path.relative(cwd, file) : file;
}

function rootFiles(cwd: string, names: string[]): string[] {
  return names.map((name) => path.join(cwd, name)).filter((file) => fs.existsSync(file));
}

function projectRoots(cwd: string): string[] {
  const ignored = new Set([".git", ".imfine", "node_modules", "dist", "build", "target", "coverage"]);
  const roots = [cwd];
  for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignored.has(entry.name)) continue;
    const dir = path.join(cwd, entry.name);
    const hasManifest = ["package.json", "pom.xml", "build.gradle", "build.gradle.kts", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml"]
      .some((name) => fs.existsSync(path.join(dir, name)));
    if (hasManifest) roots.push(dir);
  }
  return Array.from(new Set(roots));
}

function findRunbooks(cwd: string): string[] {
  const candidates = [
    ...rootFiles(cwd, ["README.md", "README.txt", "RUNBOOK.md", "RUNBOOK.txt"]),
    ...rootFiles(cwd, [path.join("docs", "README.md"), path.join("docs", "runbook.md"), path.join("docs", "RUNBOOK.md")])
  ];
  return Array.from(new Set(candidates));
}

function packageJsonRuntime(cwd: string): { language: string; files: string[] } | null {
  const files: string[] = [];
  for (const root of projectRoots(cwd)) {
    const file = path.join(root, "package.json");
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = readJson<{ engines?: { node?: unknown }; volta?: { node?: unknown } }>(file);
      const declared = typeof parsed.engines?.node === "string" || typeof parsed.volta?.node === "string";
      const extra = [".node-version", ".nvmrc", ".tool-versions"].map((name) => path.join(root, name)).filter((item) => fs.existsSync(item));
      if (declared || extra.length > 0) files.push(file, ...extra);
    } catch {
      // Invalid package manifests are handled by task/QA evidence, not this detector.
    }
  }
  return files.length > 0 ? { language: "node", files } : null;
}

function pythonRuntime(cwd: string): { language: string; files: string[] } | null {
  const files = rootFiles(cwd, [".python-version", "runtime.txt", ".tool-versions"]);
  const pyproject = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyproject) && /requires-python\s*=/.test(readText(pyproject))) files.push(pyproject);
  return files.length > 0 ? { language: "python", files } : null;
}

function goRuntime(cwd: string): { language: string; files: string[] } | null {
  const file = path.join(cwd, "go.mod");
  return fs.existsSync(file) && /^go\s+\d+\.\d+/m.test(readText(file)) ? { language: "go", files: [file] } : null;
}

function rustRuntime(cwd: string): { language: string; files: string[] } | null {
  const file = path.join(cwd, "Cargo.toml");
  return fs.existsSync(file) && /rust-version\s*=/.test(readText(file)) ? { language: "rust", files: [file] } : null;
}

function javaRuntime(cwd: string): { language: string; files: string[] } | null {
  const poms = projectRoots(cwd)
    .map((root) => path.join(root, "pom.xml"))
    .filter((file) => fs.existsSync(file) && /<(java\.version|maven\.compiler\.(source|target|release))>/.test(readText(file)));
  const gradle = projectRoots(cwd)
    .flatMap((root) => ["build.gradle", "build.gradle.kts"].map((name) => path.join(root, name)))
    .filter((file) => fs.existsSync(file));
  const declared = gradle.filter((file) => /(sourceCompatibility|targetCompatibility|JavaVersion)/.test(readText(file)));
  const files = [...poms, ...declared];
  return files.length > 0 ? { language: "java", files } : null;
}

function declaredRuntime(cwd: string): { languages: string[]; files: string[] } {
  const declarations = [
    packageJsonRuntime(cwd),
    pythonRuntime(cwd),
    goRuntime(cwd),
    rustRuntime(cwd),
    javaRuntime(cwd)
  ].filter((item): item is { language: string; files: string[] } => Boolean(item));
  return {
    languages: Array.from(new Set(declarations.map((item) => item.language))).sort(),
    files: Array.from(new Set(declarations.flatMap((item) => item.files).map((file) => relative(cwd, file)))).sort()
  };
}

function detectedLanguages(cwd: string): string[] {
  const pairs: Array<[string, string]> = [
    ["node", "package.json"],
    ["python", "pyproject.toml"],
    ["python", "requirements.txt"],
    ["go", "go.mod"],
    ["rust", "Cargo.toml"],
    ["java", "pom.xml"],
    ["java", "build.gradle"],
    ["java", "build.gradle.kts"]
  ];
  return Array.from(new Set(projectRoots(cwd).flatMap((root) => pairs.filter(([, file]) => fs.existsSync(path.join(root, file))).map(([language]) => language)))).sort();
}

function versionCommand(language: string): [string, string[]] {
  if (language === "node") return ["node", ["--version"]];
  if (language === "python") return ["python3", ["--version"]];
  if (language === "go") return ["go", ["version"]];
  if (language === "rust") return ["rustc", ["--version"]];
  if (language === "java") return ["java", ["-version"]];
  return [language, ["--version"]];
}

function observedVersions(cwd: string, languages: string[]): RuntimeRequirementsResult["observed_runtime_versions"] {
  return languages.map((language) => {
    const [command, args] = versionCommand(language);
    const result = runCommand(command, args, cwd);
    const output = result.stdout || result.stderr || result.error || "unavailable";
    return {
      runtime: language,
      command: [command, ...args].join(" "),
      version: output,
      status: result.code === 0 && output.trim().length > 0 ? "observed" as const : "unavailable" as const
    };
  });
}

function qaEvidenceStatus(file: string): RuntimeRequirementsResult["qa_evidence"] {
  const text = readText(file);
  const recordsRuntimeVersion = /(runtime|node|python|java|go|rust|ruby|php|deno|bun|npm|pnpm|yarn).*(version|--version|-version)|\b(v?\d+\.\d+\.\d+|Python\s+\d+\.\d+|go version|openjdk|javac|rustc\s+\d+\.\d+)/i.test(text);
  const recordsTestCommand = /\b(command|命令)\s*:|```(?:bash|sh|shell|text)?\s*[\s\S]{0,200}\b(npm|pnpm|yarn|python|pytest|go test|cargo test|mvn|gradle|node)\b/i.test(text);
  const recordsTestOutput = /\b(pass|passed|fail|failed|ok|success|tests?|用例|通过|失败)\b/i.test(text) && text.trim().split("\n").length >= 3;
  return {
    file,
    records_runtime_version: recordsRuntimeVersion,
    records_test_command: recordsTestCommand,
    records_test_output: recordsTestOutput
  };
}

function check(id: string, passed: boolean, detail: string, evidence: string[]): RuntimeRequirementCheck {
  return { id, status: passed ? "pass" : "blocked", detail, evidence };
}

export function evaluateRuntimeRequirements(cwd: string, runId: string): RuntimeRequirementsResult {
  const dir = runDir(cwd, runId);
  const run = readJson<{ project_kind?: string }>(path.join(dir, "run.json"));
  const projectKind = run.project_kind || "unknown";
  const docs = findRunbooks(cwd);
  const detected = detectedLanguages(cwd);
  const declared = declaredRuntime(cwd);
  const languages = Array.from(new Set([...declared.languages, ...detected])).sort();
  const versions = observedVersions(cwd, languages);
  const qaFile = path.join(dir, "evidence", "test-results.md");
  const qa = qaEvidenceStatus(qaFile);
  const checks = [
    check(
      "project_docs",
      projectKind !== "new_project" || docs.length > 0,
      projectKind === "new_project" ? "new project delivery requires README or runbook" : "existing project docs are not required by this gate",
      docs.map((file) => relative(cwd, file))
    ),
    check(
      "runtime_version_declaration",
      detected.length > 0 && detected.every((language) => declared.languages.includes(language)),
      detected.length > 0
        ? `detected languages: ${detected.join(", ")}; declared files: ${declared.files.join(", ") || "missing"}`
        : "no language manifest detected; runtime declaration still required before archive",
      declared.files
    ),
    check(
      "runtime_version_observed",
      languages.length > 0 && versions.every((item) => item.status === "observed"),
      versions.length > 0 ? versions.map((item) => `${item.command}: ${item.version}`).join("; ") : "no declared or detected runtime to observe",
      []
    ),
    check(
      "qa_records_runtime_version",
      qa.records_runtime_version,
      "QA evidence must include actual runtime version output",
      [relative(cwd, qa.file)]
    ),
    check(
      "qa_records_test_command",
      qa.records_test_command,
      "QA evidence must include executed test command",
      [relative(cwd, qa.file)]
    ),
    check(
      "qa_records_test_output",
      qa.records_test_output,
      "QA evidence must include actual test output, not just a summary word",
      [relative(cwd, qa.file)]
    )
  ];
  return {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    status: checks.every((item) => item.status === "pass") ? "pass" : "blocked",
    project_kind: projectKind,
    declared_runtime: declared,
    observed_runtime_versions: versions,
    qa_evidence: {
      ...qa,
      file: relative(cwd, qa.file)
    },
    checks
  };
}

export function writeRuntimeRequirements(cwd: string, runId: string): { json: string; markdown: string; result: RuntimeRequirementsResult } {
  const dir = runDir(cwd, runId);
  const orchestration = path.join(dir, "orchestration");
  ensureDir(orchestration);
  const result = evaluateRuntimeRequirements(cwd, runId);
  const json = path.join(orchestration, "runtime-requirements.json");
  const markdown = path.join(orchestration, "runtime-requirements.md");
  writeText(json, `${JSON.stringify(result, null, 2)}\n`);
  writeText(markdown, `# Runtime Requirements

- status: ${result.status}
- project kind: ${result.project_kind}
- declared runtimes: ${result.declared_runtime.languages.join(", ") || "missing"}
- declaration files: ${result.declared_runtime.files.join(", ") || "missing"}

## Observed Versions

${result.observed_runtime_versions.length > 0 ? result.observed_runtime_versions.map((item) => `- ${item.status}: ${item.command} -> ${item.version}`).join("\n") : "- missing"}

## QA Evidence

- file: ${result.qa_evidence.file}
- records runtime version: ${result.qa_evidence.records_runtime_version ? "yes" : "no"}
- records test command: ${result.qa_evidence.records_test_command ? "yes" : "no"}
- records test output: ${result.qa_evidence.records_test_output ? "yes" : "no"}

## Checks

${result.checks.map((item) => `- ${item.status}: ${item.id} (${item.detail})`).join("\n")}
`);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.runtime-requirements",
    componentId: "runtime.runtime-requirements",
    actionId: "runtime.write_runtime_requirements",
    eventType: "artifact_written",
    status: result.status,
    reason: result.status === "pass"
      ? "runtime requirements passed"
      : result.checks.filter((item) => item.status === "blocked").map((item) => `${item.id}: ${item.detail}`).join("; "),
    inputArtifacts: [path.join(dir, "run.json"), path.join(dir, "evidence", "test-results.md"), ...result.declared_runtime.files],
    outputArtifacts: [json, markdown]
  });
  return { json, markdown, result };
}
