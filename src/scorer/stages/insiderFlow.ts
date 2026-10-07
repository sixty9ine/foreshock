import { INSIDER_FLOW } from "../thresholds.js";
import type { EarlyWallet, StageResult, TokenSnapshot } from "../types.js";
import { blend, ev, floatSupply, pct, ramp, toScore } from "../util.js";

/**
 * Stage 4 — insider flows.
 *
 * The stage that actually separates a token that is going to unwind from one
 * that is merely popular. Three readings on the earliest cohort:
 *
 *   1. Are they selling into the move?
 *   2. Were they funded from the same place — one actor in many wallets?
 *   3. If they have not sold yet, how much of the float is sitting over the
 *      market waiting to?
 *
 * Needs first-buyer data, which not every provider exposes. When it is
 * missing the stage declares itself unavailable rather than guessing: a
 * fabricated insider read is worse than none.
 */
export function scoreInsiderFlow(snap: TokenSnapshot): StageResult {
  const cohort = (snap.earlyWallets ?? [])
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .slice(0, INSIDER_FLOW.EARLY_COHORT);

  if (cohort.length === 0) {
    return {
      stage: "insiderFlow",
      score: 0,
      confidence: 0,
      evidence: [],
      unavailable:
        "No early-buyer data. This provider does not expose first buyers, or the pair is too new to have them.",
    };
  }

  const acquired = cohort.reduce((s, w) => s + w.acquiredAmount, 0);
  const held = cohort.reduce((s, w) => s + w.currentAmount, 0);
  const distributed = acquired > 0 ? Math.max(0, (acquired - held) / acquired) : 0;
  const vDist = ramp(distributed, INSIDER_FLOW.DISTRIBUTED.lo, INSIDER_FLOW.DISTRIBUTED.hi);

  const { largestCluster, funder } = findLargestCluster(cohort);
  const vCluster = ramp(largestCluster, INSIDER_FLOW.CLUSTER_SIZE.lo, INSIDER_FLOW.CLUSTER_SIZE.hi);

  const cohortFloat = held / floatSupply(snap);
  const vOverhang = ramp(
    cohortFloat,
    INSIDER_FLOW.COHORT_FLOAT_HELD.lo,
    INSIDER_FLOW.COHORT_FLOAT_HELD.hi,
  );

  const fullyExited = cohort.filter((w) => w.currentAmount === 0).length;

  const evidence = [
    ev(
      "Early cohort distributed",
      pct(distributed),
      vDist,
      `${fullyExited} of ${cohort.length} first buyers are fully out`,
    ),
    ev(
      "Largest shared-funder cluster",
      `${largestCluster} wallet${largestCluster === 1 ? "" : "s"}`,
      vCluster,
      largestCluster >= INSIDER_FLOW.CLUSTER_SIZE.lo && funder
        ? `Funded from ${funder}`
        : "No common funding source found among early buyers",
    ),
    ev(
      "Float still held by the early cohort",
      pct(cohortFloat),
      vOverhang,
      "Supply positioned above the market that has not moved yet",
    ),
  ];

  // Distribution and overhang are two readings of one lifecycle: a cohort that
  // has sold cannot also be overhanging. Weight whichever is further along.
  const parts = [
    { value: vDist, weight: 0.45 },
    { value: vCluster, weight: 0.3 },
    { value: vOverhang, weight: distributed > 0.5 ? 0.1 : 0.25 },
  ];

  // A partial cohort is still informative, just less so.
  const coverage = cohort.length / INSIDER_FLOW.EARLY_COHORT;
  const traced = cohort.filter((w) => w.fundedBy).length / cohort.length;
  const confidence = Math.max(0.3, 0.6 * Math.min(1, coverage) + 0.4 * traced);

  if (traced < 0.5) {
    evidence.push(
      ev(
        "Funding traceability",
        pct(traced, 0),
        undefined,
        "Under half the cohort has a traceable funder; the cluster read is weak",
      ),
    );
  }

  return { stage: "insiderFlow", score: toScore(blend(parts)), confidence, evidence };
}

/** Largest set of early wallets sharing one funding address. */
function findLargestCluster(cohort: EarlyWallet[]): {
  largestCluster: number;
  funder?: string;
} {
  const byFunder = new Map<string, number>();
  for (const w of cohort) {
    if (!w.fundedBy) continue;
    byFunder.set(w.fundedBy, (byFunder.get(w.fundedBy) ?? 0) + 1);
  }
  let largestCluster = 0;
  let funder: string | undefined;
  for (const [addr, n] of byFunder) {
    if (n > largestCluster) {
      largestCluster = n;
      funder = addr;
    }
  }
  return funder === undefined ? { largestCluster } : { largestCluster, funder };
}
