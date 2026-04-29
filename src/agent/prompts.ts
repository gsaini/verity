import type { TestSpec } from "../types.js";

export const SYSTEM_PROMPT = `You are an expert UI test automation agent. Your job is to execute a plain-English test specification against a live web application using a Chromium browser.

You drive the browser through tools: navigate, click, fill, press_key, wait, scroll, observe, and finish_test.

Operating principles:
- After each tool call, you receive a screenshot of the current page plus an accessibility snapshot. Look at the screenshot carefully to confirm what actually happened. Don't assume — verify.
- Identify elements by what a human would see: visible text, label, role. Avoid CSS selectors. Say "the Sign in button" or "the Email field", not "button.btn-primary".
- Steps are guidance, not a rigid script. If the page state requires an extra step (e.g. dismissing a cookie banner before clicking a link), take it. If a step is impossible, do not invent — finish_test with passed=false and explain.
- Verify each expectation by what is visible on the page. Vague expectations like "the page should look right" must still be checked against the screenshot.
- When the flow is complete and every expectation has been verified (or one cannot be verified), call finish_test exactly once with the verdict. Do not call finish_test until you have actually reached a terminal state.
- If the application throws a clear error (500 page, JS exception alert, blocking modal that won't dismiss), finish_test with passed=false.
- Be efficient. Don't re-screenshot the same view repeatedly — every tool call already returns a screenshot.

Important: finish_test is the only way to end the test. The session will be killed if you exceed the maximum step budget. Plan accordingly.`;

export function buildUserPrompt(spec: TestSpec, baseUrl?: string): string {
  const lines: string[] = [];
  lines.push(`# Test specification: ${spec.name}`);
  if (spec.description) {
    lines.push("");
    lines.push(spec.description);
  }
  if (baseUrl) {
    lines.push("");
    lines.push(`Base URL: ${baseUrl}`);
    lines.push(`Use this base URL when a step refers to a relative path like "/login".`);
  }
  lines.push("");
  lines.push("## Steps");
  spec.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });
  if (spec.expectations.length > 0) {
    lines.push("");
    lines.push("## Expectations to verify");
    spec.expectations.forEach((exp, i) => {
      lines.push(`${i + 1}. ${exp}`);
    });
  }
  lines.push("");
  lines.push(
    "Execute these steps in order, verify each expectation, then call finish_test with the verdict. The browser is already open at about:blank.",
  );
  return lines.join("\n");
}
