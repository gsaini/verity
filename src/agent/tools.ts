import type Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import { BrowserSession } from "../runner/browser.js";

export interface ToolContext {
  session: BrowserSession;
  baseUrl?: string;
  recordStep: (entry: {
    type: import("../types.js").StepRecord["type"];
    description: string;
    input?: Record<string, unknown>;
    result?: string;
    isError?: boolean;
    screenshotPath?: string;
    pageUrl?: string;
    pageTitle?: string;
    durationMs?: number;
  }) => void;
}

export const browserTools: Anthropic.Tool[] = [
  {
    name: "navigate",
    description:
      "Navigate the browser to a URL. Use this for the first step or to change pages. Relative paths (starting with '/') are resolved against the test's base URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL or path starting with /" },
      },
      required: ["url"],
    },
  },
  {
    name: "click",
    description:
      "Click an element on the page. Describe the element using its visible text, role, or label — for example 'the Sign in button', 'the link with text Pricing', or 'the checkbox labeled I agree'. Prefer exact visible text whenever possible.",
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Visible text, label, or role+name of the element to click.",
        },
        role: {
          type: "string",
          enum: [
            "button",
            "link",
            "checkbox",
            "radio",
            "tab",
            "menuitem",
            "option",
            "textbox",
            "combobox",
            "any",
          ],
          description: "Optional ARIA role to disambiguate the target.",
        },
        nth: {
          type: "integer",
          description: "0-indexed match if multiple elements match the target (default 0).",
        },
      },
      required: ["target"],
    },
  },
  {
    name: "fill",
    description:
      "Type text into a form field. Identify the field by its visible label, placeholder, or name — for example 'the Email field', 'the input labeled Password', or 'the search box'.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Visible label, placeholder, or name of the field." },
        value: { type: "string", description: "Text to type into the field." },
        clear: {
          type: "boolean",
          description: "Whether to clear the field before typing (default true).",
        },
      },
      required: ["target", "value"],
    },
  },
  {
    name: "press_key",
    description:
      "Press a keyboard key (e.g. 'Enter', 'Escape', 'Tab', 'ArrowDown'). Use this to submit forms or trigger keyboard shortcuts.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key name as understood by Playwright." },
      },
      required: ["key"],
    },
  },
  {
    name: "wait",
    description:
      "Wait for either a fixed duration in milliseconds, for the page to be stable, or for visible text to appear.",
    input_schema: {
      type: "object",
      properties: {
        ms: { type: "integer", description: "Milliseconds to wait." },
        for_text: {
          type: "string",
          description: "Wait until this text appears on the page.",
        },
      },
    },
  },
  {
    name: "scroll",
    description: "Scroll the page up or down.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "top", "bottom"] },
        amount: { type: "integer", description: "Pixels to scroll for up/down (default 600)." },
      },
      required: ["direction"],
    },
  },
  {
    name: "observe",
    description:
      "Take a fresh screenshot and accessibility snapshot of the current page. Useful when you need to re-check page state after dynamic content loads.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "finish_test",
    description:
      "Call this exactly once when you have completed every step and verified every expectation. This is how you report the verdict. Pass passed=false with a clear failure_reason if any expectation could not be verified or the flow could not be completed.",
    input_schema: {
      type: "object",
      properties: {
        passed: { type: "boolean", description: "Whether the test passed." },
        summary: {
          type: "string",
          description: "One-paragraph summary of what was tested and observed.",
        },
        failure_reason: {
          type: "string",
          description: "If passed is false, what specifically failed.",
        },
        expectations_checked: {
          type: "array",
          items: { type: "string" },
          description:
            "Each expectation from the spec, restated, with a short note on whether and how it was verified.",
        },
      },
      required: ["passed", "summary", "expectations_checked"],
    },
  },
];

function resolveUrl(url: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) return url;
  if (url.startsWith("/") && baseUrl.endsWith("/")) {
    return baseUrl.slice(0, -1) + url;
  }
  if (!url.startsWith("/") && !baseUrl.endsWith("/")) {
    return `${baseUrl}/${url}`;
  }
  return baseUrl + url;
}

async function findLocator(page: Page, target: string, role?: string, nth = 0) {
  const escaped = target.replace(/"/g, '\\"');
  const candidates = [];

  if (role && role !== "any") {
    candidates.push(page.getByRole(role as Parameters<typeof page.getByRole>[0], { name: target, exact: false }));
  }
  // Common interactive roles first
  candidates.push(page.getByRole("button", { name: target, exact: false }));
  candidates.push(page.getByRole("link", { name: target, exact: false }));
  candidates.push(page.getByLabel(target, { exact: false }));
  candidates.push(page.getByPlaceholder(target, { exact: false }));
  candidates.push(page.getByText(target, { exact: true }));
  candidates.push(page.getByText(target, { exact: false }));
  candidates.push(page.locator(`text="${escaped}"`));

  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      if (count > nth) {
        const located = candidate.nth(nth);
        if (await located.isVisible().catch(() => false)) {
          return located;
        }
      }
    } catch {
      // try next candidate
    }
  }

  // Fall back to first matching, even if not visible — Playwright's
  // auto-waiting will still scroll into view.
  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      if (count > nth) return candidate.nth(nth);
    } catch {}
  }

  throw new Error(`No element matched "${target}"${role ? ` (role=${role})` : ""}`);
}

/**
 * Execute a tool call from Claude. Returns a string result that gets fed
 * back into the conversation as a tool_result block.
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ result: string; isError: boolean; screenshotPath?: string; finished?: boolean; verdict?: { passed: boolean; summary: string; failureReason?: string; expectationsChecked: string[] } }> {
  const start = Date.now();
  const page = ctx.session.getPage();
  try {
    switch (toolName) {
      case "navigate": {
        const url = String(input.url);
        const fullUrl = resolveUrl(url, ctx.baseUrl);
        await page.goto(fullUrl, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        const snap = await ctx.session.snapshot("navigate");
        ctx.recordStep({
          type: "navigate",
          description: `Navigated to ${fullUrl}`,
          input: { url: fullUrl },
          screenshotPath: snap.screenshotPath,
          pageUrl: snap.url,
          pageTitle: snap.title,
          durationMs: Date.now() - start,
        });
        return { result: `Navigated to ${snap.url}. Page title: "${snap.title}".`, isError: false, screenshotPath: snap.screenshotPath };
      }
      case "click": {
        const target = String(input.target);
        const role = input.role as string | undefined;
        const nth = typeof input.nth === "number" ? input.nth : 0;
        const locator = await findLocator(page, target, role, nth);
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await locator.click({ timeout: 8000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        const snap = await ctx.session.snapshot(`click_${target.slice(0, 20)}`);
        ctx.recordStep({
          type: "click",
          description: `Clicked "${target}"`,
          input: { target, role, nth },
          screenshotPath: snap.screenshotPath,
          pageUrl: snap.url,
          pageTitle: snap.title,
          durationMs: Date.now() - start,
        });
        return { result: `Clicked "${target}". Now at ${snap.url}.`, isError: false, screenshotPath: snap.screenshotPath };
      }
      case "fill": {
        const target = String(input.target);
        const value = String(input.value);
        const clear = input.clear !== false;
        const locator = await findLocator(page, target);
        await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        if (clear) await locator.fill("");
        await locator.fill(value);
        const snap = await ctx.session.snapshot(`fill_${target.slice(0, 20)}`);
        ctx.recordStep({
          type: "fill",
          description: `Filled "${target}" with "${value.length > 60 ? value.slice(0, 60) + "..." : value}"`,
          input: { target, value: value.length > 200 ? value.slice(0, 200) + "..." : value },
          screenshotPath: snap.screenshotPath,
          pageUrl: snap.url,
          pageTitle: snap.title,
          durationMs: Date.now() - start,
        });
        return { result: `Filled "${target}".`, isError: false, screenshotPath: snap.screenshotPath };
      }
      case "press_key": {
        const key = String(input.key);
        await page.keyboard.press(key);
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        const snap = await ctx.session.snapshot(`key_${key}`);
        ctx.recordStep({
          type: "press_key",
          description: `Pressed ${key}`,
          input: { key },
          screenshotPath: snap.screenshotPath,
          pageUrl: snap.url,
          pageTitle: snap.title,
          durationMs: Date.now() - start,
        });
        return { result: `Pressed ${key}.`, isError: false, screenshotPath: snap.screenshotPath };
      }
      case "wait": {
        const ms = typeof input.ms === "number" ? input.ms : undefined;
        const forText = typeof input.for_text === "string" ? input.for_text : undefined;
        if (forText) {
          await page.getByText(forText, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
        } else {
          await page.waitForTimeout(ms ?? 1000);
        }
        const snap = await ctx.session.snapshot("wait");
        ctx.recordStep({
          type: "wait",
          description: forText ? `Waited for "${forText}"` : `Waited ${ms ?? 1000}ms`,
          input: { ms, for_text: forText },
          screenshotPath: snap.screenshotPath,
          pageUrl: snap.url,
          pageTitle: snap.title,
          durationMs: Date.now() - start,
        });
        return { result: `Wait complete.`, isError: false, screenshotPath: snap.screenshotPath };
      }
      case "scroll": {
        const direction = String(input.direction);
        const amount = typeof input.amount === "number" ? input.amount : 600;
        if (direction === "down") await page.evaluate((n) => window.scrollBy(0, n), amount);
        else if (direction === "up") await page.evaluate((n) => window.scrollBy(0, -n), amount);
        else if (direction === "top") await page.evaluate(() => window.scrollTo(0, 0));
        else if (direction === "bottom") await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(300);
        const snap = await ctx.session.snapshot(`scroll_${direction}`);
        ctx.recordStep({
          type: "scroll",
          description: `Scrolled ${direction}`,
          input: { direction, amount },
          screenshotPath: snap.screenshotPath,
          pageUrl: snap.url,
          pageTitle: snap.title,
          durationMs: Date.now() - start,
        });
        return { result: `Scrolled ${direction}.`, isError: false, screenshotPath: snap.screenshotPath };
      }
      case "observe": {
        const snap = await ctx.session.snapshot("observe");
        ctx.recordStep({
          type: "screenshot",
          description: `Observed page`,
          screenshotPath: snap.screenshotPath,
          pageUrl: snap.url,
          pageTitle: snap.title,
          durationMs: Date.now() - start,
        });
        return { result: `URL: ${snap.url}\nTitle: ${snap.title}\nAccessibility tree:\n${snap.ariaSnapshot || "(empty)"}`, isError: false, screenshotPath: snap.screenshotPath };
      }
      case "finish_test": {
        const passed = Boolean(input.passed);
        const summary = String(input.summary ?? "");
        const failureReason = typeof input.failure_reason === "string" ? input.failure_reason : undefined;
        const expectationsChecked = Array.isArray(input.expectations_checked)
          ? (input.expectations_checked as unknown[]).map((s) => String(s))
          : [];
        ctx.recordStep({
          type: "summary",
          description: passed ? "Test passed" : `Test failed: ${failureReason ?? "see summary"}`,
          input: { passed, summary, failureReason, expectationsChecked },
          durationMs: Date.now() - start,
        });
        return {
          result: `Recorded verdict: ${passed ? "PASS" : "FAIL"}.`,
          isError: false,
          finished: true,
          verdict: { passed, summary, failureReason, expectationsChecked },
        };
      }
      default:
        return { result: `Unknown tool: ${toolName}`, isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let snap;
    try {
      snap = await ctx.session.snapshot(`error_${toolName}`);
    } catch {}
    ctx.recordStep({
      type: toolName as import("../types.js").StepRecord["type"],
      description: `Error in ${toolName}: ${message}`,
      input,
      isError: true,
      result: message,
      screenshotPath: snap?.screenshotPath,
      pageUrl: snap?.url,
      pageTitle: snap?.title,
      durationMs: Date.now() - start,
    });
    return { result: `Error: ${message}`, isError: true, screenshotPath: snap?.screenshotPath };
  }
}
