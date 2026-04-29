import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import { config, ensureDirs } from "./config.js";
import { handleGithubWebhook, loadSpecByIdOrPath } from "./triggers/github.js";
import { loadAllSpecs } from "./specs/loader.js";
import { runSpec } from "./runner/orchestrator.js";
import { listRuns, getRun } from "./storage/db.js";

ensureDirs();

const app = express();

// Capture raw body for signature verification on the GitHub route, then parse JSON.
app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// --- Health ---
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- GitHub webhook ---
app.post("/webhooks/github", (req, res, next) => {
  Promise.resolve(handleGithubWebhook(req, res)).catch(next);
});

// --- Manual trigger ---
app.post("/runs", (req, res, next) => {
  (async () => {
    const { specId, specPath, baseUrl, async: runAsync = true } = req.body ?? {};
    const idOrPath = specPath ?? specId;
    if (!idOrPath) {
      return res.status(400).json({ error: "specId or specPath is required" });
    }
    const spec = loadSpecByIdOrPath(String(idOrPath));
    if (!spec) {
      return res.status(404).json({ error: `Spec not found: ${idOrPath}` });
    }

    if (runAsync) {
      res.status(202).json({ ok: true, queued: spec.id, name: spec.name });
      runSpec({ spec, trigger: "manual", triggerMeta: { source: "api" }, baseUrlOverride: baseUrl })
        .then((run) => console.log(`[api] ${run.specName} → ${run.status.toUpperCase()} (${run.id})`))
        .catch((err) => console.error("Run failed:", err));
      return;
    }

    const run = await runSpec({
      spec,
      trigger: "manual",
      triggerMeta: { source: "api" },
      baseUrlOverride: baseUrl,
    });
    res.json({ ok: true, run });
  })().catch(next);
});

// --- Specs API ---
app.get("/specs", (_req, res) => {
  const specs = loadAllSpecs().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    baseUrl: s.baseUrl,
    tags: s.tags,
    stepCount: s.steps.length,
    expectationCount: s.expectations.length,
  }));
  res.json({ specs });
});

// --- Runs API ---
app.get("/runs", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  res.json({ runs: listRuns(limit) });
});

app.get("/runs/:id", (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: "not found" });
  res.json({ run });
});

// --- Static report files ---
app.get("/runs/:id/report", (req, res) => {
  const run = getRun(req.params.id);
  if (!run || !run.reportPath) return res.status(404).send("Report not found");
  res.sendFile(path.resolve(run.reportPath));
});

app.use("/reports-static", express.static(config.reportsDir));

// --- Dashboard (server-rendered HTML) ---
app.get("/", (_req, res) => {
  const runs = listRuns(50);
  const specs = loadAllSpecs();

  const totalRuns = runs.length;
  const passed = runs.filter((r) => r.status === "passed").length;
  const failed = runs.filter((r) => r.status === "failed" || r.status === "error").length;
  const running = runs.filter((r) => r.status === "running").length;

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const fmtDur = (ms?: number) => (ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
  const fmtTime = (iso: string) => new Date(iso).toLocaleString();

  const statusBadge = (s: string) => {
    const colors: Record<string, string> = {
      passed: "#10b981",
      failed: "#ef4444",
      error: "#ef4444",
      running: "#f59e0b",
      queued: "#6b7280",
    };
    return `<span style="background:${colors[s] ?? "#6b7280"};color:#fff;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase">${s}</span>`;
  };

  const runRows = runs
    .map(
      (r) => `
      <tr>
        <td><a href="/runs/${r.id}/report" target="_blank">${escape(r.specName)}</a></td>
        <td>${statusBadge(r.status)}</td>
        <td>${escape(r.trigger)}</td>
        <td>${fmtDur(r.durationMs)}</td>
        <td title="${escape(r.startedAt)}">${escape(fmtTime(r.startedAt))}</td>
        <td>${r.failureReason ? `<span style="color:#fca5a5">${escape(r.failureReason.slice(0, 80))}${r.failureReason.length > 80 ? "…" : ""}</span>` : ""}</td>
      </tr>`,
    )
    .join("");

  const specRows = specs
    .map(
      (s) => `
      <tr>
        <td><strong>${escape(s.name)}</strong></td>
        <td><code>${escape(s.id)}</code></td>
        <td>${s.steps.length} steps · ${s.expectations.length} expectations</td>
        <td>${(s.tags ?? []).map((t) => `<span style="background:#243056;padding:2px 8px;border-radius:4px;font-size:11px;margin-right:4px">${escape(t)}</span>`).join("")}</td>
        <td>
          <form method="post" action="/runs" onsubmit="event.preventDefault();fetch('/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({specId:'${escape(s.id)}'})}).then(r=>r.json()).then(d=>{alert('Queued: '+d.queued);setTimeout(()=>location.reload(),1500)});">
            <button type="submit" style="background:#5b8cff;color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:600">▶ Run</button>
          </form>
        </td>
      </tr>`,
    )
    .join("");

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>AI UI Tester · Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #0b1020; color: #e8ecf5; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  header h1 { margin: 0; font-size: 22px; }
  header .sub { color: #8892b0; font-size: 13px; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { background: #131a30; border: 1px solid #243056; border-radius: 10px; padding: 14px; }
  .stat .label { color: #8892b0; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .stat .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
  .card { background: #131a30; border: 1px solid #243056; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
  .card h2 { margin: 0 0 12px; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #243056; }
  th { color: #8892b0; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  a { color: #5b8cff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
  .empty { text-align: center; padding: 40px; color: #8892b0; }
</style>
</head>
<body>
<div class="container">
  <header>
    <div>
      <h1>🤖 AI UI Tester</h1>
      <div class="sub">Plain-English UI tests · Powered by Claude Opus 4.7 + Playwright</div>
    </div>
  </header>

  <div class="grid">
    <div class="stat"><div class="label">Total runs</div><div class="value">${totalRuns}</div></div>
    <div class="stat"><div class="label">Passed</div><div class="value" style="color:#10b981">${passed}</div></div>
    <div class="stat"><div class="label">Failed</div><div class="value" style="color:#ef4444">${failed}</div></div>
    <div class="stat"><div class="label">Running</div><div class="value" style="color:#f59e0b">${running}</div></div>
  </div>

  <section class="card">
    <h2>Test specs (${specs.length})</h2>
    ${
      specs.length === 0
        ? `<div class="empty">No specs yet. Drop a markdown file in <code>${escape(config.specsDir)}</code>.</div>`
        : `<table>
            <thead><tr><th>Name</th><th>ID</th><th>Size</th><th>Tags</th><th></th></tr></thead>
            <tbody>${specRows}</tbody>
          </table>`
    }
  </section>

  <section class="card">
    <h2>Recent runs</h2>
    ${
      runs.length === 0
        ? `<div class="empty">No runs yet. Click ▶ Run on a spec or trigger via webhook.</div>`
        : `<table>
            <thead><tr><th>Spec</th><th>Status</th><th>Trigger</th><th>Duration</th><th>Started</th><th>Notes</th></tr></thead>
            <tbody>${runRows}</tbody>
          </table>`
    }
  </section>
</div>
</body>
</html>`);
});

// --- Error handler ---
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Server error:", err);
  res.status(500).json({ error: err.message });
});

const port = config.port;
app.listen(port, config.host, () => {
  console.log(`AI UI Tester listening on http://${config.host}:${port}`);
  console.log(`  Dashboard:        http://localhost:${port}/`);
  console.log(`  GitHub webhook:   http://localhost:${port}/webhooks/github`);
  console.log(`  Manual trigger:   POST http://localhost:${port}/runs  {"specId": "..."}`);
  console.log(`  Provider:         ${config.provider}`);
  if (config.provider === "anthropic" && !config.anthropicApiKey) {
    console.warn("\n  ⚠️  ANTHROPIC_API_KEY is not set. Runs will fail until you configure it in .env.");
  }
  if (config.provider === "openai" && !config.openaiApiKey && config.openaiBaseUrl.includes("openai.com")) {
    console.warn("\n  ⚠️  OPENAI_API_KEY is not set. Runs will fail until you configure it in .env.");
  }
});
