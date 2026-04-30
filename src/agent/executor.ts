import { config } from "../config.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAICompatProvider } from "./providers/openai-compat.js";
import type { AgentRunParams, AgentRunResult, LLMProvider } from "./providers/types.js";

// Re-export the shared types so callers can keep importing from here.
export type { AgentRunResult as ExecutorResult } from "./providers/types.js";

function selectProvider(): LLMProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAICompatProvider();
    default:
      return new AnthropicProvider();
  }
}

/**
 * Run an agent test against the configured LLM provider. The provider is
 * selected by `LLM_PROVIDER` env var (anthropic | openai).
 */
export async function runAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const provider = selectProvider();
  return provider.runAgent(params);
}
