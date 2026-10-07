import { LIQUIDITY_TRAP } from "../thresholds.js";
import type { StageResult, TokenSnapshot } from "../types.js";
import { blend, ev, pct, ramp, toScore, usd } from "../util.js";

/**
 * Stage 3 — the liquidity trap.
 *
 * The EVM playbook called this the short squeeze. Solana memecoins mostly have
 * no perp market, so the mechanism is different but the consequence is the
 * same: a price that cannot be exited at anything near the quoted level.
 *
 * Two readings. Market cap over pooled liquidity says how much notional is
 * resting on how little depth. The exit probe models what actually happens
 * when someone tries to leave.
 */
export function scoreLiquidityTrap(snap: TokenSnapshot): StageResult {
  const { marketCapUsd, liquidityUsd } = snap.market;

  if (!liquidityUsd || liquidityUsd <= 0) {
    return {
      stage: "liquidityTrap",
      score: 0,
      confidence: 0,
      evidence: [],
      unavailable: "No pooled liquidity figure in the snapshot.",
    };
  }

  const ratio = marketCapUsd / liquidityUsd;
  const vRatio = ramp(ratio, LIQUIDITY_TRAP.MCAP_LIQ_RATIO.lo, LIQUIDITY_TRAP.MCAP_LIQ_RATIO.hi);

  // Constant-product impact of selling EXIT_PROBE_USD.
  //
  // Deliberately crude: it assumes one x*y=k pool and the whole probe hitting
  // it at once. Real routing splits across pools and does better. Treat the
  // number as an upper bound on pain, and replace it with a real quote from an
  // aggregator if there is time — that upgrade alone would make this stage
  // properly defensible.
  const probe = LIQUIDITY_TRAP.EXIT_PROBE_USD;
  const oneSide = liquidityUsd / 2;
  const impact = probe / (oneSide + probe);
  const vImpact = ramp(impact, LIQUIDITY_TRAP.EXIT_IMPACT.lo, LIQUIDITY_TRAP.EXIT_IMPACT.hi);

  const thin = liquidityUsd < LIQUIDITY_TRAP.THIN_POOL_USD;

  const evidence = [
    ev(
      "Market cap / pooled liquidity",
      `${ratio.toFixed(1)}×`,
      vRatio,
      `${usd(marketCapUsd)} of notional over ${usd(liquidityUsd)} of depth`,
    ),
    ev(
      `Modelled impact of a ${usd(probe)} exit`,
      pct(impact),
      vImpact,
      "Constant-product, single pool, no routing — an upper bound",
    ),
  ];

  if (thin) {
    evidence.push(
      ev(
        "Pool depth",
        usd(liquidityUsd),
        1,
        `Below the ${usd(LIQUIDITY_TRAP.THIN_POOL_USD)} floor: no position of size can exit cleanly`,
      ),
    );
  }

  const parts = [
    { value: vRatio, weight: 0.5 },
    { value: vImpact, weight: 0.5 },
  ];
  if (thin) parts.push({ value: 1, weight: 0.4 });

  return {
    stage: "liquidityTrap",
    score: toScore(blend(parts)),
    // Both inputs come from the same market feed, so this is either known or not.
    confidence: marketCapUsd > 0 ? 0.85 : 0.4,
    evidence,
  };
}
