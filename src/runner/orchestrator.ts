import crypto from "node:crypto";
import path from "node:path";
import { runAgent } from "../agent/executor.js";
import { config, ensureDirs } from "../config.js";
import { generateHtmlReport } from "../reports/generator.js";
import { insertRun, updateRun } from "../storage/db.js";
import type { RunRecord, RunStatus, StepRecord, TestSpec } from "../types.js";
import { BrowserSession } from "./browser.js";

export interface RunOptions {
  spec: TestSpec;
  trigger: RunRecord["trigger"];
  triggerMeta?: Record<string, unknown>;
  baseUrlOverride?: string;
  /** Optional LLM provider override: "anthropic" | "openai" | "ollama" | "groq". */
  providerOverride?: string;
  onStepLog?: (step: StepRecord) => void;
}

function newRunId(): string {
  return `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export async function runSpec(options: RunOptions): Promise<RunRecord> {
  ensureDirs();
  const runId = newRunId();
  const startedAt = new Date().toISOString();
  const baseUrl = options.baseUrlOverride ?? options.spec.baseUrl ?? config.targetBaseUrl;

  const initialRun: RunRecord = {
    id: runId,
    specId: options.spec.id,
    specName: options.spec.name,
    status: "running",
    trigger: options.trigger,
    triggerMeta: options.triggerMeta,
    startedAt,
    baseUrl,
    steps: [],
  };
  insertRun(initialRun);

  const screenshotDir = path.join(config.dataDir, "screenshots", runId);
  const session = new BrowserSession(screenshotDir);
  let result: RunRecord = { ...initialRun };

  try {
    await session.start();
    const agentResult = await runAgent({
      spec: options.spec,
      session,
      baseUrl,
      providerOverride: options.providerOverride,
      onStepLog: options.onStepLog,
    });

    const status: RunStatus = agentResult.passed ? "passed" : "failed";
    const finishedAt = new Date().toISOString();
    result = {
      ...initialRun,
      status,
      finishedAt,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      summary: agentResult.summary,
      failureReason: agentResult.failureReason,
      steps: agentResult.steps,
      totalInputTokens: agentResult.totalInputTokens,
      totalOutputTokens: agentResult.totalOutputTokens,
      cacheReadTokens: agentResult.cacheReadTokens,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date().toISOString();
    result = {
      ...initialRun,
      status: "error",
      finishedAt,
      durationMs: Date.now() - new Date(startedAt).getTime(),
      summary: `Test runner crashed: ${message}`,
      failureReason: message,
      steps: result.steps,
    };
  } finally {
    await session.close();
  }

  // Generate HTML report and write run.json.
  try {
    const reportPath = generateHtmlReport(result, screenshotDir);
    result.reportPath = reportPath;
  } catch (err) {
    console.error("Failed to generate report:", err);
  }

  updateRun(runId, result);
  return result;
}
