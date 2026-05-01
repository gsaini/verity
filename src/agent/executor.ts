import { type ProviderName, config, parseProvider, resolveOpenAICompatConfig } from "../config.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAICompatProvider } from "./providers/openai-compat.js";
import type { AgentRunParams, AgentRunResult, LLMProvider } from "./providers/types.js";

// Re-export the shared types so callers can keep importing from here.
export type { AgentRunResult as ExecutorResult } from "./providers/types.js";

/**
 * Build the right provider instance for a given name. Each call returns a
 * fresh provider — they're cheap to construct and reading config at call
 * time means env changes are honored without restarting.
 */
export function buildProvider(name: ProviderName): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "openai":
    case "ollama":
    case "groq":
      return new OpenAICompatProvider(resolveOpenAICompatConfig(name));
  }
}

/**
 * Resolve which provider to use for a run. Precedence (highest first):
 *   1. Explicit `providerOverride` (from CLI flag, API param, etc.)
 *   2. Spec frontmatter `provider` field
 *   3. `LLM_PROVIDER` env var (already baked into config.provider)
 */
export function resolveProvider(providerOverride?: string, specProvider?: string): ProviderName {
  return parseProvider(providerOverride) ?? parseProvider(specProvider) ?? config.provider;
}

/**
 * Run an agent test against the configured LLM provider.
 */
export async function runAgent(
  params: AgentRunParams & { providerOverride?: string },
): Promise<AgentRunResult> {
  const name = resolveProvider(params.providerOverride, params.spec.provider);
  const provider = buildProvider(name);
  return provider.runAgent(params);
}
