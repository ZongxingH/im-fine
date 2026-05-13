import fs from "node:fs";
import path from "node:path";
import { doctor } from "./doctor.js";
import { ensureDir, writeFileIfMissing, writeJsonIfMissing, writeText } from "./fs.js";
import type { InitResult } from "./types.js";

function markdown(title: string, body: string): string {
  return `# ${title}\n\n${body.trim()}\n`;
}

const IGNORED_PROJECT_ENTRIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  ".imfine",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "target",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".idea",
  ".vscode"
]);

function isIgnoredProjectEntry(name: string): boolean {
  if (IGNORED_PROJECT_ENTRIES.has(name)) return true;
  if (name.startsWith(".") && ![".github", ".gitignore", ".env.example"].includes(name)) return true;
  return false;
}

function listProjectEntries(cwd: string): string[] {
  if (!fs.existsSync(cwd)) return [];
  return fs.readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => !isIgnoredProjectEntry(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function walkFiles(cwd: string, limit = 80): string[] {
  const ignored = new Set([...IGNORED_PROJECT_ENTRIES, ".imfine"]);
  const files: string[] = [];

  function walk(dir: string): void {
    if (files.length >= limit) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relative = path.relative(cwd, full);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(relative);
        if (files.length >= limit) return;
      }
    }
  }

  walk(cwd);
  return files.sort();
}

function detectEvidence(files: string[]): {
  packageFiles: string[];
  sourceFiles: string[];
  configFiles: string[];
  testFiles: string[];
  entrypointFiles: string[];
} {
  const packageFiles = files.filter((file) => /(^|\/)(package\.json|pom\.xml|build\.gradle|settings\.gradle|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod)$/i.test(file));
  const sourceFiles = files.filter((file) => /\.(ts|tsx|js|jsx|py|java|go|rs|kt|swift|php|rb|cs)$/i.test(file)).slice(0, 20);
  const configFiles = files.filter((file) => /(^|\/)(Dockerfile|docker-compose\.ya?ml|application\.ya?ml|bootstrap\.ya?ml|\.env\.example|tsconfig\.json|vite\.config\.[jt]s|next\.config\.[jt]s)$/i.test(file)).slice(0, 20);
  const testFiles = files.filter((file) => /(^|\/)(test|tests|__tests__)\/|(\.test|\.spec)\./i.test(file)).slice(0, 20);
  const entrypointFiles = files.filter((file) => /(^|\/)(main|index|app|server|cli)\.(ts|tsx|js|jsx|py|java|go|rs)$/i.test(file)).slice(0, 20);
  return { packageFiles, sourceFiles, configFiles, testFiles, entrypointFiles };
}

function bullet(items: string[], fallback = "- 未发现明确证据"): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : fallback;
}

function placeholder(title: string, evidenceTitle: string, evidenceItems: string[], nextOwner: string, notes: string[] = []): string {
  return markdown(title, `
## 状态

- pending
- owner: ${nextOwner}
- 这是初始化占位，不是最终结论。

## ${evidenceTitle}

${bullet(evidenceItems)}

## 后续要求

${notes.length > 0 ? notes.map((item) => `- ${item}`).join("\n") : "- 仅在有文件证据时写入结论。"}
`);
}

function writeArchitectureDocs(cwd: string, workspace: string, created: string[], preserved: string[]): InitResult["architecture"] {
  const projectEntries = listProjectEntries(cwd);
  const mode: "empty" | "existing" = projectEntries.length === 0 ? "empty" : "existing";
  const architectureDir = path.join(workspace, "project", "architecture");
  ensureDir(architectureDir);

  if (mode === "empty") {
    return { mode, files: [] };
  }

  const files = walkFiles(cwd);
  const evidence = detectEvidence(files);
  const generated: string[] = [];
  const add = (name: string, content: string): void => {
    const file = path.join(architectureDir, name);
    writeFileIfMissing(file, content, created, preserved);
    generated.push(file);
  };

  add("overview.md", placeholder("架构概览占位", "项目证据", [...projectEntries, ...evidence.sourceFiles], "architect", [
    "由 Architect Agent 基于项目证据补全项目模式、主要模块和总体边界。",
    "证据不足时保持 unknown，不要猜测。"
  ]));

  add("tech-stack.md", placeholder("技术栈占位", "包管理与配置证据", [...evidence.packageFiles, ...evidence.configFiles], "architect", [
    "语言、框架、中间件、外部服务结论必须引用文件路径。"
  ]));

  add("modules.md", placeholder("模块结构占位", "源码证据", evidence.sourceFiles, "architect", [
    "后续补全模块职责、依赖关系和主要读写边界。"
  ]));

  add("module-tech-stack.md", placeholder("模块技术栈占位", "候选证据", [...evidence.packageFiles, ...evidence.configFiles], "architect", [
    "仅在有文件证据时记录模块级技术栈。"
  ]));

  add("entrypoints.md", placeholder("入口占位", "入口候选", evidence.entrypointFiles, "architect", [
    "每个入口结论都必须带文件证据。"
  ]));

  add("test-strategy.md", placeholder("测试策略占位", "测试证据", evidence.testFiles, "architect", [
    "后续补全测试框架、测试目录和可执行测试命令。"
  ]));

  add("risks.md", placeholder("架构风险占位", "初始化缺口", [
    evidence.packageFiles.length === 0 ? "未发现包管理或构建文件" : "包管理和构建文件仍需 Agent 确认",
    evidence.testFiles.length === 0 ? "未发现测试文件" : "测试策略仍需 Agent 确认"
  ], "architect", [
    "风险文件只记录缺口，不输出完整架构评审结论。"
  ]));

  const architectDir = path.join(workspace, "runs", "init", "agents", "architect");
  const architectInput = path.join(architectDir, "input.md");
  writeText(architectInput, markdown("Architect Init Input", `
## 目标

基于已有项目证据补全 \`.imfine/project/architecture\` 和 \`.imfine/project/*.md\` 中的 pending 占位。

## 约束

- 只根据文件证据给出架构结论。
- 证据不足时标记 unknown，不要猜测。
- 不修改业务代码。
- 不把初始化占位文本当作已确认结论。

## 初始证据

### 项目根目录

${bullet(projectEntries)}

### 包管理 / 构建

${bullet(evidence.packageFiles)}

### 配置

${bullet(evidence.configFiles)}

### 源码

${bullet(evidence.sourceFiles)}

### 测试

${bullet(evidence.testFiles)}

## 需要补全的占位文件

${generated.map((file) => `- ${file}`).join("\n")}
`));

  return { mode, files: generated, architectInput };
}

export function initProject(cwd: string): InitResult {
  const workspace = path.join(cwd, ".imfine");
  const created: string[] = [];
  const updated: string[] = [];
  const preserved: string[] = [];

  const dirs = [
    workspace,
    path.join(workspace, "project"),
    path.join(workspace, "project", "architecture"),
    path.join(workspace, "project", "capabilities"),
    path.join(workspace, "runs"),
    path.join(workspace, "state"),
    path.join(workspace, "reports")
  ];
  for (const dir of dirs) ensureDir(dir);

  writeFileIfMissing(path.join(workspace, "config.yaml"), [
    "project:",
    "  name: unknown",
    "runtime:",
    "  default_remote: origin",
    "  run_branch_prefix: imfine",
    "  auto_install_dependencies: true",
    "  auto_push_after_doctor_pass: true",
    "targets:",
    "  codex: true",
    "  claude: true",
    ""
  ].join("\n"), created, preserved);

  writeFileIfMissing(path.join(workspace, "project", "overview.md"), markdown("Project Overview", "Status: pending.\n\nThis file is a placeholder. Product and project conclusions must be filled by model agents with evidence."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "product.md"), markdown("Product", "Status: pending.\n\nThis file is a placeholder, not a confirmed product summary."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "architecture.md"), markdown("Architecture", "Status: pending.\n\nArchitecture conclusions must be supplied by Architect Agent with file evidence."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "tech-stack.md"), markdown("Tech Stack", "Status: pending.\n\nDetected tooling may appear in doctor output, but this file starts as a placeholder."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "module-map.md"), markdown("Module Map", "Status: pending.\n\nModule boundaries must be filled by model agents from source evidence."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "conventions.md"), markdown("Conventions", "Status: pending.\n\nDevelopment conventions must be confirmed from repository evidence."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "test-strategy.md"), markdown("Test Strategy", "Status: pending.\n\nTesting conclusions must be supplied from repository evidence."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "infrastructure.md"), markdown("Infrastructure", "Status: pending.\n\nUse `/imfine init` or `imfine doctor` to refresh deterministic infrastructure checks."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "risks.md"), markdown("Risks", "Status: pending.\n\nNo evidence-backed risk summary has been written yet."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "capabilities", ".gitkeep"), "", created, preserved);
  writeFileIfMissing(path.join(workspace, "runs", ".gitkeep"), "", created, preserved);
  writeFileIfMissing(path.join(workspace, "reports", ".gitkeep"), "", created, preserved);
  const architecture = writeArchitectureDocs(cwd, workspace, created, preserved);

  writeJsonIfMissing(path.join(workspace, "state", "current.json"), {
    schema_version: 1,
    current_run_id: null,
    updated_at: new Date().toISOString()
  }, created, preserved);
  writeJsonIfMissing(path.join(workspace, "state", "locks.json"), {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    locks: {},
    history: []
  }, created, preserved);
  writeJsonIfMissing(path.join(workspace, "state", "queue.json"), {
    schema_version: 1,
    queue: []
  }, created, preserved);

  const report = doctor(cwd);
  return { cwd, workspace, projectMode: architecture.mode, architecture, created, updated, preserved, doctor: report };
}
