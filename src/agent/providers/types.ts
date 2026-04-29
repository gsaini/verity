import type { TestSpec, StepRecord } from "../../types.js";
import type { BrowserSession } from "../../runner/browser.js";

export interface AgentRunParams {
  spec: TestSpec;
  session: BrowserSession;
  baseUrl?: string;
  onStepLog?: (step: StepRecord) => void;
}

export interface AgentRunResult {
  passed: boolean;
  summary: string;
  failureReason?: string;
  expectationsChecked: string[];
  steps: StepRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  exhaustedBudget: boolean;
  modelLabel: string;
}

export interface LLMProvider {
  readonly name: "anthropic" | "openai";
  runAgent(params: AgentRunParams): Promise<AgentRunResult>;
}
