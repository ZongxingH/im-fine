import fs from "node:fs";
import path from "node:path";
import { validateHandoff, type HandoffRole } from "./handoff-validator.js";

export interface AgentHandoffTarget {
  id: string;
  role: string;
  taskId?: string;
  handoffFile?: string;
}

export interface AgentHandoffValidation {
  agentId: string;
  role: string;
  taskId?: string;
  file: string | null;
  passed: boolean;
  errors: string[];
}

const HANDOFF_ROLES = new Set<string>([
  "architect",
  "task-planner",
  "intake",
  "project-analyzer",
  "product-planner",
  "dev",
  "qa",
  "reviewer",
  "merge-agent",
  "archive",
  "committer",
  "risk-reviewer",
  "technical-writer",
  "project-knowledge-updater"
]);

export function isHandoffRole(role: string): role is HandoffRole {
  return HANDOFF_ROLES.has(role);
}

export function agentHandoffCandidates(agent: AgentHandoffTarget, runDirPath: string): string[] {
  const candidates = [
    agent.handoffFile,
    path.join(runDirPath, "agents", agent.id, "handoff.json"),
    agent.taskId ? path.join(runDirPath, "agents", agent.taskId, "handoff.json") : undefined,
    agent.taskId ? path.join(runDirPath, "agents", `${agent.role}-${agent.taskId}`, "handoff.json") : undefined,
    path.join(runDirPath, "agents", agent.role, "handoff.json")
  ].filter((item): item is string => typeof item === "string" && item.length > 0);
  return Array.from(new Set(candidates));
}

export function validateAgentHandoff(agent: AgentHandoffTarget, runDirPath: string, runId: string): AgentHandoffValidation {
  const file = agentHandoffCandidates(agent, runDirPath).find((candidate) => fs.existsSync(candidate)) || null;
  if (!file) {
    return {
      agentId: agent.id,
      role: agent.role,
      taskId: agent.taskId,
      file,
      passed: false,
      errors: ["handoff is missing"]
    };
  }
  if (!isHandoffRole(agent.role)) {
    return {
      agentId: agent.id,
      role: agent.role,
      taskId: agent.taskId,
      file,
      passed: false,
      errors: [`unsupported handoff role: ${agent.role}`]
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {
      agentId: agent.id,
      role: agent.role,
      taskId: agent.taskId,
      file,
      passed: false,
      errors: ["handoff is not valid JSON"]
    };
  }
  const validation = validateHandoff(agent.role, parsed, runId, agent.taskId);
  const evidence = typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { evidence?: unknown }).evidence)
    ? (parsed as { evidence: unknown[] }).evidence
    : [];
  const evidenceErrors = evidence
    .filter((item) => typeof item !== "string" || !fs.existsSync(item))
    .map((item) => `missing evidence: ${String(item)}`);
  return {
    agentId: agent.id,
    role: agent.role,
    taskId: agent.taskId,
    file,
    passed: validation.passed && evidenceErrors.length === 0,
    errors: [...validation.errors, ...evidenceErrors]
  };
}
