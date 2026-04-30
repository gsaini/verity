import crypto from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { runSpec } from "../runner/orchestrator.js";
import { loadAllSpecs, loadSpecFromFile } from "../specs/loader.js";
import type { TestSpec } from "../types.js";

/**
 * Verify the X-Hub-Signature-256 header on a GitHub webhook request.
 * Constant-time comparison.
 */
export function verifyGitHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const [scheme, sig] = signatureHeader.split("=");
  if (scheme !== "sha256" || !sig) return false;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  const digest = hmac.digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(digest, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface GithubPushBody {
  repository?: { full_name?: string; html_url?: string };
  ref?: string;
  head_commit?: { id?: string; message?: string; url?: string; author?: { name?: string } };
  pull_request?: {
    html_url?: string;
    head?: { ref?: string; sha?: string };
    title?: string;
    number?: number;
  };
  action?: string;
}

function selectSpecsForEvent(event: string, body: GithubPushBody): TestSpec[] {
  const all = loadAllSpecs();
  const branch = body.ref?.replace("refs/heads/", "") ?? body.pull_request?.head?.ref ?? "";

  // Convention: tag-based selection.
  // - push to main -> tag "smoke"
  // - pull_request -> tag "pr"
  // - any other -> all specs
  if (event === "push" && branch === "main") {
    const smoke = all.filter((s) => s.tags?.includes("smoke"));
    return smoke.length > 0 ? smoke : all;
  }
  if (event === "pull_request") {
    const pr = all.filter((s) => s.tags?.includes("pr"));
    return pr.length > 0 ? pr : all;
  }
  return all;
}

/**
 * Express handler for GitHub webhooks. Mounted with raw body parsing so we
 * can verify the HMAC signature before parsing the JSON.
 */
export async function handleGithubWebhook(req: Request, res: Response): Promise<void> {
  const event = req.header("x-github-event") ?? "unknown";
  const signature = req.header("x-hub-signature-256");
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (config.githubWebhookSecret) {
    if (!rawBody || !verifyGitHubSignature(rawBody, signature, config.githubWebhookSecret)) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }
  } else {
    console.warn("GITHUB_WEBHOOK_SECRET not set — webhook signature verification skipped.");
  }

  const body: GithubPushBody = req.body ?? {};

  if (event === "ping") {
    res.json({ ok: true, message: "pong" });
    return;
  }

  if (event !== "push" && event !== "pull_request") {
    res.json({ ok: true, message: `Ignored event: ${event}` });
    return;
  }

  const specs = selectSpecsForEvent(event, body);
  if (specs.length === 0) {
    res.json({ ok: true, message: "No matching specs" });
    return;
  }

  // Acknowledge immediately, run async — webhooks must respond fast.
  res.status(202).json({
    ok: true,
    queued: specs.length,
    specs: specs.map((s) => s.id),
  });

  for (const spec of specs) {
    runSpec({
      spec,
      trigger: "github",
      triggerMeta: {
        event,
        repo: body.repository?.full_name,
        ref: body.ref,
        commit: body.head_commit?.id,
        pr: body.pull_request?.number,
        prUrl: body.pull_request?.html_url,
        author: body.head_commit?.author?.name,
      },
    })
      .then((run) => {
        console.log(`[github:${event}] ${run.specName} → ${run.status.toUpperCase()} (${run.id})`);
      })
      .catch((err) => {
        console.error(`Run failed for ${spec.name}:`, err);
      });
  }
}

export function loadSpecByIdOrPath(idOrPath: string): TestSpec | undefined {
  if (idOrPath.includes("/") || idOrPath.endsWith(".md")) {
    try {
      return loadSpecFromFile(idOrPath);
    } catch {
      return undefined;
    }
  }
  return loadAllSpecs().find((s) => s.id === idOrPath || s.name === idOrPath);
}
