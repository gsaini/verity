import fs from "node:fs";
import OpenAI from "openai";
import { type OpenAICompatProfile, config } from "../../config.js";
import type { StepRecord } from "../../types.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "../prompts.js";
import { type ToolContext, browserTools, executeTool } from "../tools.js";
import type { AgentRunParams, AgentRunResult, LLMProvider } from "./types.js";

/**
 * OpenAI-compatible provider. One class, three profiles:
 *   - openai: api.openai.com (gpt-4o, gpt-4o-mini, ...)
 *   - ollama: local Ollama server (http://localhost:11434/v1)
 *   - groq:   api.groq.com (llama-3.3-70b-versatile, llama-3.2-90b-vision-preview, ...)
 *
 * Also works with LM Studio, vLLM, llama.cpp server, OpenRouter, Together —
 * configure via the `openai` profile with a custom OPENAI_BASE_URL.
 *
 * Vision feedback after each tool call is sent as a follow-up user message
 * with an image_url block — that's the most portable shape across providers.
 * Some local models without multimodal support will simply ignore the images;
 * the agent still receives a text URL/title fingerprint and can proceed.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name: "openai" | "ollama" | "groq";
  private readonly profile: OpenAICompatProfile;

  constructor(profile: OpenAICompatProfile) {
    this.profile = profile;
    this.name = profile.name;
  }

  async runAgent({ spec, session, baseUrl, onStepLog }: AgentRunParams): Promise<AgentRunResult> {
    const apiKey = this.profile.apiKey || "not-needed-for-local";
    const client = new OpenAI({ apiKey, baseURL: this.profile.baseUrl });
    const modelLabel = this.profile.label;

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

    // Convert our tool definitions to OpenAI's function-calling shape.
    const tools = browserTools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: buildUserPrompt(spec, baseUrl) },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${initialSnap.screenshotBase64}` },
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
    let verdict: AgentRunResult | null = null;
    let exhaustedBudget = false;

    for (let turn = 0; turn < config.maxAgentSteps; turn++) {
      const response = await client.chat.completions.create({
        model: this.profile.model,
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 4000,
      });

      const usage = response.usage;
      if (usage) {
        totalInputTokens += usage.prompt_tokens ?? 0;
        totalOutputTokens += usage.completion_tokens ?? 0;
      }

      const choice = response.choices[0];
      if (!choice) {
        verdict = {
          passed: false,
          summary: "OpenAI-compatible response had no choices.",
          failureReason: "Empty response from model",
          expectationsChecked: [],
          steps,
          totalInputTokens,
          totalOutputTokens,
          cacheReadTokens: 0,
          exhaustedBudget: false,
          modelLabel,
        };
        break;
      }

      const assistantMsg = choice.message;
      messages.push(assistantMsg);

      if (
        assistantMsg.content &&
        typeof assistantMsg.content === "string" &&
        assistantMsg.content.trim()
      ) {
        recordStep({
          type: "thinking",
          description:
            assistantMsg.content.length > 200
              ? `${assistantMsg.content.slice(0, 200)}...`
              : assistantMsg.content,
          input: { full: assistantMsg.content },
        });
      }

      const toolCalls = assistantMsg.tool_calls ?? [];

      if (toolCalls.length === 0) {
        // Model produced a text response without calling any tool — finish.
        verdict = {
          passed: false,
          summary:
            assistantMsg.content && typeof assistantMsg.content === "string"
              ? assistantMsg.content
              : "Agent stopped without calling finish_test.",
          failureReason:
            "Agent did not call finish_test. Model responded with text instead of using a tool.",
          expectationsChecked: [],
          steps,
          totalInputTokens,
          totalOutputTokens,
          cacheReadTokens: 0,
          exhaustedBudget: false,
          modelLabel,
        };
        break;
      }

      let finishedThisTurn: AgentRunResult | null = null;
      const followUpScreenshots: { name: string; b64: string; result: string }[] = [];

      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        let input: Record<string, unknown> = {};
        try {
          input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch (_err) {
          input = {};
        }
        const result = await executeTool(call.function.name, input, ctx);

        // Tool result must be a tool-role message with the matching id.
        // Use plain text for max compatibility (Ollama/LM Studio etc).
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.result,
        });

        if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
          followUpScreenshots.push({
            name: call.function.name,
            b64: fs.readFileSync(result.screenshotPath).toString("base64"),
            result: result.result,
          });
        }

        if (result.finished && result.verdict) {
          finishedThisTurn = {
            passed: result.verdict.passed,
            summary: result.verdict.summary,
            failureReason: result.verdict.failureReason,
            expectationsChecked: result.verdict.expectationsChecked,
            steps,
            totalInputTokens,
            totalOutputTokens,
            cacheReadTokens: 0,
            exhaustedBudget: false,
            modelLabel,
          };
        }
      }

      // Inject the resulting screenshots as a user message so the model can SEE
      // the new page state. Compatible with vision-capable models; ignored gracefully
      // by text-only models (they still get a status text).
      if (followUpScreenshots.length > 0 && !finishedThisTurn) {
        const content: OpenAI.Chat.ChatCompletionContentPart[] = [
          {
            type: "text",
            text: `Page state after ${followUpScreenshots.length} tool call${followUpScreenshots.length === 1 ? "" : "s"}:`,
          },
        ];
        for (const shot of followUpScreenshots) {
          content.push({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${shot.b64}` },
          });
        }
        messages.push({ role: "user", content });
      }

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
        cacheReadTokens: 0,
        exhaustedBudget: true,
        modelLabel,
      };
    }

    verdict.exhaustedBudget = exhaustedBudget;
    return verdict;
  }
}
