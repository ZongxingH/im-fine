import fs from "node:fs";
import path from "node:path";
import { validateRuntimeFinalGates } from "./final-gates.js";
import { ensureDir, writeText } from "./fs.js";
import { writeHarnessComponents } from "./harness-components.js";
import { ingestOrchestratorSession } from "./orchestrator.js";
import { writeQualityLineage } from "./quality-lineage.js";
import { writeRuntimeRequirements } from "./runtime-requirements.js";
import { readRolePurityAudit, writeRolePurityAudit } from "./role-purity.js";
import { writeHarnessDebuggerReport } from "./harness-debugger.js";
import { staleTrueHarnessEvidence, validateTrueHarnessEvidenceFiles, writeTrueHarnessEvidence } from "./true-harness-evidence.js";
import { runCommand } from "./shell.js";
import { assertTransitionAccepted, transitionRunState } from "./state-machine.js";
import { appendRuntimeTraceEvent, appendRuntimeTraceEvents, runtimeTraceFiles } from "./trace-events.js";

export interface ReconcileGate {
  id: string;
  component_id: string;
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
  commit_blocked_reason?: string;
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

interface StandardEvidenceRecord {
  id: string;
  standard_path: string;
  exists: boolean;
  sources: string[];
}

function copyReportIfExists(source: string, target: string, title: string): string | null {
  if (!fs.existsSync(source) || fs.existsSync(target)) return fs.existsSync(target) ? target : null;
  writeText(target, `# ${title}\n\nSource: ${source}\n\n${readText(source).trim()}\n`);
  return target;
}

function collectReferencedEvidence(cwd: string, dir: string, target: string, title: string, matcher: (file: string) => boolean): { file: string | null; sources: string[] } {
  if (fs.existsSync(target)) return { file: target, sources: [] };
  const agentsDir = path.join(dir, "agents");
  if (!fs.existsSync(agentsDir)) return { file: null, sources: [] };
  const references: string[] = [];
  for (const agent of fs.readdirSync(agentsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    const handoffFile = path.join(agentsDir, agent, "handoff.json");
    if (!fs.existsSync(handoffFile)) continue;
    const handoff = readJson<{ evidence?: unknown[] }>(handoffFile);
    const evidence = Array.isArray(handoff.evidence) ? handoff.evidence.filter((item): item is string => typeof item === "string") : [];
    for (const item of evidence) {
      const absolute = path.isAbsolute(item) ? item : path.resolve(cwd, item);
      if (fs.existsSync(absolute) && matcher(absolute)) references.push(absolute);
    }
  }
  if (references.length === 0) return { file: null, sources: [] };
  writeText(target, `# ${title}\n\nIndexed from standard handoff evidence references.\n\n${references.map((file) => `## ${path.relative(cwd, file)}\n\n${readText(file).trim()}`).join("\n\n")}\n`);
  return { file: target, sources: references };
}

export function collectStandardEvidence(cwd: string, runId: string): string[] {
  const dir = runDir(cwd, runId);
  const evidence = ensureEvidenceDir(dir);
  const targets = [
    { id: "qa", file: path.join(evidence, "test-results.md"), title: "Test Results", reviewSource: path.join(dir, "review", "qa-report.md"), matcher: (file: string) => /qa|test|result/i.test(file) },
    { id: "review", file: path.join(evidence, "review.md"), title: "Review Evidence", reviewSource: path.join(dir, "review", "code-review.md"), matcher: (file: string) => /review/i.test(file) && !/risk/i.test(file) },
    { id: "risk_review", file: path.join(evidence, "risk-review.md"), title: "Risk Review Evidence", reviewSource: path.join(dir, "review", "risk-review.md"), matcher: (file: string) => /risk/i.test(file) },
    { id: "commit", file: path.join(evidence, "commits.md"), title: "Commit Evidence", reviewSource: null, matcher: (file: string) => /commit/i.test(file) },
    { id: "push", file: path.join(evidence, "push.md"), title: "Push Evidence", reviewSource: null, matcher: (file: string) => /push/i.test(file) }
  ];
  const files: string[] = [];
  const records: StandardEvidenceRecord[] = [];
  for (const target of targets) {
    const sources: string[] = [];
    if (target.reviewSource) {
      const copied = copyReportIfExists(target.reviewSource, target.file, target.title);
      if (copied) sources.push(target.reviewSource);
    }
    const collected = collectReferencedEvidence(cwd, dir, target.file, target.title, target.matcher);
    if (collected.file) files.push(collected.file);
    sources.push(...collected.sources);
    if (fs.existsSync(target.file) && !files.includes(target.file)) files.push(target.file);
    records.push({
      id: target.id,
      standard_path: path.relative(cwd, target.file),
      exists: fs.existsSync(target.file),
      sources: Array.from(new Set(sources.map((file) => path.relative(cwd, file))))
    });
  }
  writeText(path.join(dir, "orchestration", "standard-evidence.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    records
  }, null, 2)}\n`);
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

function gitRepositoryAvailable(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).code === 0;
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
  if (!gitRepositoryAvailable(cwd)) {
    writeText(file, "# Commit Evidence\n\n- status: blocked_no_git_repository\n- user action: initialize git repository or provide explicit commit evidence before finalization\n");
    updateRunFile(cwd, runId, {
      commit_blocked_reason: "git repository is not initialized",
      commit_evidence: file
    });
    return null;
  }
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
  if (commitSet.length === 0) {
    writeText(file, "# Commit Evidence\n\n- status: blocked_no_commit\n- user action: create or approve a runtime commit before finalization\n");
    updateRunFile(cwd, runId, {
      commit_blocked_reason: "missing commit hash",
      commit_evidence: file
    });
    return null;
  }
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

function validCommitEvidence(cwd: string, runId: string): { passed: boolean; detail: string } {
  const dir = runDir(cwd, runId);
  const run = readJson<RunMetadata>(runFile(cwd, runId));
  const file = path.join(dir, "evidence", "commits.md");
  if (!fs.existsSync(file)) return { passed: false, detail: "missing commit evidence" };
  const commits = uniqueStrings([
    ...(Array.isArray(run.commit_hashes) ? run.commit_hashes : []),
    ...(Array.isArray(run.commit_set) ? run.commit_set : []),
    run.commit_hash,
    run.final_head,
    run.implementation_commit,
    run.evidence_sync_commit,
    run.archive_commit,
    run.commit?.hash
  ]);
  if (commits.length === 0) return { passed: false, detail: run.commit_blocked_reason || "missing commit hash" };
  return { passed: true, detail: file };
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

interface AcceptanceItem {
  id: string;
  category: string;
  requirement_level: "required" | "negotiable";
  classification: "required" | "negotiable" | "demo-substitute" | "deviation";
  status: "pass" | "blocked";
  detail: string;
  expected: string;
  observed: string;
  accepted_by_review: boolean;
  evidence: string[];
  deviation?: {
    requested: string;
    delivered: string;
    reason: string;
    risk: string;
    accepted_by: string[];
    evidence: string[];
    required_follow_up: string[];
  };
}

interface AcceptanceSource {
  file: string;
  requiredCoverageDeclaredComplete: boolean;
  items: AcceptanceItem[];
  errors: string[];
}

function readAgentAcceptanceSources(dir: string): AcceptanceSource[] {
  const sources = [
    path.join(dir, "orchestration", "agent-acceptance-matrix.json"),
    path.join(dir, "agents", "product-planner", "acceptance-matrix.json"),
    path.join(dir, "agents", "architect", "acceptance-matrix.json"),
    path.join(dir, "agents", "qa", "acceptance-matrix.json"),
    path.join(dir, "agents", "reviewer", "acceptance-matrix.json")
  ];
  const result: AcceptanceSource[] = [];
  for (const file of sources) {
    if (!fs.existsSync(file)) continue;
    const parsed = readJson<{ required_coverage_declared_complete?: unknown; coverage?: { required_complete?: unknown }; items?: unknown[] }>(file);
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const source: AcceptanceSource = {
      file,
      requiredCoverageDeclaredComplete: parsed.required_coverage_declared_complete === true || parsed.coverage?.required_complete === true,
      items: [],
      errors: []
    };
    if (!source.requiredCoverageDeclaredComplete) {
      source.errors.push("agent matrix must declare required_coverage_declared_complete=true");
    }
    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") {
        source.errors.push("acceptance item must be an object");
        continue;
      }
      const item = raw as Partial<AcceptanceItem>;
      const errors: string[] = [];
      if (typeof item.id !== "string" || !item.id.trim()) errors.push("missing id");
      if (typeof item.category !== "string" || !item.category.trim()) errors.push("missing category");
      if (item.requirement_level !== "required" && item.requirement_level !== "negotiable") errors.push("invalid requirement_level");
      if (!["required", "negotiable", "demo-substitute", "deviation"].includes(String(item.classification))) errors.push("invalid classification");
      if (item.status !== "pass" && item.status !== "blocked") errors.push("invalid status");
      if (errors.length > 0) {
        source.errors.push(`invalid item ${typeof item.id === "string" ? item.id : "unknown"}: ${errors.join(", ")}`);
        continue;
      }
      source.items.push({
        id: item.id as string,
        category: item.category as string,
        requirement_level: item.requirement_level as AcceptanceItem["requirement_level"],
        classification: item.classification as AcceptanceItem["classification"],
        status: item.status as AcceptanceItem["status"],
        detail: typeof item.detail === "string" ? item.detail : "",
        expected: typeof item.expected === "string" ? item.expected : "",
        observed: typeof item.observed === "string" ? item.observed : "",
        accepted_by_review: item.accepted_by_review === true,
        evidence: Array.isArray(item.evidence) ? item.evidence.filter((entry): entry is string => typeof entry === "string") : [],
        deviation: isObject((item as Record<string, unknown>).deviation)
          ? normalizeDeviation((item as Record<string, unknown>).deviation as Record<string, unknown>)
          : undefined
      });
    }
    result.push(source);
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeDeviation(value: Record<string, unknown>): AcceptanceItem["deviation"] {
  return {
    requested: typeof value.requested === "string" ? value.requested : "",
    delivered: typeof value.delivered === "string" ? value.delivered : "",
    reason: typeof value.reason === "string" ? value.reason : "",
    risk: typeof value.risk === "string" ? value.risk : "",
    accepted_by: stringArray(value.accepted_by),
    evidence: stringArray(value.evidence),
    required_follow_up: stringArray(value.required_follow_up)
  };
}

export function writeAcceptanceMatrix(cwd: string, runId: string): string {
  const dir = runDir(cwd, runId);
  const sources = readAgentAcceptanceSources(dir);
  const items = sources.flatMap((source) => source.items);
  if (items.length === 0) {
    items.push({
      id: "agent_authored_acceptance_matrix.missing",
      category: "acceptance_contract",
      requirement_level: "required",
      classification: "required",
      status: "blocked",
      detail: "Agent-authored acceptance matrix is required; runtime does not infer product shape from requirement keywords.",
      expected: "Product Planner, Architect, QA, or Reviewer writes an acceptance matrix artifact.",
      observed: `No accepted source matrix found for request: ${requirementText(dir).trim().slice(0, 160) || "unknown"}`,
      accepted_by_review: false,
      evidence: []
    });
  }
  for (const source of sources.filter((item) => item.errors.length > 0)) {
    items.push({
      id: `agent_authored_acceptance_matrix.invalid.${path.basename(path.dirname(source.file))}.${path.basename(source.file, ".json")}`,
      category: "acceptance_contract",
      requirement_level: "required",
      classification: "required",
      status: "blocked",
      detail: source.errors.join("; "),
      expected: "Agent-authored matrix declares complete required coverage and contains valid schema items.",
      observed: source.file,
      accepted_by_review: false,
      evidence: []
    });
  }
  if (sources.length > 0 && !sources.some((source) => source.requiredCoverageDeclaredComplete)) {
    items.push({
      id: "agent_authored_acceptance_matrix.required_coverage_not_declared",
      category: "acceptance_contract",
      requirement_level: "required",
      classification: "required",
      status: "blocked",
      detail: "Runtime does not infer product requirements; an agent-authored matrix must declare required coverage complete.",
      expected: "required_coverage_declared_complete=true",
      observed: sources.map((source) => source.file).join(", "),
      accepted_by_review: false,
      evidence: []
    });
  }
  const missingEvidence = (files: string[]): string[] => files.filter((file) => !fs.existsSync(path.isAbsolute(file) ? file : path.join(cwd, file)));
  for (const item of items) {
    if ((item.classification === "deviation" || item.classification === "demo-substitute") && item.requirement_level === "required") {
      const deviation = item.deviation;
      const missingDeviationFields = !deviation
        ? ["deviation"]
        : [
          deviation.requested ? "" : "requested",
          deviation.delivered ? "" : "delivered",
          deviation.reason ? "" : "reason",
          deviation.risk ? "" : "risk",
          deviation.accepted_by.includes("qa") || deviation.accepted_by.includes("reviewer") ? "" : "accepted_by_qa_or_reviewer",
          deviation.evidence.length > 0 ? "" : "evidence",
          deviation.required_follow_up.length > 0 ? "" : "required_follow_up"
        ].filter(Boolean);
      const missingDeviationEvidence = deviation ? missingEvidence(deviation.evidence) : [];
      if (missingDeviationFields.length > 0 || !item.accepted_by_review || missingDeviationEvidence.length > 0) {
        item.status = "blocked";
        item.detail = `${item.detail}; deviation template incomplete, not accepted, or missing evidence: ${[...missingDeviationFields, ...missingDeviationEvidence].join(", ") || "not accepted"}`;
      }
    }
    if (item.requirement_level === "required" && item.status === "pass" && item.evidence.length === 0) {
      item.status = "blocked";
      item.detail = `${item.detail}; required item lacks evidence`;
    }
    const itemMissingEvidence = missingEvidence(item.evidence);
    if (itemMissingEvidence.length > 0) {
      item.status = "blocked";
      item.detail = `${item.detail}; missing evidence: ${itemMissingEvidence.join(", ")}`;
    }
  }
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
      sources: sources.length,
      required_coverage_declared_complete: sources.some((source) => source.requiredCoverageDeclaredComplete),
      blocked: items.filter((item) => item.status === "blocked").length
    },
    sources: sources.map((source) => ({
      file: source.file,
      required_coverage_declared_complete: source.requiredCoverageDeclaredComplete,
      item_count: source.items.length,
      errors: source.errors
    })),
    items
  }, null, 2)}\n`);
  return file;
}

function gate(id: string, componentId: string, passed: boolean, detail: string): ReconcileGate {
  return { id, component_id: componentId, status: passed ? "pass" : "blocked", detail };
}

function gateTraceInput(gateItem: ReconcileGate, finalGates: string) {
  return {
    source: "runtime.reconcile",
    componentId: gateItem.component_id,
    actionId: `gate.${gateItem.id}`,
    eventType: "gate_evaluated" as const,
    status: gateItem.status,
    reason: gateItem.detail,
    inputArtifacts: [gateItem.detail],
    outputArtifacts: [finalGates]
  };
}

function fileGate(dir: string, id: string, componentId: string, relative: string): ReconcileGate {
  const file = path.join(dir, relative);
  return gate(id, componentId, fs.existsSync(file), file);
}

function qualityLineageGate(id: "qa" | "review" | "recheck_fix_loop", qualityLineageFile: string): ReconcileGate {
  if (!fs.existsSync(qualityLineageFile)) return gate(id, "runtime.quality-lineage", false, qualityLineageFile);
  const quality = readJson<{ summary?: Record<string, unknown>; lineages?: Array<{ role?: string; status?: string; unresolved_findings?: string[]; invalid_rechecks?: unknown[] }> }>(qualityLineageFile);
  const status = quality.summary?.[id];
  const blocked = Array.isArray(quality.lineages)
    ? quality.lineages.filter((item) => {
      if (id === "qa" && item.role !== "qa") return false;
      if (id === "review" && item.role !== "reviewer") return false;
      return item.status !== "pass" || (Array.isArray(item.invalid_rechecks) && item.invalid_rechecks.length > 0);
    })
    : [];
  const detail = blocked.length > 0
    ? blocked.map((item) => `${item.role || "quality"} unresolved=${Array.isArray(item.unresolved_findings) ? item.unresolved_findings.join("|") : "unknown"}`).join(", ")
    : qualityLineageFile;
  return gate(id, "runtime.quality-lineage", status === "pass", detail);
}

function acceptanceGate(file: string): ReconcileGate {
  if (!fs.existsSync(file)) return gate("acceptance_matrix", "runtime.acceptance-matrix", false, file);
  const matrix = readJson<{ items?: Array<{ status?: string; id?: string; classification?: string; accepted_by_review?: boolean }> }>(file);
  const blocked = Array.isArray(matrix.items) ? matrix.items.filter((item) => item.status === "blocked") : [];
  return gate("acceptance_matrix", "runtime.acceptance-matrix", blocked.length === 0, blocked.length ? blocked.map((item) => item.id).join(", ") : file);
}

function rolePurityGate(cwd: string, runId: string): ReconcileGate {
  let audit = readRolePurityAudit(cwd, runId);
  const file = path.join(runDir(cwd, runId), "orchestration", "role-purity-audit.json");
  if (!audit) {
    writeRolePurityAudit(cwd, runId);
    audit = readRolePurityAudit(cwd, runId);
  }
  if (!audit) throw new Error(`Missing role purity audit after write: ${file}`);
  const violations = Array.isArray(audit.violations) ? audit.violations : [];
  return gate(
    "role_purity",
    "runtime.role-purity",
    audit.status === "pass",
    audit.status === "pass" ? file : violations.map((item) => `${item.id || "violation"}: ${item.reason || "blocked"}`).join("; ") || file
  );
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
  const run = readJson<RunMetadata>(runFile(cwd, runId));
  const commitHashes = uniqueStrings([
    ...(Array.isArray(run.commit_hashes) ? run.commit_hashes : []),
    ...(Array.isArray(run.commit_set) ? run.commit_set : []),
    run.commit_hash,
    run.final_head,
    run.implementation_commit,
    run.evidence_sync_commit,
    run.archive_commit,
    run.commit?.hash
  ]);
  const required = items.filter((item) => item.requirement_level === "required");
  const negotiable = items.filter((item) => item.requirement_level === "negotiable");
  const substitutions = items.filter((item) => item.classification === "demo-substitute");
  const deviations = items.filter((item) => item.classification === "deviation" || item.status === "blocked");
  const renderItems = (values: AcceptanceItem[]) => values.length > 0
    ? values.map((item) => `- ${item.id}: ${item.status}; classification=${item.classification}; expected=${item.expected}; observed=${item.observed}; QA/Review accepted=${item.accepted_by_review ? "yes" : "no"}`).join("\n")
    : "- none";
  const title = status === "completed" ? "Final Archive Report" : "Blocked Archive Report";
  const runtimeRequirements = path.join(dir, "orchestration", "runtime-requirements.json");
  writeText(report, `# ${title}\n\n- run: ${runId}\n- status: ${status}\n- blocker matrix: ${blockerMatrix}\n\n## Runtime Requirements\n\n- runtime requirements: ${fs.existsSync(runtimeRequirements) ? runtimeRequirements : "missing"}\n\n## Commit Trace\n\n- commit hashes: ${commitHashes.length > 0 ? commitHashes.join(", ") : "missing"}\n- final head: ${run.final_head || "missing"}\n- push status: ${run.push_status || "missing"}\n\n## Gates\n\n${gates.map((item) => `- ${item.id}: ${item.status} (${item.detail})`).join("\n")}\n\n## Required\n\n${renderItems(required)}\n\n## Negotiable\n\n${renderItems(negotiable)}\n\n## Demo Substitute\n\n${renderItems(substitutions)}\n\n## Deviation\n\n${renderItems(deviations)}\n\n## QA Review Acceptance\n\n${items.length > 0 ? items.map((item) => `- ${item.id}: ${item.accepted_by_review ? "accepted" : "not accepted"}`).join("\n") : "- none"}\n\n## Structured Blockers\n\n${structuredBlockers.length > 0 ? structuredBlockers.map((blocker) => `- ${blocker.id}: owner=${blocker.owner}; evidence=${blocker.required_evidence.join(", ")}; close=${blocker.review_close_action}; summary=${blocker.summary}`).join("\n") : "- none"}\n`);
  return report;
}

function archiveGate(dir: string): ReconcileGate {
  const required = [
    path.join(dir, "archive", "archive-report.md"),
    path.join(dir, "agents", "archive", "status.json"),
    path.join(dir, "agents", "archive", "handoff.json")
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) return gate("archive", "runtime.final-gates", false, missing.join(", "));
  const status = readJson<{ status?: unknown }>(path.join(dir, "agents", "archive", "status.json"));
  return gate("archive", "runtime.final-gates", status.status === "completed", status.status === "completed" ? required.join(", ") : `archive status=${String(status.status)}`);
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
  if (missing.length > 0) return gate("project_knowledge", "runtime.project-knowledge", false, missing.map((file) => path.join(projectDir, file)).join(", "));
  return gate("project_knowledge", "runtime.project-knowledge", stale.length === 0, stale.length > 0 ? stale.map((item) => `${item.file}:${item.marker}`).join(", ") : freshness);
}

function orchestratorRuntimeConsistencyGate(dir: string, runStatus: string | undefined, harnessFile: string): ReconcileGate {
  const orchestration = path.join(dir, "orchestration");
  const sessionFile = path.join(orchestration, "orchestrator-session.json");
  const finalGates = path.join(orchestration, "final-gates.json");
  const agentRunsFile = path.join(orchestration, "agent-runs.json");
  const dispatchFile = path.join(orchestration, "dispatch-contracts.json");
  const parallelFile = path.join(orchestration, "parallel-execution.json");
  const blockers: string[] = [];
  if (fs.existsSync(sessionFile)) {
    const session = readJson<{ status?: string }>(sessionFile);
    if (session.status === "completed" && runStatus !== "completed") blockers.push("orchestrator_session_unadopted");
    if (session.status === "completed" && !fs.existsSync(finalGates)) blockers.push("session_completed_without_final_gates");
  }
  if (fs.existsSync(harnessFile)) {
    const stale = staleTrueHarnessEvidence(harnessFile);
    if (stale.length > 0) blockers.push(`true_harness_evidence_stale: ${stale.join("; ")}`);
  }
  if (fs.existsSync(dispatchFile)) {
    const dispatch = readJson<{ contracts?: unknown[] }>(dispatchFile);
    const contracts = Array.isArray(dispatch.contracts) ? dispatch.contracts : [];
    if (contracts.length > 0 && fs.existsSync(agentRunsFile)) {
      const agentRuns = readJson<{ agents?: unknown[] }>(agentRunsFile);
      if (!Array.isArray(agentRuns.agents) || agentRuns.agents.length === 0) blockers.push("dispatch_contracts_without_agent_runs");
    }
    if (contracts.length > 0 && fs.existsSync(parallelFile)) {
      const parallel = readJson<{ wave_history?: unknown[] }>(parallelFile);
      if (!Array.isArray(parallel.wave_history) || parallel.wave_history.length === 0) blockers.push("dispatch_contracts_without_wave_history");
    }
  }
  return gate("orchestrator_runtime_consistency", "runtime.ingest-orchestrator-session", blockers.length === 0, blockers.length > 0 ? blockers.join(", ") : "runtime/session states consistent");
}

export function finalizeRun(cwd: string, runId: string): ReconcileResult {
  const dir = runDir(cwd, runId);
  ingestOrchestratorSession(cwd, runId, { writeHarnessEvidence: false });
  const orchestrationDir = path.join(dir, "orchestration");
  const sessionFile = path.join(orchestrationDir, "orchestrator-session.json");
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.reconcile",
    componentId: "runtime.ingest-orchestrator-session",
    actionId: "runtime.ingest_orchestrator_session",
    eventType: "ingest",
    status: "recorded",
    reason: fs.existsSync(sessionFile) ? "orchestrator session ingested" : "orchestrator session missing",
    inputArtifacts: [sessionFile],
    outputArtifacts: [
      path.join(orchestrationDir, "agent-runs.json"),
      path.join(orchestrationDir, "dispatch-contracts.json"),
      path.join(orchestrationDir, "parallel-execution.json")
    ]
  });
  const harnessComponents = writeHarnessComponents(cwd, runId);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.reconcile",
    componentId: "runtime.harness-evolution",
    actionId: "runtime.write_harness_components",
    eventType: "artifact_written",
    status: "recorded",
    reason: "harness component manifest written",
    outputArtifacts: [harnessComponents]
  });
  collectStandardEvidence(cwd, runId);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.reconcile",
    componentId: "runtime.standard-evidence",
    actionId: "runtime.collect_standard_evidence",
    eventType: "artifact_written",
    status: "recorded",
    reason: "standard evidence manifest written",
    outputArtifacts: [path.join(orchestrationDir, "standard-evidence.json")]
  });
  const qualityLineage = writeQualityLineage(cwd, runId);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.reconcile",
    componentId: "runtime.quality-lineage",
    actionId: "runtime.write_quality_lineage",
    eventType: "artifact_written",
    status: "recorded",
    reason: "quality lineage written",
    outputArtifacts: [qualityLineage]
  });
  const structuredBlockers = collectStructuredBlockers(cwd, runId);
  const commitEvidence = reconcileCommits(cwd, runId);
  const pushEvidence = reconcilePush(cwd, runId);
  const commitCheck = validCommitEvidence(cwd, runId);
  const acceptance = writeAcceptanceMatrix(cwd, runId);
  const runtimeRequirements = writeRuntimeRequirements(cwd, runId);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.reconcile",
    componentId: "runtime.runtime-requirements",
    actionId: "runtime.write_runtime_requirements",
    eventType: "artifact_written",
    status: runtimeRequirements.result.status === "pass" ? "pass" : "blocked",
    reason: runtimeRequirements.result.status === "pass"
      ? "runtime requirements passed"
      : runtimeRequirements.result.checks.filter((item) => item.status === "blocked").map((item) => `${item.id}: ${item.detail}`).join("; "),
    outputArtifacts: [runtimeRequirements.json, runtimeRequirements.markdown]
  });
  writeRolePurityAudit(cwd, runId);
  const harnessFiles = writeTrueHarnessEvidence(cwd, runId);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.reconcile",
    componentId: "runtime.true-harness-evidence",
    actionId: "runtime.write_true_harness_evidence",
    eventType: "artifact_written",
    status: "recorded",
    reason: "true harness evidence written before final gate evaluation",
    outputArtifacts: [harnessFiles.json, harnessFiles.markdown]
  });
  const harness = harnessFiles.json;
  const harnessPayload = readJson<{ true_harness_passed?: boolean }>(harness);
  const harnessConsistency = validateTrueHarnessEvidenceFiles(harnessFiles.json, harnessFiles.markdown);
  const runMetadata = readJson<RunMetadata>(runFile(cwd, runId));
  const planningPassed = fs.existsSync(path.join(dir, "analysis", "project-context.md"))
    && fs.existsSync(path.join(dir, "orchestration", "context.json"))
    && fs.existsSync(path.join(dir, "planning", "task-graph.json"));
  const taskGraphExists = fs.existsSync(path.join(dir, "planning", "task-graph.json"));
  const fixTasks = fs.existsSync(path.join(dir, "tasks"))
    ? fs.readdirSync(path.join(dir, "tasks")).filter((item) => item.startsWith("FIX-"))
    : [];
  const gates: ReconcileGate[] = [
    gate("planning", "runtime.planning-materialization", planningPassed, "analysis/project-context.md, orchestration/context.json, planning/task-graph.json"),
    gate("dispatch", "runtime.dispatch-contracts", harnessPayload.true_harness_passed === true && harnessConsistency.passed, harnessConsistency.passed ? harness : harnessConsistency.errors.join("; ")),
    qualityLineageGate("qa", qualityLineage),
    qualityLineageGate("review", qualityLineage),
    gate("recheck_fix_loop", "runtime.quality-lineage", taskGraphExists && qualityLineageGate("recheck_fix_loop", qualityLineage).status === "pass", !taskGraphExists ? "missing planning/task-graph.json" : qualityLineageGate("recheck_fix_loop", qualityLineage).status === "pass" ? qualityLineage : fixTasks.join(", ") || qualityLineage),
    gate("runtime_requirements", "runtime.runtime-requirements", runtimeRequirements.result.status === "pass", runtimeRequirements.result.status === "pass" ? runtimeRequirements.json : runtimeRequirements.result.checks.filter((item) => item.status === "blocked").map((item) => `${item.id}: ${item.detail}`).join("; ")),
    fileGate(dir, "risk_review", "runtime.standard-evidence", "evidence/risk-review.md"),
    gate("commit", "runtime.commit-push-policy", Boolean(commitEvidence) && commitCheck.passed, commitCheck.detail),
    gate("committer", "runtime.commit-push-policy", Boolean(commitEvidence) && commitCheck.passed, commitCheck.detail),
    gate("push", "runtime.commit-push-policy", Boolean(pushEvidence), pushEvidence),
    archiveGate(dir),
    acceptanceGate(acceptance),
    gate("true_harness", "runtime.true-harness-evidence", harnessPayload.true_harness_passed === true && harnessConsistency.passed, harnessConsistency.passed ? harness : harnessConsistency.errors.join("; ")),
    rolePurityGate(cwd, runId),
    orchestratorRuntimeConsistencyGate(dir, runMetadata.status, harness),
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
  appendRuntimeTraceEvents(cwd, runId, gates.map((gateItem) => gateTraceInput(gateItem, finalGates)));
  writeTrueHarnessEvidence(cwd, runId);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.reconcile",
    componentId: "runtime.true-harness-evidence",
    actionId: "runtime.refresh_true_harness_evidence",
    eventType: "artifact_written",
    status: "recorded",
    reason: "true harness evidence refreshed after final gates",
    inputArtifacts: [finalGates],
    outputArtifacts: [harness]
  });
  const finalGateValidation = validateRuntimeFinalGates(finalGates);
  if (status === "completed" && finalGateValidation.passed) {
    assertTransitionAccepted(transitionRunState(cwd, runId, "archiving", { archiving_at: new Date().toISOString(), final_gates: finalGates }), `finalize archive ${runId}`);
    assertTransitionAccepted(transitionRunState(cwd, runId, "completed", { completed_at: new Date().toISOString(), final_gates: finalGates }), `finalize run ${runId}`);
  } else {
    const transition = transitionRunState(cwd, runId, "blocked", { blocked_at: new Date().toISOString(), blocked_reason: finalGateValidation.passed ? "finalize gates blocked" : `runtime final gates invalid: ${finalGateValidation.errors.join("; ")}`, final_gates: finalGates });
    if (!transition.accepted) {
      updateRunFile(cwd, runId, {
        status: "blocked",
        blocked_at: new Date().toISOString(),
        blocked_reason: "reconcile overrode non-authoritative completed status because final gates blocked",
        final_gates: finalGates
      });
    }
  }
  const traceFiles = runtimeTraceFiles(cwd, runId);
  appendRuntimeTraceEvent(cwd, runId, {
    source: "runtime.reconcile",
    componentId: "runtime.final-gates",
    actionId: "runtime.reconcile_finalize",
    eventType: "finalization",
    status,
    reason: status === "completed" ? "all runtime final gates passed" : "one or more runtime final gates blocked",
    inputArtifacts: [finalGates, harness, qualityLineage, runtimeRequirements.json],
    outputArtifacts: [finalReport, blockerMatrix, traceFiles.runTrace, traceFiles.gateTrace]
  });
  const debuggerReport = status === "blocked" ? writeHarnessDebuggerReport(cwd, runId) : null;
  return {
    runId,
    status,
    gates,
    files: [finalGates, acceptance, runtimeRequirements.json, runtimeRequirements.markdown, harnessComponents, harness, qualityLineage, commitEvidence, pushEvidence, finalReport, blockerMatrix, debuggerReport?.overview, debuggerReport?.detail, traceFiles.runTrace, traceFiles.gateTrace, ...fixTaskFiles].filter((file): file is string => Boolean(file))
  };
}

export function reconcileRun(cwd: string, runId: string): ReconcileResult {
  return finalizeRun(cwd, runId);
}
