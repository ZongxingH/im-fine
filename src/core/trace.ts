import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";

interface TaskGraph {
  tasks?: Array<{
    id?: string;
    title?: string;
    type?: string;
    acceptance?: string[];
  }>;
}

interface RunMetadata {
  run_id: string;
  status?: string;
  source?: { value?: string; type?: string };
  commit_hashes?: string[];
}

interface HandoffRecord {
  task_id?: string;
  role?: string;
  from?: string;
  status?: string;
  summary?: string;
  evidence?: string[];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function optionalJson<T>(file: string): T | null {
  return fs.existsSync(file) ? readJson<T>(file) : null;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function rel(cwd: string, file: string): string {
  return path.relative(cwd, file) || ".";
}

function existing(cwd: string, files: string[]): string[] {
  return files.filter((file) => fs.existsSync(file)).map((file) => rel(cwd, file));
}

function collectHandoffs(cwd: string, runRoot: string): Array<{
  agent_id: string;
  role: string;
  task_id: string;
  status: string;
  summary: string;
  evidence: string[];
  file: string;
}> {
  const agentsDir = path.join(runRoot, "agents");
  if (!fs.existsSync(agentsDir)) return [];
  const result: Array<{
    agent_id: string;
    role: string;
    task_id: string;
    status: string;
    summary: string;
    evidence: string[];
    file: string;
  }> = [];
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true }).filter((item) => item.isDirectory())) {
    const file = path.join(agentsDir, entry.name, "handoff.json");
    if (!fs.existsSync(file)) continue;
    const handoff = readJson<HandoffRecord>(file);
    result.push({
      agent_id: entry.name,
      role: handoff.role || handoff.from || "unknown",
      task_id: handoff.task_id || "run",
      status: handoff.status || "unknown",
      summary: handoff.summary || "",
      evidence: Array.isArray(handoff.evidence) ? handoff.evidence.filter((item): item is string => typeof item === "string").map((item) => rel(cwd, item)) : [],
      file: rel(cwd, file)
    });
  }
  return result;
}

export function writeRunTraceIndex(cwd: string, runId: string): string {
  const root = runDir(cwd, runId);
  const run = readJson<RunMetadata>(path.join(root, "run.json"));
  const graph = optionalJson<TaskGraph>(path.join(root, "planning", "task-graph.json"));
  const handoffs = collectHandoffs(cwd, root);
  const traceFile = path.join(root, "orchestration", "trace-index.json");
  const payload = {
    schema_version: 1,
    run_id: runId,
    generated_at: new Date().toISOString(),
    requirement: {
      source_type: run.source?.type || "unknown",
      source_value: run.source?.value || "unknown",
      files: existing(cwd, [
        path.join(root, "request", "input.md"),
        path.join(root, "request", "normalized.md"),
        path.join(root, "request", "source.json")
      ])
    },
    analysis: existing(cwd, [
      path.join(root, "analysis", "project-context.md"),
      path.join(root, "analysis", "impact-analysis.md"),
      path.join(root, "analysis", "risk-analysis.md"),
      path.join(root, "orchestration", "context.json")
    ]),
    tasks: (graph?.tasks || []).map((task) => ({
      task_id: task.id || "unknown",
      title: task.title || "unknown",
      type: task.type || "unknown",
      acceptance: Array.isArray(task.acceptance) ? task.acceptance : [],
      handoffs: handoffs.filter((handoff) => handoff.task_id === task.id)
    })),
    run_level_handoffs: handoffs.filter((handoff) => handoff.task_id === "run"),
    evidence: existing(cwd, [
      path.join(root, "evidence", "test-results.md"),
      path.join(root, "evidence", "review.md"),
      path.join(root, "evidence", "commits.md"),
      path.join(root, "evidence", "push.md"),
      path.join(root, "archive", "archive-report.md"),
      path.join(root, "orchestration", "true-harness-evidence.json")
    ]),
    commits: Array.isArray(run.commit_hashes) ? run.commit_hashes : [],
    archived_capability: rel(cwd, path.join(cwd, ".imfine", "project", "capabilities", runId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"), "spec.md"))
  };
  ensureDir(path.dirname(traceFile));
  writeText(traceFile, `${JSON.stringify(payload, null, 2)}\n`);
  return traceFile;
}

export function writeCapabilityTrace(cwd: string, runId: string, capabilityFile: string): string {
  const root = runDir(cwd, runId);
  const trace = path.join(path.dirname(capabilityFile), "trace.json");
  const run = readJson<RunMetadata>(path.join(root, "run.json"));
  const payload = {
    schema_version: 1,
    run_id: runId,
    capability: path.relative(cwd, capabilityFile),
    generated_at: new Date().toISOString(),
    status: run.status || "unknown",
    commits: Array.isArray(run.commit_hashes) ? run.commit_hashes : [],
    evidence: existing(cwd, [
      path.join(root, "orchestration", "trace-index.json"),
      path.join(root, "archive", "archive-report.md"),
      path.join(root, "evidence", "test-results.md"),
      path.join(root, "evidence", "review.md"),
      path.join(root, "evidence", "commits.md")
    ])
  };
  writeText(trace, `${JSON.stringify(payload, null, 2)}\n`);
  return trace;
}
