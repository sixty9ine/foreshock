import { CONCENTRATION } from "../thresholds.js";
import type { StageResult, TokenSnapshot } from "../types.js";
import { blend, clamp, ev, floatHolders, floatSupply, invRamp, pct, ramp, toScore } from "../util.js";

/**
 * Stage 2 — wallet concentration.
 *
 * Measured against FLOAT, not total supply. LP positions, burn addresses,
 * CEX omnibus wallets and program-owned accounts are excluded before anything
 * is divided. A concentration read that counts the Raydium pool as the top
 * holder marks every healthy token as captured.
 *
 * CONFIDENCE IS COVERAGE, NOT ROW COUNT. A provider that hands back 1000
 * unsorted dust wallets has told you nothing about the head of the
 * distribution, and reporting "top 10 hold 0%" at full confidence off that
 * is worse than refusing to answer. So the stage asks two questions before
 * it trusts itself: are these rows actually the largest holders, and what
 * fraction of supply do they account for?
 */
export function scoreConcentration(snap: TokenSnapshot): StageResult {
  const holders = floatHolders(snap);

  if (snap.holders.length === 0) {
    return {
      stage: "concentration",
      score: 0,
      confidence: 0,
      evidence: [],
      unavailable:
        "No holder data at all — no chain provider contributed. Check the report's caveats for a provider failure, and that HELIUS_API_KEY is set.",
    };
  }

  if (holders.length === 0) {
    return {
      stage: "concentration",
      score: 0,
      confidence: 0,
      evidence: [],
      unavailable: `All ${snap.holders.length} holders are tagged as LP, CEX, burn or program accounts, so there is no float to measure. Either the token is entirely pool-held, or the tagging is over-matching.`,
    };
  }

  const base = snap.supply.circulating ?? snap.supply.total;
  const observed = snap.holders.reduce((s, h) => s + h.amount, 0);
  const coverage = base > 0 ? clamp(observed / base) : 0;

  // A sample that is not the head of the distribution cannot answer this
  // question at all. Refuse rather than produce a confident zero.
  if (snap.holdersAreLargest !== true) {
    return {
      stage: "concentration",
      score: 0,
      confidence: 0,
      evidence: [
        ev("Supply covered by returned rows", pct(coverage), undefined, `${snap.holders.length} rows`),
      ],
      unavailable:
        "The provider did not return holders largest-first, so these rows are a sample rather than the head of the distribution. Concentration cannot be computed from an unsorted page.",
    };
  }

  const float = floatSupply(snap);
  const sorted = [...holders].sort((a, b) => b.amount - a.amount);
  const shareOfFloat = (h: { amount: number }) => h.amount / float;

  const top1 = shareOfFloat(sorted[0]!);
  const top10 = sorted.slice(0, 10).reduce((s, h) => s + shareOfFloat(h), 0);

  // How few wallets control half the float. If the observed head never
  // reaches 50%, say so — do NOT report the row count as if it were an answer.
  let cumulative = 0;
  let walletsToHalf: number | null = null;
  for (const [i, h] of sorted.entries()) {
    cumulative += shareOfFloat(h);
    if (cumulative >= 0.5) {
      walletsToHalf = i + 1;
      break;
    }
  }

  const vTop10 = ramp(top10, CONCENTRATION.TOP10_FLOAT.lo, CONCENTRATION.TOP10_FLOAT.hi);
  const vTop1 = ramp(top1, CONCENTRATION.TOP1_FLOAT.lo, CONCENTRATION.TOP1_FLOAT.hi);
  const vHalf =
    walletsToHalf === null
      ? null
      : invRamp(walletsToHalf, CONCENTRATION.WALLETS_TO_HALF.worst, CONCENTRATION.WALLETS_TO_HALF.benign);

  const excludedCount = snap.holders.length - holders.length;

  const evidence = [
    ev("Top 10 share of float", pct(top10), vTop10),
    ev("Largest single holder", pct(top1), vTop1, sorted[0]!.address),
    walletsToHalf !== null
      ? ev(
          "Wallets to control half the float",
          String(walletsToHalf),
          vHalf ?? undefined,
          walletsToHalf <= CONCENTRATION.WALLETS_TO_HALF.worst
            ? "A handful of wallets can set the price alone"
            : undefined,
        )
      : ev(
          "Wallets to control half the float",
          `more than ${sorted.length}`,
          undefined,
          "The observed head does not reach half the float, so the true figure is larger and is not counted toward the score",
        ),
    ev("Supply covered by returned rows", pct(coverage), undefined, `${snap.holders.length} rows`),
    ev(
      "Excluded from float",
      `${excludedCount} address${excludedCount === 1 ? "" : "es"}`,
      undefined,
      "LP, burn, CEX and program accounts are not counted as holders",
    ),
  ];

  // top1 and top10 are reliable from a largest-first head even when coverage
  // is modest — the whole point of the head is that it contains the whales.
  // Below ~25% coverage, though, an untagged pool or treasury could still be
  // sitting outside the window, so trust the read less.
  const confidence = clamp(0.45 + 0.55 * ramp(coverage, 0.05, 0.4), 0.2, 1);

  const parts = [
    { value: vTop10, weight: 0.5 },
    { value: vTop1, weight: 0.35 },
  ];
  if (vHalf !== null) parts.push({ value: vHalf, weight: 0.25 });

  return { stage: "concentration", score: toScore(blend(parts)), confidence, evidence };
}
