import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { Phase, Report, StageId } from "../scorer/types.js";

/**
 * One tracked run: a lightweight summary of a single live score, not the
 * full Report. Enough to reconstruct a mint's lifecycle and compare it
 * against a new score, without the store growing without bound.
 *
 * Deliberately excludes any stage that was unavailable at scoring time —
 * a missing dimension must stay missing here too, or a later comparison
 * would be measuring against an invented number.
 */
export interface StoredRun {
  mint: string;
  symbol?: string;
  generatedAt: number;
  composite: number;
  phase: Phase;
  stages: Partial<Record<StageId, { score: number; confidence: number }>>;
}

export interface HistoryStore {
  record(run: StoredRun): void;
  all(): StoredRun[];
}

/**
 * Append-only JSON-lines file on local disk. Deliberately the simplest
 * thing that is honestly a persistent store: no native bindings, no new
 * third-party account (Claude cannot create one on your behalf — same
 * constraint hit deploying to Render), identical code path in the CLI and
 * the API.
 *
 * KNOWN LIMITATION: on Render's free tier the filesystem is ephemeral — this
 * file is wiped on every redeploy or restart, so the HOSTED instance's
 * history does not actually persist yet. The interface below (record/all)
 * is the same shape a real database would expose, so swapping in Postgres
 * or Turso later touches only this file, not any caller — the same
 * provider-interface pattern as src/data/provider.ts. See HANDOVER.md.
 */
export function jsonlHistoryStore(
  path: string = process.env["HISTORY_PATH"] ?? "data/history.jsonl",
): HistoryStore {
  function ensureDir(): void {
    const dir = dirname(path);
    if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  return {
    record(run) {
      ensureDir();
      appendFileSync(path, `${JSON.stringify(run)}\n`, "utf8");
    },
    all() {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as StoredRun);
    },
  };
}

/** Builds the stored summary from a freshly computed Report. */
export function toStoredRun(report: Report): StoredRun {
  const stages: StoredRun["stages"] = {};
  for (const s of report.stages) {
    if (!s.unavailable) stages[s.stage] = { score: s.score, confidence: s.confidence };
  }
  return {
    mint: report.mint,
    ...(report.symbol !== undefined ? { symbol: report.symbol } : {}),
    generatedAt: report.generatedAt,
    composite: report.composite,
    phase: report.phase,
    stages,
  };
}

/** Every stored run for one mint, oldest first — its tracked lifecycle. */
export function lifecycleFor(store: HistoryStore, mint: string): StoredRun[] {
  return store
    .all()
    .filter((r) => r.mint === mint)
    .sort((a, b) => a.generatedAt - b.generatedAt);
}

/** The most recent stored run for every distinct mint other than the one
 *  given — the comparison pool for a new score. */
export function latestByOtherMint(store: HistoryStore, excludeMint: string): StoredRun[] {
  const latest = new Map<string, StoredRun>();
  for (const run of store.all()) {
    if (run.mint === excludeMint) continue;
    const existing = latest.get(run.mint);
    if (!existing || run.generatedAt > existing.generatedAt) latest.set(run.mint, run);
  }
  return [...latest.values()];
}
