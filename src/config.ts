import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

export type ProviderName = "anthropic" | "openai" | "ollama" | "groq";

const VALID_PROVIDERS: ProviderName[] = ["anthropic", "openai", "ollama", "groq"];

export function parseProvider(raw: string | undefined): ProviderName | undefined {
  const v = (raw ?? "").toLowerCase().trim();
  if (!v) return undefined;
  return VALID_PROVIDERS.includes(v as ProviderName) ? (v as ProviderName) : undefined;
}

function pickProviderOrDefault(raw: string | undefined): ProviderName {
  return parseProvider(raw) ?? "anthropic";
}

export const config = {
  // --- Default LLM provider ---
  // Can be overridden per-run via CLI flag, spec frontmatter, or API param.
  provider: pickProviderOrDefault(process.env.LLM_PROVIDER),

  // Anthropic
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? process.env.MODEL ?? "claude-opus-4-7",
  anthropicEffort: (process.env.ANTHROPIC_EFFORT ?? process.env.EFFORT ?? "high") as
    | "low"
    | "medium"
    | "high"
    | "max",

  // OpenAI (cloud) — generic OpenAI-compat endpoint, defaults to api.openai.com
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",

  // Ollama (local) — defaults to localhost:11434
  ollamaApiKey: process.env.OLLAMA_API_KEY ?? "ollama",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5vl",

  // Groq (fast cloud inference)
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqBaseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",

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
 * Resolved configuration for an OpenAI-compatible provider profile.
 * Returned by resolveOpenAICompatConfig() so providers don't need to know
 * which profile (openai/ollama/groq) they're acting as.
 */
export interface OpenAICompatProfile {
  name: "openai" | "ollama" | "groq";
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Human-readable label for reports/logs. */
  label: string;
}

export function resolveOpenAICompatConfig(
  provider: "openai" | "ollama" | "groq",
): OpenAICompatProfile {
  switch (provider) {
    case "openai":
      return {
        name: "openai",
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        model: config.openaiModel,
        label: `${config.openaiModel} (openai @ ${safeHost(config.openaiBaseUrl)})`,
      };
    case "ollama":
      return {
        name: "ollama",
        apiKey: config.ollamaApiKey,
        baseUrl: config.ollamaBaseUrl,
        model: config.ollamaModel,
        label: `${config.ollamaModel} (ollama @ ${safeHost(config.ollamaBaseUrl)})`,
      };
    case "groq":
      return {
        name: "groq",
        apiKey: config.groqApiKey,
        baseUrl: config.groqBaseUrl,
        model: config.groqModel,
        label: `${config.groqModel} (groq @ ${safeHost(config.groqBaseUrl)})`,
      };
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The display name of the model in the configured default provider — used
 * in the report footer as a baseline. Per-run overrides update modelLabel
 * on the run record itself.
 */
export function activeModelLabel(provider: ProviderName = config.provider): string {
  if (provider === "anthropic") {
    return `${config.anthropicModel} (anthropic)`;
  }
  return resolveOpenAICompatConfig(provider).label;
}
