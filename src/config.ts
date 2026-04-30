import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

export type ProviderName = "anthropic" | "openai";

function pickProvider(raw: string | undefined): ProviderName {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "openai") return "openai";
  return "anthropic";
}

export const config = {
  // --- LLM provider ---
  provider: pickProvider(process.env.LLM_PROVIDER),

  // Anthropic
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? process.env.MODEL ?? "claude-opus-4-7",
  anthropicEffort: (process.env.ANTHROPIC_EFFORT ?? process.env.EFFORT ?? "high") as
    | "low"
    | "medium"
    | "high"
    | "max",

  // OpenAI-compatible
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",

  // --- Server ---
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  targetBaseUrl: process.env.TARGET_BASE_URL ?? "",

  // --- Browser ---
  headless: (process.env.HEADLESS ?? "true").toLowerCase() !== "false",
  browserTimeoutMs: Number(process.env.BROWSER_TIMEOUT_MS ?? 30000),
  maxAgentSteps: Number(process.env.MAX_AGENT_STEPS ?? 40),

  // --- Paths ---
  dataDir: path.resolve(root, process.env.DATA_DIR ?? "./data"),
  reportsDir: path.resolve(root, process.env.REPORTS_DIR ?? "./reports"),
  specsDir: path.resolve(root, process.env.SPECS_DIR ?? "./specs"),
};

export function ensureDirs(): void {
  for (const dir of [config.dataDir, config.reportsDir, config.specsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * The display name of the model currently in use, for reports/logs.
 */
export function activeModelLabel(): string {
  return config.provider === "anthropic"
    ? `${config.anthropicModel} (anthropic)`
    : `${config.openaiModel} (openai @ ${new URL(config.openaiBaseUrl).host})`;
}
