import { IGNITION } from "../thresholds.js";
import type { StageResult, TokenSnapshot } from "../types.js";
import { blend, ev, hoursSince, invRamp, pct, ramp, toScore, usd } from "../util.js";

/**
 * Stage 1 — narrative ignition.
 *
 * Attention arriving faster than the token's own history justifies. On its own
 * this is not bearish: every token that ever worked looked like this first.
 * It matters as the clock start — concentration and insider flow mean something
 * different in hour six than in week six.
 */
export function scoreIgnition(snap: TokenSnapshot): StageResult {
  const { market } = snap;
  const now = snap.fetchedAt;
  const parts: Array<{ value: number; weight: number }> = [];
  const evidence = [];

  // Churn: volume relative to the pool backing it.
  if (market.liquidityUsd > 0) {
    const ratio = market.volume24hUsd / market.liquidityUsd;
    const v = ramp(ratio, IGNITION.VOL_LIQ_RATIO.lo, IGNITION.VOL_LIQ_RATIO.hi);
    parts.push({ value: v, weight: 0.35 });
    evidence.push(
      ev(
        "Volume / liquidity (24h)",
        `${ratio.toFixed(1)}×`,
        v,
        `${usd(market.volume24hUsd)} traded against ${usd(market.liquidityUsd)} pooled`,
      ),
    );
  }

  // Price velocity.
  const d24 = market.priceChange.h24;
  if (d24 !== undefined) {
    const v = ramp(Math.abs(d24), IGNITION.PRICE_24H_PCT.lo, IGNITION.PRICE_24H_PCT.hi);
    parts.push({ value: v, weight: 0.3 });
    evidence.push(ev("Price change (24h)", `${d24 > 0 ? "+" : ""}${d24.toFixed(1)}%`, v));
  }

  // Age: a fresh pair amplifies everything else.
  const ageH = hoursSince(market.pairCreatedAt, now);
  if (ageH !== undefined) {
    const v = invRamp(ageH, IGNITION.PAIR_AGE_HOURS.newest, IGNITION.PAIR_AGE_HOURS.cold);
    parts.push({ value: v, weight: 0.15 });
    evidence.push(
      ev(
        "Pair age",
        ageH < 48 ? `${ageH.toFixed(0)}h` : `${(ageH / 24).toFixed(1)}d`,
        v,
        ageH < IGNITION.PAIR_AGE_HOURS.newest ? "Minted within the scoring window" : undefined,
      ),
    );
  }

  // New holders arriving.
  if (snap.holderCount !== undefined && snap.holderCount24hAgo) {
    const growth = (snap.holderCount - snap.holderCount24hAgo) / snap.holderCount24hAgo;
    const v = ramp(growth, IGNITION.HOLDER_GROWTH.lo, IGNITION.HOLDER_GROWTH.hi);
    parts.push({ value: v, weight: 0.2 });
    evidence.push(
      ev(
        "Holder growth (24h)",
        `${growth >= 0 ? "+" : ""}${pct(growth, 0)}`,
        v,
        `${snap.holderCount24hAgo.toLocaleString()} → ${snap.holderCount.toLocaleString()}`,
      ),
    );
  }

  if (parts.length === 0) {
    return {
      stage: "ignition",
      score: 0,
      confidence: 0,
      evidence: [],
      unavailable: "No market data in the snapshot.",
    };
  }

  // Four inputs is a full read; fewer is a partial one.
  const confidence = Math.min(1, parts.length / 4);

  return { stage: "ignition", score: toScore(blend(parts)), confidence, evidence };
}
