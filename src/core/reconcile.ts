import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateTrueHarnessEvidenceFiles, writeTrueHarnessEvidence } from "./true-harness-evidence.js";
import { runCommand } from "./shell.js";
import { assertTransitionAccepted, transitionRunState } from "./state-machine.js";

export interface ReconcileGate {
  id: string;
  status: "pass" | "blocked";
  detail: string;
}

export interface ReconcileResult {
  runId: string;
  status: "completed" | "blocked";
  gates: ReconcileGate[];
  files: string[];
}

interface RunMetadata {
  run_id: string;
  status?: string;
  created_at?: string;
  commit_hash?: string;
  commit_hashes?: string[];
  commit_set?: string[];
  final_head?: string;
  implementation_commit?: string;
  evidence_sync_commit?: string;
  archive_commit?: string;
  pushed_head?: string;
  push_status?: string;
  commit?: { hash?: string };
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

function runFile(cwd: string, runId: string): string {
  return path.join(runDir(cwd, runId), "run.json");
}

function updateRunFile(cwd: string, runId: string, extra: Record<string, unknown>): RunMetadata {
  const file = runFile(cwd, runId);
  const current = readJson<Record<string, unknown>>(file);
  const next = { ...current, ...extra, updated_at: new Date().toISOString() };
  writeText(file, `${JSON.stringify(next, null, 2)}\n`);
  return next as unknown as RunMetadata;
}

function git(cwd: string, args: string[]): { code: number | null; stdout: string; stderr: string; error?: string } {
  return runCommand("git", args, cwd);
}

function ensureEvidenceDir(dir: string): string {
  const evidence = path.join(dir, "evidence");
  ensureDir(evidence);
  return evidence;
}

function copyReportIfExists(source: string, target: string, title: string): string | null {
  if (!fs.existsSync(source) || fs.existsSync(target)) return fs.existsSync(target) ? target : null;
  writeText(target, `# ${title}\n\nSource: ${source}\n\n${readText(source).trim()}\n`);
  return target;
}

export function collectStandardEvidence(cwd: string, runId: string): string[] {
  const dir = runDir(cwd, runId);
  const evidence = ensureEvidenceDir(dir);
  const files = [
    copyReportIfExists(path.join(dir, "review", "qa-report.md"), path.join(evidence, "test-results.md"), "Test Results"),
    copyReportIfExists(path.join(dir, "review", "code-review.md"), path.join(evidence, "review.md"), "Review Evidence"),
    copyReportIfExists(path.join(dir, "review", "risk-review.md"), path.join(evidence, "risk-review.md"), "Risk Review Evidence")
  ].filter((file): file is string => Boolean(file));
  return files;
}

function gitCommitRecords(cwd: string, since?: string): Array<{ hash: string; subject: string }> {
  const args = ["log", "--all", "--format=%H%x09%s", "--max-count=50"];
  if (since) args.splice(2, 0, `--since=${since}`);
  const result = git(cwd, args);
  if (result.code !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, ...subject] = line.split("\t");
      return { hash, subject: subject.join("\t") };
    })
    .filter((commit) => commit.hash);
}

function gitHead(cwd: string): string | null {
  const result = git(cwd, ["rev-parse", "HEAD"]);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function shortHash(value: string): string {
  return value.slice(0, 12);
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function hashesFromText(text: string): string[] {
  return uniqueStrings(Array.from(text.matchAll(/\b[a-f0-9]{7,40}\b/gi)).map((match) => match[0]));
}

function reportHashSources(dir: string): Array<{ source: string; hashes: string[] }> {
  const files = [
    path.join(dir, "archive", "archive-report.md"),
    path.join(dir, "archive", "final-report.md"),
    path.join(dir, "committer", "commit-report.md")
  ];
  return files
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ source: file, hashes: hashesFromText(readText(file)) }))
    .filter((item) => item.hashes.length > 0);
}

export function reconcileCommits(cwd: string, runId: string): string | null {
  const dir = runDir(cwd, runId);
  const run = readJson<RunMetadata>(runFile(cwd, runId));
  const evidence = ensureEvidenceDir(dir);
  const file = path.join(evidence, "commits.md");
  const head = gitHead(cwd);
  const reports = reportHashSources(dir);
  const recorded = uniqueStrings([
    ...(Array.isArray(run.commit_hashes) ? run.commit_hashes : []),
    ...(Array.isArray(run.commit_set) ? run.commit_set : []),
    run.commit_hash,
    run.final_head,
    run.implementation_commit,
    run.evidence_sync_commit,
    run.archive_commit,
    run.commit?.hash,
    ...reports.flatMap((item) => item.hashes)
  ]);
  const explicitWithoutHead = head ? recorded.filter((hash) => hash !== head && shortHash(hash) !== shortHash(head)) : recorded;
  const distinctExplicitShortHashes = Array.from(new Set(explicitWithoutHead.map(shortHash)));
  if (distinctExplicitShortHashes.length > 1 && !Array.isArray(run.commit_set)) {
    writeText(file, `# Commit Evidence\n\n- status: blocked_commit_identity_drift\n- final head: ${head || "unknown"}\n- conflicting recorded commits: ${recorded.join(", ")}\n\n## Sources\n\n${reports.map((item) => `- ${item.source}: ${item.hashes.join(", ")}`).join("\n") || "- none"}\n`);
    updateRunFile(cwd, runId, {
      commit_blocked_reason: "commit identity drift: multiple conflicting recorded commits without explicit commit_set",
      commit_evidence: file,
      final_head: head || undefined
    });
    return null;
  }
  const commits = recorded.length > 0
    ? recorded.map((hash) => ({ hash, subject: "recorded in run evidence" }))
    : gitCommitRecords(cwd, run.created_at);
  const commitSet = uniqueStrings([...commits.map((commit) => commit.hash), head]);
  if (commitSet.length === 0) return fs.existsSync(file) ? file : null;
  writeText(file, `# Commit Evidence\n\n- status: recorded\n- final head: ${head || "unknown"}\n- commit set: ${commitSet.join(", ")}\n\n## Commits\n\n${commitSet.map((hash) => `- ${hash}: ${hash === head ? "current HEAD" : "run evidence"}`).join("\n")}\n`);
  updateRunFile(cwd, runId, {
    commit_hashes: commitSet,
    commit_set: commitSet,
    implementation_commit: explicitWithoutHead[0] || commitSet[0],
    final_head: head || commitSet.at(-1),
    archive_commit: head || commitSet.at(-1),
    commit_evidence: file
  });
  return file;
}

export function reconcilePush(cwd: string, runId: string): string {
  const dir = runDir(cwd, runId);
  const evidence = ensureEvidenceDir(dir);
  const file = path.join(evidence, "push.md");
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  const localHead = git(cwd, ["rev-parse", "HEAD"]).stdout.trim() || "unknown";
  if (remote.code !== 0 || !remote.stdout.trim()) {
    writeText(file, `# Push Evidence\n\n- status: push_blocked_no_remote\n- local commit: ${localHead}\n- user action: configure origin remote before remote delivery\n`);
    updateRunFile(cwd, runId, { push_status: "push_blocked_no_remote", push_local_commit: localHead, pushed_head: undefined, push_evidence: file });
    return file;
  }
  const status = readJson<RunMetadata>(runFile(cwd, runId)).push_status || "remote_configured_not_pushed_by_reconcile";
  writeText(file, `# Push Evidence\n\n- status: ${status}\n- remote: ${remote.stdout.trim()}\n- local commit: ${localHead}\n`);
  updateRunFile(cwd, runId, { push_status: status, push_local_commit: localHead, pushed_head: status === "pushed" ? localHead : undefined, push_evidence: file });
  return file;
}

function requirementText(dir: string): string {
  return [
    readText(path.join(dir, "request", "normalized.md")),
    readText(path.join(dir, "request", "input.md"))
  ].join("\n").toLowerCase();
}

function existsAny(cwd: string, files: string[]): boolean {
  return files.some((file) => fs.existsSync(path.join(cwd, file)));
}

function countExisting(cwd: string, files: string[]): number {
  return files.filter((file) => fs.existsSync(path.join(cwd, file))).length;
}

interface AcceptanceItem {
  id: string;
  category: "product_shape" | "architecture" | "persistence" | "frontend_surface" | "backend_api" | "tests" | "git_delivery" | "archive_evidence";
  requirement_level: "required" | "negotiable";
  classification: "required" | "negotiable" | "demo-substitute" | "deviation";
  status: "pass" | "blocked";
  detail: string;
  expected: string;
  observed: string;
  accepted_by_review: boolean;
  evidence: string[];
}

function matrixItem(input: {
  id: string;
  category: AcceptanceItem["category"];
  required: boolean;
  passed: boolean;
  detail: string;
  expected: string;
  observed: string;
  evidence?: string[];
  substitute?: boolean;
  deviation?: boolean;
  accepted?: boolean;
}): AcceptanceItem {
  const classification: AcceptanceItem["classification"] = input.passed
    ? input.required ? "required" : "negotiable"
    : input.substitute ? "demo-substitute" : input.deviation ? "deviation" : input.required ? "required" : "negotiable";
  return {
    id: input.id,
    category: input.category,
    requirement_level: input.required ? "required" : "negotiable",
    classification,
    status: input.passed || !input.required || input.accepted ? "pass" : "blocked",
    detail: input.detail,
    expected: input.expected,
    observed: input.observed,
    accepted_by_review: input.accepted === true,
    evidence: input.evidence || []
  };
}

export function writeAcceptanceMatrix(cwd: string, runId: string): string {
  const dir = runDir(cwd, runId);
  const text = requirementText(dir);
  const requiresMiniProgram = text.includes("小程序") || text.includes("mini-program");
  const requiresAdmin = text.includes("管理后台") || text.includes("admin");
  const requiresDatabase = text.includes("数据库") || text.includes("schema");
  const requiresFrontendBackend = text.includes("前后端") || text.includes("front/back") || requiresMiniProgram || requiresAdmin;
  const requiresSystemDocs = requiresDatabase || requiresFrontendBackend || text.includes("文档") || text.includes("documentation");
  const hasMiniProgram = existsAny(cwd, ["frontend/miniprogram/app.json", "frontend/miniprogram/app.js"]);
  const hasStaticFrontend = existsAny(cwd, ["frontend/index.html", "frontend/app.js"]);
  const hasAdminDirectory = fs.existsSync(path.join(cwd, "frontend", "admin"));
  const adminPageCount = hasAdminDirectory
    ? fs.readdirSync(path.join(cwd, "frontend", "admin")).filter((file) => file.endsWith(".html")).length
    : 0;
  const hasBackend = fs.existsSync(path.join(cwd, "backend"));
  const hasDbSchema = existsAny(cwd, ["backend/db/schema.sql", "backend/src/main/resources/schema.sql", "docs/database.md", "docs/database-schema.md"]);
  const hasDbRuntime = fs.existsSync(path.join(cwd, "backend", "db")) || text.includes("in-memory") === false && existsAny(cwd, ["backend/app/database.py", "backend/database.py"]);
  const hasBackendApi = existsAny(cwd, [
    "backend/app/server.py",
    "backend/app/handlers.py",
    "backend/server.py",
    "backend/api.py",
    "backend/src/main/java/com/imfine/studyroom/StudyRoomServer.java",
    "backend/src/main/java/com/imfine/studyroom/App.java",
    "docs/api.md"
  ]);
  const backendTestFiles = [
    "backend/run-tests.sh",
    "backend/tests/test_api.py",
    "backend/src/test/java/com/imfine/studyroom/BackendTestRunner.java"
  ];
  const documentationFiles = ["README.md", "docs/api.md", "docs/database-schema.md", "docs/verification.md"];
  const frontendContractFiles = [
    "tests/frontend-contract.test.js",
    "tests/frontend-contract.mjs",
    "tests/frontend_contract.py",
    "frontend/tests/contract.test.js",
    "playwright.config.js",
    "playwright.config.ts"
  ];
  const archiveEvidence = [
    path.join(dir, "archive", "archive-report.md"),
    path.join(dir, "agents", "archive", "handoff.json")
  ];
  const commitCount = gitCommitRecords(cwd).length;
  const items = [
    matrixItem({
      id: "product_shape.user-mini-program",
      category: "product_shape",
      required: requiresMiniProgram,
      passed: hasMiniProgram,
      substitute: !hasMiniProgram && hasStaticFrontend,
      detail: requiresMiniProgram ? "user requested mini-program-style frontend" : "not explicitly required",
      expected: "frontend/miniprogram app files",
      observed: hasMiniProgram ? "mini-program files present" : hasStaticFrontend ? "static frontend substitute present" : "missing user frontend",
      evidence: ["frontend/miniprogram/app.json", "frontend/miniprogram/app.js"].filter((file) => fs.existsSync(path.join(cwd, file)))
    }),
    matrixItem({
      id: "frontend_surface.admin-console",
      category: "frontend_surface",
      required: requiresAdmin,
      passed: hasAdminDirectory && adminPageCount >= 2,
      substitute: !hasAdminDirectory && hasStaticFrontend,
      detail: requiresAdmin ? "admin console requested" : "not explicitly required",
      expected: "dedicated admin console pages",
      observed: hasAdminDirectory ? `${adminPageCount} admin html page(s)` : hasStaticFrontend ? "single static page substitute" : "missing admin UI",
      evidence: hasAdminDirectory ? [path.join("frontend", "admin")] : []
    }),
    matrixItem({
      id: "architecture.front-back-separated",
      category: "architecture",
      required: requiresFrontendBackend,
      passed: fs.existsSync(path.join(cwd, "frontend")) && hasBackend,
      detail: "front/back separated project structure",
      expected: "separate frontend and backend directories",
      observed: `${fs.existsSync(path.join(cwd, "frontend")) ? "frontend present" : "frontend missing"}, ${hasBackend ? "backend present" : "backend missing"}`,
      evidence: ["frontend", "backend"].filter((file) => fs.existsSync(path.join(cwd, file)))
    }),
    matrixItem({
      id: "persistence.database-schema",
      category: "persistence",
      required: requiresDatabase,
      passed: hasDbSchema,
      detail: requiresDatabase ? "database schema requested" : "not explicitly required",
      expected: "schema SQL or database schema documentation",
      observed: hasDbSchema ? "database schema evidence present" : "database schema missing",
      evidence: ["backend/db/schema.sql", "backend/src/main/resources/schema.sql", "docs/database.md", "docs/database-schema.md"].filter((file) => fs.existsSync(path.join(cwd, file)))
    }),
    matrixItem({
      id: "persistence.runtime-storage",
      category: "persistence",
      required: requiresDatabase,
      passed: hasDbRuntime,
      substitute: hasDbSchema && !hasDbRuntime,
      detail: "runtime persistence implementation",
      expected: "database-backed runtime storage",
      observed: hasDbRuntime ? "runtime database/storage implementation present" : hasDbSchema ? "schema-only substitute" : "runtime storage missing",
      evidence: ["backend/db", "backend/app/database.py", "backend/database.py"].filter((file) => fs.existsSync(path.join(cwd, file)))
    }),
    matrixItem({
      id: "backend_api.surface",
      category: "backend_api",
      required: true,
      passed: hasBackendApi,
      detail: "backend API surface",
      expected: "server/handler implementation or API documentation",
      observed: hasBackendApi ? "backend API evidence present" : "backend API evidence missing",
      evidence: ["backend/app/server.py", "backend/app/handlers.py", "backend/server.py", "backend/api.py", "backend/src/main/java/com/imfine/studyroom/StudyRoomServer.java", "backend/src/main/java/com/imfine/studyroom/App.java", "docs/api.md"].filter((file) => fs.existsSync(path.join(cwd, file)))
    }),
    matrixItem({
      id: "tests.backend",
      category: "tests",
      required: true,
      passed: countExisting(cwd, backendTestFiles) > 0,
      detail: "backend test command or test runner evidence",
      expected: "backend test runner",
      observed: countExisting(cwd, backendTestFiles) > 0 ? "backend tests present" : "backend tests missing",
      evidence: backendTestFiles.filter((file) => fs.existsSync(path.join(cwd, file)))
    }),
    matrixItem({
      id: "tests.frontend-contract",
      category: "tests",
      required: requiresFrontendBackend,
      passed: countExisting(cwd, frontendContractFiles) > 0,
      detail: requiresFrontendBackend ? "front/back contract or browser smoke verification" : "not explicitly required",
      expected: "frontend contract test or Playwright smoke",
      observed: countExisting(cwd, frontendContractFiles) > 0 ? "frontend contract/smoke evidence present" : "frontend contract/smoke evidence missing",
      evidence: frontendContractFiles.filter((file) => fs.existsSync(path.join(cwd, file)))
    }),
    matrixItem({
      id: "documentation.delivery-set",
      category: "archive_evidence",
      required: requiresSystemDocs,
      passed: documentationFiles.every((file) => fs.existsSync(path.join(cwd, file))),
      detail: requiresSystemDocs ? "system delivery documentation" : "not explicitly required",
      expected: "README.md, docs/api.md, docs/database-schema.md, docs/verification.md",
      observed: `${countExisting(cwd, documentationFiles)}/${documentationFiles.length} documentation file(s) present`,
      evidence: documentationFiles.filter((file) => fs.existsSync(path.join(cwd, file)))
    }),
    matrixItem({
      id: "git_delivery.commits",
      category: "git_delivery",
      required: true,
      passed: commitCount > 0,
      detail: "git delivery evidence",
      expected: "at least one git commit",
      observed: `${commitCount} commit(s) detected`,
      evidence: []
    }),
    matrixItem({
      id: "archive_evidence.final-archive",
      category: "archive_evidence",
      required: true,
      passed: archiveEvidence.every((file) => fs.existsSync(file)),
      detail: "archive handoff and final report evidence",
      expected: "archive report, final report, and archive handoff",
      observed: `${archiveEvidence.filter((file) => fs.existsSync(file)).length}/${archiveEvidence.length} archive evidence file(s) present`,
      evidence: archiveEvidence.filter((file) => fs.existsSync(file))
    })
  ];
  const file = path.join(dir, "orchestration", "acceptance-matrix.json");
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    summary: {
      required: items.filter((item) => item.requirement_level === "required").length,
      negotiable: items.filter((item) => item.requirement_level === "negotiable").length,
      demo_substitute: items.filter((item) => item.classification === "demo-substitute").length,
      deviations: items.filter((item) => item.classification === "deviation").length,
      blocked: items.filter((item) => item.status === "blocked").length
    },
    items
  }, null, 2)}\n`);
  return file;
}

function gate(id: string, passed: boolean, detail: string): ReconcileGate {
  return { id, status: passed ? "pass" : "blocked", detail };
}

function fileGate(dir: string, id: string, relative: string): ReconcileGate {
  const file = path.join(dir, relative);
  return gate(id, fs.existsSync(file), file);
}

function acceptanceGate(file: string): ReconcileGate {
  if (!fs.existsSync(file)) return gate("acceptance_matrix", false, file);
  const matrix = readJson<{ items?: Array<{ status?: string; id?: string; classification?: string; accepted_by_review?: boolean }> }>(file);
  const blocked = Array.isArray(matrix.items) ? matrix.items.filter((item) => item.status === "blocked") : [];
  return gate("acceptance_matrix", blocked.length === 0, blocked.length ? blocked.map((item) => item.id).join(", ") : file);
}

interface StructuredBlocker {
  id: string;
  source: string;
  owner: string;
  summary: string;
  required_evidence: string[];
  review_close_action: string;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function blockerFromUnknown(source: string, index: number, value: unknown): StructuredBlocker | null {
  if (typeof value === "string" && value.trim()) {
    const id = safeId(`${source}-${index + 1}`);
    return {
      id,
      source,
      owner: "orchestrator",
      summary: value.trim(),
      required_evidence: [`evidence/fix-${id}.md`],
      review_close_action: `close-${id}`
    };
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === "string"
    ? record.summary
    : typeof record.detail === "string"
      ? record.detail
      : typeof record.reason === "string"
        ? record.reason
        : "";
  if (!summary.trim()) return null;
  const id = safeId(typeof record.id === "string" ? record.id : `${source}-${index + 1}`);
  const evidence = Array.isArray(record.required_evidence)
    ? record.required_evidence.filter((item): item is string => typeof item === "string")
    : [`evidence/fix-${id}.md`];
  return {
    id,
    source,
    owner: typeof record.owner === "string" ? record.owner : "orchestrator",
    summary: summary.trim(),
    required_evidence: evidence,
    review_close_action: typeof record.review_close_action === "string" ? record.review_close_action : `close-${id}`
  };
}

function reportLineBlockers(file: string, source: string): StructuredBlocker[] {
  if (!fs.existsSync(file)) return [];
  return readText(file)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /blocker|blocked|阻塞|缺少|错误|403|CRUD|举报/.test(line))
    .slice(0, 20)
    .map((line, index) => blockerFromUnknown(source, index, line))
    .filter((item): item is StructuredBlocker => Boolean(item));
}

function collectStructuredBlockers(cwd: string, runId: string): StructuredBlocker[] {
  const dir = runDir(cwd, runId);
  const blockers: StructuredBlocker[] = [];
  const structuredFiles = [
    path.join(dir, "review", "blockers.json"),
    path.join(dir, "review", "qa-blockers.json"),
    path.join(dir, "review", "review-blockers.json"),
    path.join(dir, "review", "risk-blockers.json"),
    path.join(dir, "orchestration", "state-blockers.json")
  ];
  for (const file of structuredFiles) {
    if (!fs.existsSync(file)) continue;
    const parsed = readJson<{ blockers?: unknown[] } | unknown[]>(file);
    const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed.blockers) ? parsed.blockers : [];
    values.forEach((value, index) => {
      const blocker = blockerFromUnknown(path.basename(file, ".json"), index, value);
      if (blocker) blockers.push(blocker);
    });
  }
  blockers.push(...reportLineBlockers(path.join(dir, "review", "qa-report.md"), "qa"));
  blockers.push(...reportLineBlockers(path.join(dir, "review", "code-review.md"), "reviewer"));
  blockers.push(...reportLineBlockers(path.join(dir, "review", "risk-review.md"), "risk-reviewer"));

  const agentsDir = path.join(dir, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const agent of fs.readdirSync(agentsDir)) {
      const handoffFile = path.join(agentsDir, agent, "handoff.json");
      if (!fs.existsSync(handoffFile)) continue;
      const handoff = readJson<Record<string, unknown>>(handoffFile);
      const values = Array.isArray(handoff.blocked_items) ? handoff.blocked_items : [];
      values.forEach((value, index) => {
        const blocker = blockerFromUnknown(`handoff-${agent}`, index, value);
        if (blocker) blockers.push(blocker);
      });
    }
  }

  const unique = new Map<string, StructuredBlocker>();
  for (const blocker of blockers) unique.set(blocker.id, blocker);
  const file = path.join(dir, "orchestration", "structured-blockers.json");
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    blockers: Array.from(unique.values())
  }, null, 2)}\n`);
  return Array.from(unique.values());
}

function writeFixTasks(cwd: string, runId: string, gates: ReconcileGate[], structuredBlockers: StructuredBlocker[]): string[] {
  const dir = runDir(cwd, runId);
  const files: string[] = [];
  for (const gateItem of gates.filter((item) => item.status === "blocked")) {
    const taskId = `FIX-${safeId(gateItem.id)}`;
    const taskDir = path.join(dir, "tasks", taskId);
    ensureDir(taskDir);
    const statusFile = path.join(taskDir, "status.json");
    const taskFile = path.join(taskDir, "task.md");
    writeText(statusFile, `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      task_id: taskId,
      status: "blocked",
      blocker_id: gateItem.id,
      required_evidence: gateItem.detail,
      review_close_action: `close-${taskId}`,
      updated_at: new Date().toISOString()
    }, null, 2)}\n`);
    writeText(taskFile, `# ${taskId}\n\n- blocker: ${gateItem.id}\n- required evidence: ${gateItem.detail}\n- owner: orchestrator\n- close action: close-${taskId}\n`);
    files.push(statusFile, taskFile);
  }
  for (const blocker of structuredBlockers) {
    const taskId = `FIX-${blocker.id}`;
    const taskDir = path.join(dir, "tasks", taskId);
    ensureDir(taskDir);
    const statusFile = path.join(taskDir, "status.json");
    const taskFile = path.join(taskDir, "task.md");
    writeText(statusFile, `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      task_id: taskId,
      status: "blocked",
      blocker_id: blocker.id,
      source: blocker.source,
      owner: blocker.owner,
      summary: blocker.summary,
      required_evidence: blocker.required_evidence,
      review_close_action: blocker.review_close_action,
      updated_at: new Date().toISOString()
    }, null, 2)}\n`);
    writeText(taskFile, `# ${taskId}\n\n- blocker: ${blocker.id}\n- source: ${blocker.source}\n- owner: ${blocker.owner}\n- summary: ${blocker.summary}\n- required evidence: ${blocker.required_evidence.join(", ")}\n- close action: ${blocker.review_close_action}\n`);
    files.push(statusFile, taskFile);
  }
  return files;
}

function writeBlockerMatrix(cwd: string, runId: string, gates: ReconcileGate[], structuredBlockers: StructuredBlocker[]): string {
  const dir = runDir(cwd, runId);
  const reviewDir = path.join(dir, "review");
  ensureDir(reviewDir);
  const run = readJson<RunMetadata>(runFile(cwd, runId));
  const file = path.join(reviewDir, "blocker-matrix.json");
  const gateRows = gates
    .filter((item) => item.status === "blocked")
    .map((item) => ({
      id: item.id,
      source: "final-gates",
      severity: "P0",
      status: "still_blocking",
      summary: item.detail,
      code_evidence: [],
      test_evidence: item.id === "qa" ? ["evidence/test-results.md"] : [],
      commit: run.final_head || null,
      recheck: "blocked by final gate"
    }));
  const structuredRows = structuredBlockers.map((blocker) => ({
    id: blocker.id,
    source: blocker.source,
    severity: "P1",
    status: "still_blocking",
    summary: blocker.summary,
    code_evidence: blocker.required_evidence,
    test_evidence: [],
    commit: run.final_head || null,
    recheck: blocker.review_close_action
  }));
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    final_head: run.final_head || null,
    rows: [...gateRows, ...structuredRows],
    summary: {
      total: gateRows.length + structuredRows.length,
      still_blocking: gateRows.length + structuredRows.length,
      resolved: 0,
      accepted_residual: 0,
      obsolete: 0
    }
  }, null, 2)}\n`);
  return file;
}

function writeFinalReport(cwd: string, runId: string, status: ReconcileResult["status"], gates: ReconcileGate[], acceptanceFile: string, structuredBlockers: StructuredBlocker[], blockerMatrix: string): string {
  const dir = runDir(cwd, runId);
  const reportDir = path.join(dir, "archive");
  ensureDir(reportDir);
  const report = path.join(reportDir, "final-report.md");
  const acceptance = fs.existsSync(acceptanceFile)
    ? readJson<{ items?: AcceptanceItem[] }>(acceptanceFile)
    : {};
  const items = Array.isArray(acceptance.items) ? acceptance.items : [];
  const required = items.filter((item) => item.requirement_level === "required");
  const negotiable = items.filter((item) => item.requirement_level === "negotiable");
  const substitutions = items.filter((item) => item.classification === "demo-substitute");
  const deviations = items.filter((item) => item.classification === "deviation" || item.status === "blocked");
  const renderItems = (values: AcceptanceItem[]) => values.length > 0
    ? values.map((item) => `- ${item.id}: ${item.status}; classification=${item.classification}; expected=${item.expected}; observed=${item.observed}; QA/Review accepted=${item.accepted_by_review ? "yes" : "no"}`).join("\n")
    : "- none";
  writeText(report, `# Final Report\n\n- run: ${runId}\n- status: ${status}\n- blocker matrix: ${blockerMatrix}\n\n## Gates\n\n${gates.map((item) => `- ${item.id}: ${item.status} (${item.detail})`).join("\n")}\n\n## Required\n\n${renderItems(required)}\n\n## Negotiable\n\n${renderItems(negotiable)}\n\n## Demo Substitute\n\n${renderItems(substitutions)}\n\n## Deviation\n\n${renderItems(deviations)}\n\n## QA Review Acceptance\n\n${items.length > 0 ? items.map((item) => `- ${item.id}: ${item.accepted_by_review ? "accepted" : "not accepted"}`).join("\n") : "- none"}\n\n## Structured Blockers\n\n${structuredBlockers.length > 0 ? structuredBlockers.map((blocker) => `- ${blocker.id}: owner=${blocker.owner}; evidence=${blocker.required_evidence.join(", ")}; close=${blocker.review_close_action}; summary=${blocker.summary}`).join("\n") : "- none"}\n`);
  return report;
}

function archiveGate(dir: string): ReconcileGate {
  const required = [
    path.join(dir, "archive", "archive-report.md"),
    path.join(dir, "agents", "archive", "status.json"),
    path.join(dir, "agents", "archive", "handoff.json")
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) return gate("archive", false, missing.join(", "));
  const status = readJson<{ status?: unknown }>(path.join(dir, "agents", "archive", "status.json"));
  return gate("archive", status.status === "completed", status.status === "completed" ? required.join(", ") : `archive status=${String(status.status)}`);
}

function projectKnowledgeGate(cwd: string): ReconcileGate {
  const projectDir = path.join(cwd, ".imfine", "project");
  ensureDir(projectDir);
  const required = ["overview.md", "product.md", "architecture.md", "test-strategy.md"];
  const missing = required.filter((file) => !fs.existsSync(path.join(projectDir, file)));
  const staleMarkers = ["initialized from limited evidence", "not detected", "unknown", ".gitignore only", "no source evidence", "no test evidence"];
  const stale: Array<{ file: string; marker: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && file.endsWith(".md")) {
        const text = readText(file).toLowerCase();
        for (const marker of staleMarkers) {
          if (text.includes(marker)) stale.push({ file: path.relative(cwd, file), marker });
        }
      }
    }
  };
  walk(projectDir);
  const freshness = path.join(projectDir, "project-knowledge-freshness.json");
  writeText(freshness, `${JSON.stringify({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: missing.length === 0 && stale.length === 0 ? "fresh" : "stale_or_incomplete",
    missing: missing.map((file) => path.join(projectDir, file)),
    stale
  }, null, 2)}\n`);
  if (missing.length > 0) return gate("project_knowledge", false, missing.map((file) => path.join(projectDir, file)).join(", "));
  return gate("project_knowledge", stale.length === 0, stale.length > 0 ? stale.map((item) => `${item.file}:${item.marker}`).join(", ") : freshness);
}

export function finalizeRun(cwd: string, runId: string): ReconcileResult {
  const dir = runDir(cwd, runId);
  collectStandardEvidence(cwd, runId);
  const structuredBlockers = collectStructuredBlockers(cwd, runId);
  const commitEvidence = reconcileCommits(cwd, runId);
  const pushEvidence = reconcilePush(cwd, runId);
  const acceptance = writeAcceptanceMatrix(cwd, runId);
  const harnessFiles = writeTrueHarnessEvidence(cwd, runId);
  const harness = harnessFiles.json;
  const harnessPayload = readJson<{ true_harness_passed?: boolean }>(harness);
  const harnessConsistency = validateTrueHarnessEvidenceFiles(harnessFiles.json, harnessFiles.markdown);
  const planningPassed = fs.existsSync(path.join(dir, "analysis", "project-context.md"))
    && fs.existsSync(path.join(dir, "orchestration", "context.json"))
    && fs.existsSync(path.join(dir, "planning", "task-graph.json"));
  const taskGraphExists = fs.existsSync(path.join(dir, "planning", "task-graph.json"));
  const fixTasks = fs.existsSync(path.join(dir, "tasks"))
    ? fs.readdirSync(path.join(dir, "tasks")).filter((item) => item.startsWith("FIX-"))
    : [];
  const gates: ReconcileGate[] = [
    gate("planning", planningPassed, "analysis/project-context.md, orchestration/context.json, planning/task-graph.json"),
    gate("dispatch", harnessPayload.true_harness_passed === true && harnessConsistency.passed, harnessConsistency.passed ? harness : harnessConsistency.errors.join("; ")),
    fileGate(dir, "qa", "evidence/test-results.md"),
    fileGate(dir, "review", "evidence/review.md"),
    gate("recheck_fix_loop", taskGraphExists && fixTasks.length === 0, !taskGraphExists ? "missing planning/task-graph.json" : fixTasks.length === 0 ? "no open FIX tasks" : fixTasks.join(", ")),
    fileGate(dir, "risk_review", "evidence/risk-review.md"),
    gate("commit", Boolean(commitEvidence), commitEvidence || "missing commit evidence"),
    gate("committer", Boolean(commitEvidence), commitEvidence || "missing commit evidence"),
    gate("push", Boolean(pushEvidence), pushEvidence),
    archiveGate(dir),
    acceptanceGate(acceptance),
    gate("true_harness", harnessPayload.true_harness_passed === true && harnessConsistency.passed, harnessConsistency.passed ? harness : harnessConsistency.errors.join("; ")),
    projectKnowledgeGate(cwd)
  ];
  const finalGates = path.join(dir, "orchestration", "final-gates.json");
  const status: ReconcileResult["status"] = gates.every((item) => item.status === "pass") ? "completed" : "blocked";
  const blockerMatrix = writeBlockerMatrix(cwd, runId, gates, structuredBlockers);
  const fixTaskFiles = status === "blocked" ? writeFixTasks(cwd, runId, gates, structuredBlockers) : [];
  const finalReport = writeFinalReport(cwd, runId, status, gates, acceptance, structuredBlockers, blockerMatrix);
  writeText(finalGates, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_by: "imfine-runtime",
    generated_at: new Date().toISOString(),
    gates: Object.fromEntries(gates.map((item) => [item.id, item.status])),
    checks: gates
  }, null, 2)}\n`);
  if (status === "completed") {
    assertTransitionAccepted(transitionRunState(cwd, runId, "archiving", { archiving_at: new Date().toISOString(), final_gates: finalGates }), `finalize archive ${runId}`);
    assertTransitionAccepted(transitionRunState(cwd, runId, "completed", { completed_at: new Date().toISOString(), final_gates: finalGates }), `finalize run ${runId}`);
  } else {
    const transition = transitionRunState(cwd, runId, "blocked", { blocked_at: new Date().toISOString(), blocked_reason: "finalize gates blocked", final_gates: finalGates });
    if (!transition.accepted) {
      updateRunFile(cwd, runId, {
        status: "blocked",
        blocked_at: new Date().toISOString(),
        blocked_reason: "reconcile overrode non-authoritative completed status because final gates blocked",
        final_gates: finalGates
      });
    }
  }
  return {
    runId,
    status,
    gates,
    files: [finalGates, acceptance, harness, commitEvidence, pushEvidence, finalReport, blockerMatrix, ...fixTaskFiles].filter((file): file is string => Boolean(file))
  };
}

export function reconcileRun(cwd: string, runId: string): ReconcileResult {
  return finalizeRun(cwd, runId);
}
