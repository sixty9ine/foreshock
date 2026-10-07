import { EXHAUSTION } from "../thresholds.js";
import type { Candle, StageResult, TokenSnapshot } from "../types.js";
import { blend, ev, pct, ramp, toScore } from "../util.js";

/**
 * Stage 5 — exhaustion.
 *
 * Whether the move is running out of fuel. Two readings:
 *
 *   1. Where the price sits against its own high. Scored as a ZONE, not a
 *      slope: risk peaks at or just off the top and FALLS once the drawdown
 *      is deep, because by then the correction has happened. A monotonic
 *      "further from ATH = worse" reading would flag every dead token as a
 *      fresh danger, which is the opposite of useful.
 *   2. Volume declining while price holds or rises — buyers thinning out
 *      under a price that has not adjusted yet.
 */
export function scoreExhaustion(snap: TokenSnapshot): StageResult {
  const parts: Array<{ value: number; weight: number }> = [];
  const evidence = [];
  const { market } = snap;

  if (market.ath?.priceUsd && market.ath.priceUsd > 0) {
    const drawdown = Math.max(0, 1 - market.priceUsd / market.ath.priceUsd);
    const { lo, hi } = EXHAUSTION.DRAWDOWN_PEAK_ZONE;

    // Peak zone: 1.0 at the high, decaying as the unwind progresses.
    const inZone = drawdown <= hi;
    const v = inZone ? 1 - ramp(drawdown, lo, hi) * 0.4 : Math.max(0, 1 - ramp(drawdown, hi, 0.9));

    parts.push({ value: v, weight: 0.5 });
    evidence.push(
      ev(
        "Drawdown from high",
        pct(drawdown),
        v,
        inZone
          ? "At or near the high — this is where the risk sits"
          : "Well off the high; much of the correction has already happened",
      ),
    );
  }

  const series = snap.series ?? [];
  if (series.length >= EXHAUSTION.MIN_SERIES_HOURS) {
    const divergence = volumePriceDivergence(series);
    if (divergence !== null) {
      const v = ramp(divergence, EXHAUSTION.DIVERGENCE.lo, EXHAUSTION.DIVERGENCE.hi);
      parts.push({ value: v, weight: 0.5 });
      evidence.push(
        ev(
          "Volume / price divergence",
          divergence > 0 ? `${pct(divergence)} gap` : "none",
          v,
          "Volume falling while price holds — fewer buyers at the same level",
        ),
      );
    }
  } else if (series.length > 0) {
    evidence.push(
      ev(
        "Series depth",
        `${series.length}h`,
        undefined,
        `Needs ${EXHAUSTION.MIN_SERIES_HOURS}h for the divergence read`,
      ),
    );
  }

  if (parts.length === 0) {
    return {
      stage: "exhaustion",
      score: 0,
      confidence: 0,
      evidence,
      unavailable: "No all-time high and no usable price series.",
    };
  }

  return {
    stage: "exhaustion",
    score: toScore(blend(parts)),
    confidence: parts.length === 2 ? 0.8 : 0.45,
    evidence,
  };
}

/**
 * Compare the second half of the window to the first. Positive output means
 * volume fell while price did not — the divergence that matters. Returns null
 * when either half has no volume to compare.
 */
function volumePriceDivergence(series: Candle[]): number | null {
  const mid = Math.floor(series.length / 2);
  const first = series.slice(0, mid);
  const second = series.slice(mid);
  if (first.length === 0 || second.length === 0) return null;

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

  const v1 = mean(first.map((c) => c.volumeUsd));
  const v2 = mean(second.map((c) => c.volumeUsd));
  if (v1 <= 0) return null;

  const p1 = mean(first.map((c) => c.close));
  const p2 = mean(second.map((c) => c.close));
  if (p1 <= 0) return null;

  const volChange = (v2 - v1) / v1;
  const priceChange = (p2 - p1) / p1;

  // Only a falling-volume, non-falling-price combination counts.
  if (volChange >= 0 || priceChange < -0.02) return 0;
  return Math.min(1, -volChange * (1 + Math.max(0, priceChange)));
}
