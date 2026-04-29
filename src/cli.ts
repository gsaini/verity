#!/usr/bin/env node
import { ensureDirs } from "./config.js";
import { loadAllSpecs, loadSpecFromFile } from "./specs/loader.js";
import { runSpec } from "./runner/orchestrator.js";

function printUsage(): void {
  console.log(`Verity — plain-English UI tests, AI-driven.

Usage:
  verity <spec-file-or-id> [--base-url <url>]
  verity list
  verity all [--base-url <url>]

Examples:
  npm test specs/login.spec.md
  npm test -- list
  npm test -- all --base-url https://staging.example.com
`);
}

interface ParsedArgs {
  command: string;
  target?: string;
  baseUrl?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0) return { command: "help" };
  const out: ParsedArgs = { command: "" };
  let positional = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--base-url" || a === "-u") {
      out.baseUrl = args[++i];
    } else if (a === "-h" || a === "--help") {
      out.command = "help";
    } else if (positional === 0) {
      if (a === "list" || a === "all") out.command = a;
      else {
        out.command = "run";
        out.target = a;
      }
      positional++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  ensureDirs();
  const args = parseArgs(process.argv);

  if (args.command === "help" || !args.command) {
    printUsage();
    return;
  }

  if (args.command === "list") {
    const specs = loadAllSpecs();
    if (specs.length === 0) {
      console.log("No specs found.");
      return;
    }
    for (const spec of specs) {
      console.log(`${spec.id}  →  ${spec.name}  (${spec.steps.length} steps, ${spec.expectations.length} expectations)`);
      if (spec.tags?.length) console.log(`   tags: ${spec.tags.join(", ")}`);
    }
    return;
  }

  if (args.command === "all") {
    const specs = loadAllSpecs();
    let pass = 0, fail = 0;
    for (const spec of specs) {
      console.log(`\n▶ Running: ${spec.name}`);
      const run = await runSpec({
        spec,
        trigger: "cli",
        baseUrlOverride: args.baseUrl,
        onStepLog: (step) => process.stdout.write(`  · ${step.type}: ${step.description.slice(0, 100)}\n`),
      });
      console.log(`  ${run.status === "passed" ? "✅ PASS" : "❌ FAIL"} — ${run.summary ?? ""}`);
      console.log(`  Report: ${run.reportPath}`);
      if (run.status === "passed") pass++;
      else fail++;
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }

  if (args.command === "run" && args.target) {
    let spec;
    try {
      if (args.target.endsWith(".md") || args.target.includes("/")) {
        spec = loadSpecFromFile(args.target);
      } else {
        spec = loadAllSpecs().find((s) => s.id === args.target || s.name === args.target);
        if (!spec) throw new Error(`Spec not found: ${args.target}`);
      }
    } catch (err) {
      console.error(`Failed to load spec: ${(err as Error).message}`);
      process.exit(1);
    }

    console.log(`▶ Running: ${spec.name}`);
    console.log(`  Steps: ${spec.steps.length}, expectations: ${spec.expectations.length}`);
    if (args.baseUrl) console.log(`  Base URL override: ${args.baseUrl}`);

    const run = await runSpec({
      spec,
      trigger: "cli",
      baseUrlOverride: args.baseUrl,
      onStepLog: (step) => {
        if (step.type === "thinking") return; // less noisy
        process.stdout.write(`  · [${step.type}] ${step.description.slice(0, 100)}\n`);
      },
    });

    console.log(`\n${run.status === "passed" ? "✅ PASSED" : "❌ FAILED"}: ${run.summary ?? ""}`);
    if (run.failureReason) console.log(`  Reason: ${run.failureReason}`);
    console.log(`  Duration: ${run.durationMs}ms · Tokens in/out: ${run.totalInputTokens}/${run.totalOutputTokens} · Cache: ${run.cacheReadTokens ?? 0}`);
    console.log(`  Report: ${run.reportPath}`);
    process.exit(run.status === "passed" ? 0 : 1);
  }

  printUsage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
