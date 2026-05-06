import fs from "node:fs";
import path from "node:path";
import { doctor } from "./doctor.js";
import { ensureDir, writeFileIfMissing, writeJsonIfMissing, writeText } from "./fs.js";
import { syncLibrary } from "./library.js";
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

  add("overview.md", markdown("架构概览", `
## 状态

- 初始化阶段生成的架构草稿。
- 当前大模型会话必须使用 Architect Agent 基于项目证据补全，不要把 runtime 草稿当作最终结论。

## 项目模式

- existing

## 项目根目录证据

${bullet(projectEntries)}

## 源码证据

${bullet(evidence.sourceFiles)}
`));

  add("tech-stack.md", markdown("技术栈", `
## 包管理和构建证据

${bullet(evidence.packageFiles)}

## 配置证据

${bullet(evidence.configFiles)}

## 待 Architect Agent 补全

- 语言、框架、中间件、外部服务结论必须带文件证据。
- 证据不足时保留未知，不要猜测。
`));

  add("modules.md", markdown("模块结构", `
## 初始文件线索

${bullet(evidence.sourceFiles)}

## 待 Architect Agent 补全

- 模块职责。
- 模块间依赖。
- 主要读写边界。
`));

  add("module-tech-stack.md", markdown("模块技术栈", `
## 候选证据

${bullet([...evidence.packageFiles, ...evidence.configFiles])}

## 待 Architect Agent 补全

- 只有存在文件证据时，才输出 Redis、MongoDB、MySQL、PostgreSQL、Nacos、Kafka、RabbitMQ、Elasticsearch、MyBatis、Spring Boot、Spring Cloud、Dubbo、gRPC、GraphQL 等模块级技术栈。
`));

  add("entrypoints.md", markdown("入口", `
## 入口候选

${bullet(evidence.entrypointFiles)}

## 待 Architect Agent 补全

- 每个入口结论都必须带文件证据。
`));

  add("test-strategy.md", markdown("测试策略", `
## 测试证据

${bullet(evidence.testFiles)}

## 待 Architect Agent 补全

- 测试框架。
- 测试目录。
- 可执行测试命令。
- 缺失测试时记录风险和补齐建议。
`));

  add("risks.md", markdown("架构风险", `
## 初始化风险

- 这是初始化架构草稿，不是完整架构评审。
- 所有结论必须由 Architect Agent 基于证据补全。
- 证据不足的区域应标记未知。

## 当前缺口

- ${evidence.packageFiles.length === 0 ? "未发现包管理或构建文件。" : "包管理和构建文件需要进一步确认。"}
- ${evidence.testFiles.length === 0 ? "未发现测试文件。" : "测试策略需要进一步确认。"}
`));

  const architectDir = path.join(workspace, "runs", "init", "agents", "architect");
  const architectInput = path.join(architectDir, "input.md");
  writeText(architectInput, markdown("Architect Init Input", `
## 目标

基于已有项目证据补全 \`.imfine/project/architecture\` 和 \`.imfine/project/*.md\`。

## 约束

- 只根据文件证据给出架构结论。
- 每个语言、框架、中间件、外部服务、入口、模块职责结论都必须引用文件路径。
- 证据不足时标记未知，不要猜测。
- 不修改业务代码。

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

## 需要更新的文件

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

  writeFileIfMissing(path.join(workspace, "project", "overview.md"), markdown("Project Overview", "Status: unknown. Evidence-backed project analysis will be added by later imfine phases."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "product.md"), markdown("Product", "Status: unknown."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "architecture.md"), markdown("Architecture", "Status: unknown. Architecture conclusions must cite file evidence."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "tech-stack.md"), markdown("Tech Stack", "Status: unknown. Detected tooling is available in doctor output."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "module-map.md"), markdown("Module Map", "Status: unknown."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "conventions.md"), markdown("Conventions", "Status: unknown."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "test-strategy.md"), markdown("Test Strategy", "Status: unknown."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "infrastructure.md"), markdown("Infrastructure", "Run `/imfine init` or `imfine doctor` to refresh infrastructure checks."), created, preserved);
  writeFileIfMissing(path.join(workspace, "project", "risks.md"), markdown("Risks", "No risks recorded yet."), created, preserved);
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

  const library = syncLibrary(cwd);
  created.push(...library.created);
  updated.push(...library.updated);
  preserved.push(...library.preserved);

  const report = doctor(cwd);
  return { cwd, workspace, projectMode: architecture.mode, architecture, created, updated, preserved, doctor: report };
}
