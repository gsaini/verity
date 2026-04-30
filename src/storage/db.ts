import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config, ensureDirs } from "../config.js";
import type { RunRecord, RunStatus, StepRecord } from "../types.js";

let dbInstance: Database.Database | null = null;

function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  ensureDirs();
  const dbPath = path.join(config.dataDir, "runs.sqlite");
  if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      spec_id TEXT NOT NULL,
      spec_name TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      trigger_meta TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      base_url TEXT,
      summary TEXT,
      failure_reason TEXT,
      total_input_tokens INTEGER,
      total_output_tokens INTEGER,
      cache_read_tokens INTEGER,
      report_path TEXT,
      steps_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runs_spec ON runs(spec_id);
  `);
  dbInstance = db;
  return db;
}

export function insertRun(run: RunRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO runs (
      id, spec_id, spec_name, status, trigger, trigger_meta, started_at,
      finished_at, duration_ms, base_url, summary, failure_reason,
      total_input_tokens, total_output_tokens, cache_read_tokens, report_path, steps_json
    ) VALUES (
      @id, @spec_id, @spec_name, @status, @trigger, @trigger_meta, @started_at,
      @finished_at, @duration_ms, @base_url, @summary, @failure_reason,
      @total_input_tokens, @total_output_tokens, @cache_read_tokens, @report_path, @steps_json
    )`,
  ).run({
    id: run.id,
    spec_id: run.specId,
    spec_name: run.specName,
    status: run.status,
    trigger: run.trigger,
    trigger_meta: run.triggerMeta ? JSON.stringify(run.triggerMeta) : null,
    started_at: run.startedAt,
    finished_at: run.finishedAt ?? null,
    duration_ms: run.durationMs ?? null,
    base_url: run.baseUrl ?? null,
    summary: run.summary ?? null,
    failure_reason: run.failureReason ?? null,
    total_input_tokens: run.totalInputTokens ?? null,
    total_output_tokens: run.totalOutputTokens ?? null,
    cache_read_tokens: run.cacheReadTokens ?? null,
    report_path: run.reportPath ?? null,
    steps_json: JSON.stringify(run.steps ?? []),
  });
}

export function updateRun(id: string, patch: Partial<RunRecord>): void {
  const db = getDb();
  const existing = getRun(id);
  if (!existing) return;
  const merged: RunRecord = { ...existing, ...patch };
  db.prepare(
    `UPDATE runs SET
      status = @status,
      finished_at = @finished_at,
      duration_ms = @duration_ms,
      base_url = @base_url,
      summary = @summary,
      failure_reason = @failure_reason,
      total_input_tokens = @total_input_tokens,
      total_output_tokens = @total_output_tokens,
      cache_read_tokens = @cache_read_tokens,
      report_path = @report_path,
      steps_json = @steps_json
     WHERE id = @id`,
  ).run({
    id,
    status: merged.status,
    finished_at: merged.finishedAt ?? null,
    duration_ms: merged.durationMs ?? null,
    base_url: merged.baseUrl ?? null,
    summary: merged.summary ?? null,
    failure_reason: merged.failureReason ?? null,
    total_input_tokens: merged.totalInputTokens ?? null,
    total_output_tokens: merged.totalOutputTokens ?? null,
    cache_read_tokens: merged.cacheReadTokens ?? null,
    report_path: merged.reportPath ?? null,
    steps_json: JSON.stringify(merged.steps ?? []),
  });
}

interface DbRow {
  id: string;
  spec_id: string;
  spec_name: string;
  status: RunStatus;
  trigger: RunRecord["trigger"];
  trigger_meta: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  base_url: string | null;
  summary: string | null;
  failure_reason: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  cache_read_tokens: number | null;
  report_path: string | null;
  steps_json: string;
}

function rowToRun(row: DbRow): RunRecord {
  return {
    id: row.id,
    specId: row.spec_id,
    specName: row.spec_name,
    status: row.status,
    trigger: row.trigger,
    triggerMeta: row.trigger_meta ? JSON.parse(row.trigger_meta) : undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    baseUrl: row.base_url ?? undefined,
    summary: row.summary ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    totalInputTokens: row.total_input_tokens ?? undefined,
    totalOutputTokens: row.total_output_tokens ?? undefined,
    cacheReadTokens: row.cache_read_tokens ?? undefined,
    reportPath: row.report_path ?? undefined,
    steps: row.steps_json ? (JSON.parse(row.steps_json) as StepRecord[]) : [],
  };
}

export function getRun(id: string): RunRecord | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as DbRow | undefined;
  return row ? rowToRun(row) : undefined;
}

export function listRuns(limit = 100): RunRecord[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as DbRow[];
  return rows.map(rowToRun);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Allow `tsx src/storage/db.ts` to bootstrap the DB.
  getDb();
  console.log("Initialized SQLite database at", path.join(config.dataDir, "runs.sqlite"));
}
