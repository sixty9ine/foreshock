import {
  jsonlHistoryStore,
  latestByOtherMint,
  lifecycleFor,
  toStoredRun,
  type StoredRun,
} from "./data/history.js";
import type { Report, StageId } from "./scorer/types.js";

/**
 * Composes a plain-language read of a Report, plus — if genuinely
 * applicable — a note that it resembles a token this tool has actually
 * tracked before. Lives outside src/scorer deliberately: the scorer stays a
 * pure function with no knowledge that history exists at all. This module
 * is the only thing allowed to consume stored history, and it is bound by
 * the same rule as the rest of the project: never say more than the data
 * supports.
 *
 * Two places that discipline shows up concretely:
 *   - A candidate is only cited as "similar" if enough of its OWN stage
 *     scores overlap with the current ones to mean something (see
 *     MIN_SHARED_STAGES) — a single shared dimension is not a pattern.
 *   - What a similar token "went on to do" is read only from genuinely
 *     stored later runs for that SAME mint. A token tracked only once has
 *     no second data point, and this says so rather than guessing what
 *     might come next.
 */

const MIN_SHARED_STAGES = 2;
const MAX_MATCHES = 2;
/** Mean absolute score difference over shared stages, 0..1. Above this a
 *  candidate is not similar enough to be worth citing. */
const SIMILARITY_THRESHOLD = 0.2;

export interface SimilarMatch {
  mint: string;
  symbol?: string;
  /** 0 = identical on shared stages, 1 = maximally different. */
  distance: number;
  sharedStages: number;
  lifecycle: StoredRun[];
}

export interface Inference {
  summary: string;
  similar: Array<{ mint: string; symbol?: string; note: string }>;
}

/**
 * Compares a freshly scored report against everything tracked before it,
 * THEN records it — so a token is never compared against itself, and this
 * run becomes part of the pool for whatever comes next. Shared by the CLI
 * and the API so the two never drift.
 */
export function trackAndInfer(report: Report): Inference {
  const store = jsonlHistoryStore();
  const pool = latestByOtherMint(store, report.mint);
  const matches = findSimilar(report, pool, (mint) => lifecycleFor(store, mint));
  const inference = buildInference(report, matches);
  store.record(toStoredRun(report));
  return inference;
}

export function findSimilar(
  report: Report,
  candidates: StoredRun[],
  lifecycleOf: (mint: string) => StoredRun[],
): SimilarMatch[] {
  const currentStages = new Map(
    report.stages.filter((s) => !s.unavailable).map((s) => [s.stage, s.score]),
  );

  const scored: Array<{ candidate: StoredRun; distance: number; shared: number }> = [];
  for (const candidate of candidates) {
    let diffSum = 0;
    let shared = 0;
    for (const stage of Object.keys(candidate.stages) as StageId[]) {
      const mine = currentStages.get(stage);
      const theirs = candidate.stages[stage];
      if (mine === undefined || !theirs) continue;
      diffSum += Math.abs(mine - theirs.score);
      shared += 1;
    }
    if (shared < MIN_SHARED_STAGES) continue;
    const distance = diffSum / shared / 100;
    if (distance > SIMILARITY_THRESHOLD) continue;
    scored.push({ candidate, distance, shared });
  }

  scored.sort((a, b) => a.distance - b.distance);

  return scored.slice(0, MAX_MATCHES).map(({ candidate, distance, shared }) => {
    const lifecycle = lifecycleOf(candidate.mint);
    // The most recent run for this mint may not have resolved a symbol
    // (e.g. the market provider had nothing that time) even though an
    // earlier run did — the token's identity didn't change, so prefer any
    // known symbol over the latest row specifically.
    const symbol = candidate.symbol ?? lifecycle.find((r) => r.symbol !== undefined)?.symbol;
    return {
      mint: candidate.mint,
      ...(symbol !== undefined ? { symbol } : {}),
      distance: Number(distance.toFixed(2)),
      sharedStages: shared,
      lifecycle,
    };
  });
}

const STAGE_LABEL: Record<StageId, string> = {
  ignition: "ignition",
  concentration: "concentration",
  liquidityTrap: "the liquidity trap",
  insiderFlow: "insider flow",
  exhaustion: "exhaustion",
};

export function buildInference(report: Report, matches: SimilarMatch[]): Inference {
  return {
    summary: summarize(report),
    similar: matches.map((m) => ({
      mint: m.mint,
      ...(m.symbol !== undefined ? { symbol: m.symbol } : {}),
      note: describeLifecycle(m),
    })),
  };
}

function summarize(r: Report): string {
  const label = r.symbol ?? shortMint(r.mint);
  const live = r.stages.filter((s) => !s.unavailable && s.confidence > 0.25);
  const strongest = [...live].sort((a, b) => b.score - a.score)[0];
  const stageNote = strongest
    ? ` The strongest signal is ${STAGE_LABEL[strongest.stage]} at ${strongest.score}/100.`
    : " No single stage is driving this with much confidence yet.";
  return `${label} reads ${r.composite}/100 (${r.phase}). ${r.phaseRationale}${stageNote}`;
}

function describeLifecycle(m: SimilarMatch): string {
  const label = m.symbol ?? shortMint(m.mint);
  if (m.lifecycle.length < 2) {
    return `This looks similar to the cycle of ${label} — but ${label} has only been tracked once so far, so there is no later run yet to say what it went on to do.`;
  }
  const first = m.lifecycle[0]!;
  const last = m.lifecycle[m.lifecycle.length - 1]!;
  const direction =
    last.composite > first.composite ? "climbed" : last.composite < first.composite ? "fell" : "held steady";
  const phaseChange =
    first.phase === last.phase ? `stayed ${last.phase}` : `moved from ${first.phase} to ${last.phase}`;
  return `This looks similar to the cycle of ${label}, tracked across ${m.lifecycle.length} runs: its composite ${direction} from ${first.composite}/100 to ${last.composite}/100, and its phase ${phaseChange}.`;
}

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
