import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";

export interface PageSnapshot {
  url: string;
  title: string;
  screenshotBase64: string;
  screenshotPath: string;
  ariaSnapshot: string;
}

/**
 * BrowserSession owns a single Playwright Chromium context for the duration
 * of one test run. Screenshots are written to a per-run directory so they
 * can be referenced from the HTML report.
 */
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private screenshotCounter = 0;

  constructor(private readonly screenshotDir: string) {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  }

  async start(): Promise<void> {
    this.browser = await chromium.launch({ headless: config.headless });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (AI-UI-Tester) Chrome/120.0 Safari/537.36",
    });
    this.context.setDefaultTimeout(config.browserTimeoutMs);
    this.page = await this.context.newPage();
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser session not started");
    return this.page;
  }

  async snapshot(label = "step"): Promise<PageSnapshot> {
    const page = this.getPage();
    this.screenshotCounter += 1;
    const safeLabel = label.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
    const fileName = `${String(this.screenshotCounter).padStart(3, "0")}_${safeLabel}.png`;
    const filePath = path.join(this.screenshotDir, fileName);

    const buffer = await page.screenshot({ fullPage: false, type: "png" });
    fs.writeFileSync(filePath, buffer);

    let ariaSnapshot = "";
    try {
      // Playwright's accessibility snapshot — much smaller than HTML and
      // formatted for LLMs.
      ariaSnapshot = await page
        .locator("body")
        .ariaSnapshot({ timeout: 3000 })
        .catch(() => "");
    } catch {
      ariaSnapshot = "";
    }

    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      screenshotBase64: buffer.toString("base64"),
      screenshotPath: filePath,
      ariaSnapshot: ariaSnapshot.slice(0, 8000),
    };
  }

  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {}
    try {
      await this.browser?.close();
    } catch {}
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}
