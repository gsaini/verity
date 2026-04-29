import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { config } from "../../config.js";
import type { StepRecord } from "../../types.js";
import { browserTools, executeTool, type ToolContext } from "../tools.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompts.js";
import type { AgentRunParams, AgentRunResult, LLMProvider } from "./types.js";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;

  async runAgent({ spec, session, baseUrl, onStepLog }: AgentRunParams): Promise<AgentRunResult> {
    if (!config.anthropicApiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env or switch LLM_PROVIDER=openai.",
      );
    }
    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    const steps: StepRecord[] = [];
    let stepIndex = 0;
    const recordStep: ToolContext["recordStep"] = (entry) => {
      const record: StepRecord = {
        index: stepIndex++,
        startedAt: new Date().toISOString(),
        ...entry,
      };
      steps.push(record);
      if (onStepLog) onStepLog(record);
    };

    const ctx: ToolContext = { session, baseUrl, recordStep };

    const initialSnap = await session.snapshot("initial");
    recordStep({
      type: "screenshot",
      description: "Initial page state",
      screenshotPath: initialSnap.screenshotPath,
      pageUrl: initialSnap.url,
      pageTitle: initialSnap.title,
    });

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: buildUserPrompt(spec, baseUrl) },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: initialSnap.screenshotBase64,
            },
          },
          {
            type: "text",
            text: `Initial state — URL: ${initialSnap.url}, title: "${initialSnap.title}". Begin by navigating to the first page the test requires.`,
          },
        ],
      },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let cacheReadTokens = 0;
    let verdict: AgentRunResult | null = null;
    let exhaustedBudget = false;

    for (let turn = 0; turn < config.maxAgentSteps; turn++) {
      const response = await client.messages.create({
        model: config.anthropicModel,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: config.anthropicEffort },
        // Cache the system prompt across runs — it's stable across every test.
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: browserTools,
        messages,
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;

      messages.push({ role: "assistant", content: response.content });

      for (const block of response.content) {
        if (block.type === "thinking" && block.thinking) {
          recordStep({
            type: "thinking",
            description:
              block.thinking.length > 200 ? block.thinking.slice(0, 200) + "..." : block.thinking,
            input: { full: block.thinking },
          });
        } else if (block.type === "text" && block.text.trim()) {
          recordStep({
            type: "thinking",
            description: block.text.length > 200 ? block.text.slice(0, 200) + "..." : block.text,
            input: { full: block.text },
          });
        }
      }

      if (response.stop_reason === "end_turn") {
        verdict = {
          passed: false,
          summary: "Agent ended turn without calling finish_test.",
          failureReason:
            "Agent did not produce a verdict — likely got stuck or finished prematurely.",
          expectationsChecked: [],
          steps,
          totalInputTokens,
          totalOutputTokens,
          cacheReadTokens,
          exhaustedBudget: false,
          modelLabel: `${config.anthropicModel} (anthropic)`,
        };
        break;
      }

      if (response.stop_reason !== "tool_use") {
        verdict = {
          passed: false,
          summary: `Agent stopped with reason: ${response.stop_reason}`,
          failureReason: `Stop reason: ${response.stop_reason}`,
          expectationsChecked: [],
          steps,
          totalInputTokens,
          totalOutputTokens,
          cacheReadTokens,
          exhaustedBudget: false,
          modelLabel: `${config.anthropicModel} (anthropic)`,
        };
        break;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      let finishedThisTurn: AgentRunResult | null = null;

      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(
          toolUse.name,
          (toolUse.input ?? {}) as Record<string, unknown>,
          ctx,
        );

        const content: Anthropic.ToolResultBlockParam["content"] = [
          { type: "text", text: result.result },
        ];

        if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
          const data = fs.readFileSync(result.screenshotPath).toString("base64");
          (content as Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>).push({
            type: "image",
            source: { type: "base64", media_type: "image/png", data },
          });
        }

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content,
          is_error: result.isError,
        });

        if (result.finished && result.verdict) {
          finishedThisTurn = {
            passed: result.verdict.passed,
            summary: result.verdict.summary,
            failureReason: result.verdict.failureReason,
            expectationsChecked: result.verdict.expectationsChecked,
            steps,
            totalInputTokens,
            totalOutputTokens,
            cacheReadTokens,
            exhaustedBudget: false,
            modelLabel: `${config.anthropicModel} (anthropic)`,
          };
        }
      }

      messages.push({ role: "user", content: toolResultBlocks });

      if (finishedThisTurn) {
        verdict = finishedThisTurn;
        break;
      }
    }

    if (!verdict) {
      exhaustedBudget = true;
      verdict = {
        passed: false,
        summary: `Agent did not finish within ${config.maxAgentSteps} turns.`,
        failureReason: `Exceeded MAX_AGENT_STEPS (${config.maxAgentSteps}). Increase the budget or simplify the test.`,
        expectationsChecked: [],
        steps,
        totalInputTokens,
        totalOutputTokens,
        cacheReadTokens,
        exhaustedBudget: true,
        modelLabel: `${config.anthropicModel} (anthropic)`,
      };
    }

    verdict.exhaustedBudget = exhaustedBudget;
    return verdict;
  }
}
