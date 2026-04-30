export type RunStatus = "queued" | "running" | "passed" | "failed" | "error";

export interface TestSpec {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  steps: string[];
  expectations: string[];
  tags?: string[];
  rawSource: string;
  filePath?: string;
}

export interface StepRecord {
  index: number;
  type:
    | "navigate"
    | "click"
    | "fill"
    | "press_key"
    | "wait"
    | "assert"
    | "screenshot"
    | "scroll"
    | "thinking"
    | "summary";
  description: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  screenshotPath?: string;
  pageUrl?: string;
  pageTitle?: string;
  durationMs?: number;
  startedAt: string;
}

export interface RunRecord {
  id: string;
  specId: string;
  specName: string;
  status: RunStatus;
  trigger: "manual" | "github" | "cli" | "scheduled";
  triggerMeta?: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  baseUrl?: string;
  summary?: string;
  failureReason?: string;
  steps: StepRecord[];
  totalInputTokens?: number;
  totalOutputTokens?: number;
  cacheReadTokens?: number;
  reportPath?: string;
}

export interface VerdictTool {
  passed: boolean;
  summary: string;
  failureReason?: string;
  expectationsChecked: string[];
}
