import fs from "node:fs";
import path from "node:path";
import { ensureDir, writeText } from "./fs.js";
import { validateAgentHandoff } from "./handoff-evidence.js";
import { writeProviderExecutionReceipt } from "./provider-evidence.js";

export interface AgentCompleteResult {
  runId: string;
  actionId: string;
  agentId: string;
  role: string;
  status: "completed" | "blocked";
  files: string[];
  errors: string[];
}

interface ActionRecord {
  id: string;
  role: string;
  taskId?: string;
  parallelGroup: string;
}

interface AgentRecord {
  id: string;
  role: string;
  taskId?: string;
  status?: string;
  executionStatus?: string;
  completedAt?: string;
  handoffFile?: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function runDir(cwd: string, runId: string): string {
  const dir = path.join(cwd, ".imfine", "runs", runId);
  if (!fs.existsSync(path.join(dir, "run.json"))) throw new Error(`Run not found: ${runId}`);
  return dir;
}

function findAction(dir: string, actionId: string): ActionRecord {
  const sessionFile = path.join(dir, "orchestration", "orchestrator-session.json");
  if (!fs.existsSync(sessionFile)) throw new Error(`Missing orchestrator session for agent completion: ${sessionFile}`);
  const session = readJson<{ next_actions?: ActionRecord[] }>(sessionFile);
  const action = Array.isArray(session.next_actions) ? session.next_actions.find((item) => item.id === actionId) : undefined;
  if (!action) throw new Error(`Unknown action for agent completion: ${actionId}`);
  return action;
}

function agentIdFor(action: ActionRecord): string {
  if (action.taskId) {
    if (action.role === "dev" || action.role === "technical-writer") return action.taskId;
    return `${action.role}-${action.taskId}`;
  }
  return action.role;
}

function updateAgentRuns(dir: string, runId: string, action: ActionRecord, agentId: string, status: AgentCompleteResult["status"], handoffFile: string | null): string {
  const file = path.join(dir, "orchestration", "agent-runs.json");
  const current = fs.existsSync(file) ? readJson<{ agents?: AgentRecord[] }>(file) : { agents: [] };
  const agents = Array.isArray(current.agents) ? current.agents : [];
  const index = agents.findIndex((agent) => agent.id === agentId || (agent.role === action.role && (agent.taskId || "") === (action.taskId || "")));
  const next: AgentRecord = {
    ...(index >= 0 ? agents[index] : {}),
    id: index >= 0 ? agents[index].id : agentId,
    role: action.role,
    taskId: action.taskId,
    status,
    executionStatus: status,
    completedAt: new Date().toISOString(),
    handoffFile: handoffFile || undefined
  };
  if (index >= 0) agents[index] = next;
  else agents.push(next);
  writeText(file, `${JSON.stringify({ schema_version: 1, run_id: runId, agents }, null, 2)}\n`);
  return file;
}

function recordWave(dir: string, runId: string, action: ActionRecord, status: AgentCompleteResult["status"]): string {
  const file = path.join(dir, "orchestration", "parallel-execution.json");
  const current = fs.existsSync(file)
    ? readJson<{ wave_history?: unknown[]; executed_parallel_groups?: string[]; blocked_parallel_groups?: string[] }>(file)
    : {};
  const waveHistory = Array.isArray(current.wave_history) ? current.wave_history : [];
  waveHistory.push({
    iteration: waveHistory.length + 1,
    parallel_group: action.parallelGroup,
    action_ids: [action.id],
    task_ids: action.taskId ? [action.taskId] : [],
    roles: [action.role],
    status,
    reason: `agent completion recorded for ${action.id}`,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString()
  });
  const executed = new Set(current.executed_parallel_groups || []);
  const blocked = new Set(current.blocked_parallel_groups || []);
  if (status === "completed") executed.add(action.parallelGroup);
  if (status === "blocked") blocked.add(action.parallelGroup);
  writeText(file, `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    artifact_type: "execution",
    executed_parallel_groups: Array.from(executed).sort(),
    blocked_parallel_groups: Array.from(blocked).sort(),
    wave_history: waveHistory
  }, null, 2)}\n`);
  return file;
}

export function completeAgentAction(cwd: string, runId: string, actionId: string): AgentCompleteResult {
  const dir = runDir(cwd, runId);
  const action = findAction(dir, actionId);
  const agentId = agentIdFor(action);
  const validation = validateAgentHandoff({ id: agentId, role: action.role, taskId: action.taskId }, dir, runId);
  const status: AgentCompleteResult["status"] = validation.passed ? "completed" : "blocked";
  const receipt = writeProviderExecutionReceipt(cwd, runId, {
    actionId,
    agentId,
    role: action.role,
    taskId: action.taskId,
    parallelGroup: action.parallelGroup,
    status
  });
  const agentRuns = updateAgentRuns(dir, runId, action, agentId, status, validation.file);
  const wave = recordWave(dir, runId, action, status);
  const ledgerFile = path.join(dir, "orchestration", "action-ledger.json");
  ensureDir(path.dirname(ledgerFile));
  const ledger = fs.existsSync(ledgerFile) ? readJson<{ actions?: Record<string, unknown>; history?: unknown[] }>(ledgerFile) : {};
  const actions = ledger.actions || {};
  const history = Array.isArray(ledger.history) ? ledger.history : [];
  actions[actionId] = { action_id: actionId, status, detail: validation.errors.join("; ") || "agent completed", updated_at: new Date().toISOString() };
  history.push({ action_id: actionId, status, recorded_at: new Date().toISOString() });
  writeText(ledgerFile, `${JSON.stringify({ schema_version: 1, run_id: runId, updated_at: new Date().toISOString(), actions, history }, null, 2)}\n`);
  return {
    runId,
    actionId,
    agentId,
    role: action.role,
    status,
    files: [validation.file, agentRuns, wave, ledgerFile].filter((file): file is string => Boolean(file)),
    errors: validation.errors
  };
}
