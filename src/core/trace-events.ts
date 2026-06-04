import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./fs.js";

export type RuntimeTraceEventType =
  | "ingest"
  | "artifact_written"
  | "gate_evaluated"
  | "finalization"
  | "archive"
  | "status_checked";

export type RuntimeTraceStatus = "pass" | "blocked" | "completed" | "running" | "recorded";

export interface RuntimeTraceEvent {
  schema_version: 1;
  event_id: string;
  parent_event_id: string | null;
  run_id: string;
  timestamp: string;
  source: string;
  component_id: string;
  action_id: string;
  event_type: RuntimeTraceEventType;
  status: RuntimeTraceStatus;
  reason: string;
  input_artifacts: string[];
  output_artifacts: string[];
}

export interface RuntimeTraceEventInput {
  parentEventId?: string | null;
  source: string;
  componentId: string;
  actionId: string;
  eventType: RuntimeTraceEventType;
  status: RuntimeTraceStatus;
  reason: string;
  inputArtifacts?: string[];
  outputArtifacts?: string[];
}

export interface RuntimeTraceFiles {
  runTrace: string;
  gateTrace: string;
}

export interface TraceArtifactSource {
  eventId: string;
  source: string;
  componentId: string;
  actionId: string;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function traceFiles(cwd: string, runId: string): RuntimeTraceFiles {
  const orchestration = path.join(runDir(cwd, runId), "orchestration");
  return {
    runTrace: path.join(orchestration, "run-trace.jsonl"),
    gateTrace: path.join(orchestration, "gate-trace.jsonl")
  };
}

function normalizeArtifact(cwd: string, artifact: string): string {
  if (!artifact.trim()) return artifact;
  return path.isAbsolute(artifact) ? path.relative(cwd, artifact) || "." : artifact;
}

function eventId(payload: Omit<RuntimeTraceEvent, "event_id">): string {
  return `evt_${crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 20)}`;
}

function buildEvent(cwd: string, runId: string, input: RuntimeTraceEventInput): RuntimeTraceEvent {
  const payload: Omit<RuntimeTraceEvent, "event_id"> = {
    schema_version: 1,
    parent_event_id: input.parentEventId || null,
    run_id: runId,
    timestamp: new Date().toISOString(),
    source: input.source,
    component_id: input.componentId,
    action_id: input.actionId,
    event_type: input.eventType,
    status: input.status,
    reason: input.reason,
    input_artifacts: Array.from(new Set((input.inputArtifacts || []).map((item) => normalizeArtifact(cwd, item)))),
    output_artifacts: Array.from(new Set((input.outputArtifacts || []).map((item) => normalizeArtifact(cwd, item))))
  };
  return { ...payload, event_id: eventId(payload) };
}

export function appendRuntimeTraceEvent(cwd: string, runId: string, input: RuntimeTraceEventInput): RuntimeTraceEvent {
  const event = buildEvent(cwd, runId, input);
  const files = traceFiles(cwd, runId);
  ensureDir(path.dirname(files.runTrace));
  fs.appendFileSync(files.runTrace, `${JSON.stringify(event)}\n`);
  if (event.event_type === "gate_evaluated") fs.appendFileSync(files.gateTrace, `${JSON.stringify(event)}\n`);
  return event;
}

export function appendRuntimeTraceEvents(cwd: string, runId: string, inputs: RuntimeTraceEventInput[]): RuntimeTraceEvent[] {
  return inputs.map((input) => appendRuntimeTraceEvent(cwd, runId, input));
}

export function runtimeTraceFiles(cwd: string, runId: string): RuntimeTraceFiles {
  return traceFiles(cwd, runId);
}

export function readRuntimeTraceEvents(cwd: string, runId: string, kind: "run" | "gate" = "run"): RuntimeTraceEvent[] {
  const files = traceFiles(cwd, runId);
  const file = kind === "gate" ? files.gateTrace : files.runTrace;
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RuntimeTraceEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is RuntimeTraceEvent => Boolean(event));
}

export function latestBlockerTrace(cwd: string, runId: string, limit = 3): RuntimeTraceEvent[] {
  return readRuntimeTraceEvents(cwd, runId, "gate")
    .filter((event) => event.status === "blocked")
    .slice(-limit)
    .reverse();
}

export function latestTraceSourceForArtifact(cwd: string, runId: string, artifactId: string, artifactFile: string): TraceArtifactSource | null {
  const normalizedFile = normalizeArtifact(cwd, artifactFile);
  const events = readRuntimeTraceEvents(cwd, runId, "run").slice().reverse();
  const match = events.find((event) => event.output_artifacts.some((artifact) => artifact === artifactId || artifact === normalizedFile || artifact.endsWith(`/${artifactId}.json`)));
  if (!match) return null;
  return {
    eventId: match.event_id,
    source: match.source,
    componentId: match.component_id,
    actionId: match.action_id
  };
}
