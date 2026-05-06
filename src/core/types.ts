export type InstallTarget = "codex" | "claude" | "all";
export type InstallLanguage = "zh" | "en";

export interface CliArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface DoctorReport {
  cwd: string;
  checkedAt: string;
  checks: DoctorCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
}

export interface InitResult {
  cwd: string;
  workspace: string;
  projectMode: "empty" | "existing";
  architecture: {
    mode: "empty" | "existing";
    files: string[];
    architectInput?: string;
  };
  created: string[];
  updated: string[];
  preserved: string[];
  doctor: DoctorReport;
}
