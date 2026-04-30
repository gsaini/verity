import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { TestSpec } from "../types.js";

/**
 * Plain-English spec format (markdown):
 *
 * ---
 * name: Login flow
 * baseUrl: https://example.com
 * tags: [auth, smoke]
 * ---
 *
 * ## Description
 * Verify a user can log in with valid credentials.
 *
 * ## Steps
 * - Open the home page.
 * - Click the "Sign in" link in the header.
 * - Type "alice@example.com" into the email field.
 * - Type "correct-horse-battery-staple" into the password field.
 * - Click the "Sign in" button.
 *
 * ## Expectations
 * - The page should display the user's dashboard.
 * - The header should show "Welcome, Alice".
 */

interface ParsedFrontmatter {
  name?: string;
  baseUrl?: string;
  tags?: string[];
  description?: string;
}

function parseFrontmatter(raw: string): { fm: ParsedFrontmatter; body: string } {
  const match = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };
  const block = match[1];
  const body = match[2];
  const fm: ParsedFrontmatter = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let value: string = m[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      const list = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      if (key === "tags") fm.tags = list;
      continue;
    }
    value = value.replace(/^["']|["']$/g, "");
    if (key === "name") fm.name = value;
    else if (key === "baseUrl") fm.baseUrl = value;
    else if (key === "description") fm.description = value;
  }
  return { fm, body };
}

function getSectionBody(body: string, heading: string): string | undefined {
  // Find the heading, then take everything up to the next "## " heading or end of input.
  const headingRe = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const startMatch = headingRe.exec(body);
  if (!startMatch) return undefined;
  const after = body.slice(startMatch.index + startMatch[0].length);
  const nextHeading = /^##\s+/m.exec(after);
  return nextHeading ? after.slice(0, nextHeading.index) : after;
}

function extractSection(body: string, heading: string): string[] {
  const section = getSectionBody(body, heading);
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") || line.startsWith("*") || /^\d+\./.test(line))
    .map((line) =>
      line
        .replace(/^[-*]\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .trim(),
    )
    .filter(Boolean);
}

function extractParagraph(body: string, heading: string): string | undefined {
  const section = getSectionBody(body, heading);
  if (!section) return undefined;
  const text = section
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("-") && !l.startsWith("*") && !/^\d+\./.test(l))
    .join(" ")
    .trim();
  return text || undefined;
}

export function parseSpec(raw: string, filePath?: string): TestSpec {
  const { fm, body } = parseFrontmatter(raw);
  const steps = extractSection(body, "Steps");
  const expectations = extractSection(body, "Expectations");
  const description = fm.description ?? extractParagraph(body, "Description");
  const fileName = filePath ? path.basename(filePath, path.extname(filePath)) : "unnamed";
  const name = fm.name ?? fileName;
  const id = fileName;

  if (steps.length === 0) {
    throw new Error(
      `Spec "${name}" has no steps. Add a "## Steps" section with bullet list of plain-English instructions.`,
    );
  }

  return {
    id,
    name,
    description,
    baseUrl: fm.baseUrl,
    steps,
    expectations,
    tags: fm.tags,
    rawSource: raw,
    filePath,
  };
}

export function loadSpecFromFile(filePath: string): TestSpec {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Spec file not found: ${abs}`);
  }
  const raw = fs.readFileSync(abs, "utf8");
  return parseSpec(raw, abs);
}

export function loadAllSpecs(specsDir = config.specsDir): TestSpec[] {
  if (!fs.existsSync(specsDir)) return [];
  const entries = fs.readdirSync(specsDir);
  const specs: TestSpec[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md") && !entry.endsWith(".spec.md")) continue;
    const full = path.join(specsDir, entry);
    if (fs.statSync(full).isFile()) {
      try {
        specs.push(loadSpecFromFile(full));
      } catch (err) {
        console.error(`Failed to parse spec ${entry}:`, err);
      }
    }
  }
  return specs;
}
