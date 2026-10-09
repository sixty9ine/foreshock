/**
 * Every tuned number lives here. You will be adjusting these on Saturday
 * night and you do not want to be hunting them across modules.
 *
 * PROVENANCE AND HEALTH WARNING
 * These started as the thresholds from the BICO / HEI / DEXE / TUT research,
 * which was EVM-side and in a different liquidity regime. Solana memecoin
 * float, pool depth and holder distributions do not match those conditions.
 * Treat every number below as a starting guess that has not been validated
 * on Solana, and say so anywhere the output is presented.
 *
 * Calibrating these against five tokens that actually collapsed is worth more
 * to the submission than a fourth or fifth signal stage.
 */

export const WEIGHTS: Record<string, number> = {
  ignition: 0.15,
  concentration: 0.3,
  liquidityTrap: 0.2,
  insiderFlow: 0.25,
  exhaustion: 0.1,
};

/**
 * Concentration confidence is driven by the fraction of SUPPLY the returned
 * rows cover, never by how many rows arrived — a thousand dust wallets tell
 * you nothing about the head of the distribution. Below this coverage the
 * report carries an explicit caveat. See stages/concentration.ts.
 */
export const MIN_SUPPLY_COVERAGE = 0.25;

export const IGNITION = {
  /** 24h volume / liquidity. Above ~3 the pool is being churned hard. */
  VOL_LIQ_RATIO: { lo: 1.5, hi: 8 },
  /** Percent price move over 24h. */
  PRICE_24H_PCT: { lo: 25, hi: 300 },
  /** Hours since the pair was created. Newer is hotter. */
  PAIR_AGE_HOURS: { newest: 6, cold: 336 },
  /** Fractional holder growth over 24h, e.g. 0.5 = +50%. */
  HOLDER_GROWTH: { lo: 0.05, hi: 1.0 },
};

export const CONCENTRATION = {
  /** Share of FLOAT held by the top 10 non-LP, non-burn, non-CEX wallets. */
  TOP10_FLOAT: { lo: 0.2, hi: 0.6 },
  /** Single largest float holder. */
  TOP1_FLOAT: { lo: 0.04, hi: 0.2 },
  /** Number of wallets needed to reach half the float. Fewer is worse. */
  WALLETS_TO_HALF: { worst: 5, benign: 60 },
  /** Concentration score above which the "captured" phase fires on its own,
   *  with no ignition required. This is deliberately a high bar — the
   *  weaker 50 used inside the igniting branches only adds color to an
   *  ALREADY-firing ignition read; this one has to carry a phase label by
   *  itself, for a token that is severely concentrated but not currently
   *  pumping. See inferPhase() in composite.ts. */
  CAPTURED_PHASE_MIN: 80,
};

export const LIQUIDITY_TRAP = {
  /** Market cap / pooled liquidity. High means the price is unsupported. */
  MCAP_LIQ_RATIO: { lo: 8, hi: 60 },
  /** Modelled price impact of selling this USD notional, via constant product. */
  EXIT_PROBE_USD: 10_000,
  /** Impact fraction of that probe, 0..1. */
  EXIT_IMPACT: { lo: 0.02, hi: 0.25 },
  /** Absolute pooled USD below which exit is structurally unsafe. */
  THIN_POOL_USD: 25_000,
};

/**
 * Walking a mint's transaction history back to its first buyer costs one
 * Helius call per page. A viral pump.fun token can do hundreds of swaps a
 * minute, so "walk until genesis" is unbounded in the worst case. This caps
 * the spend: if genesis is not reached within the budget, insiderFlow must
 * declare itself unavailable rather than report on a window that is NOT
 * actually the first buyers — a partial, non-earliest sample dressed up as
 * "early wallets" is exactly the kind of plausible-but-wrong value this
 * project exists to refuse. See src/data/earlyWallets.ts.
 */
export const EARLY_WALLETS_FETCH = {
  PAGE_SIZE: 100,
  /** CLI budget. A CLI invocation is a person willing to wait; 30 pages
   *  (~3,000 transactions) took up to ~50s and ~70 Helius calls on a hot
   *  pump.fun token in testing. */
  MAX_PAGES: 30,
  /** API budget. A live HTTP request is not the same willingness — a judge
   *  hitting the endpoint expects seconds, not tens of seconds. Lower means
   *  more tokens report insiderFlow unavailable rather than guess; it does
   *  not change correctness, only how often the budget is the thing that
   *  gives up first. See src/api/server.ts. */
  API_MAX_PAGES: 5,
};

/**
 * How extractEarlyBuyers tells a pool apart from an ordinary wallet.
 *
 * Appearance frequency alone is not enough: a wash-trading wallet
 * round-tripping against the pool can cross almost any frequency share just
 * by trading with itself more. What it cannot do by repetition is widen WHO
 * it trades with — a wash-trader's counterparties stay the pool and nothing
 * else, however many round trips it makes, while a real pool is party to
 * nearly every other participant in the sample by construction. So an
 * address is classified as a pool only when BOTH hold: it appears in more
 * than FREQUENCY_SHARE of all transfers, AND its distinct-counterparty set
 * covers more than COUNTERPARTY_SHARE of every other address seen. Breadth
 * is the condition doing the real work; frequency alone would still get
 * fooled by self-churn.
 */
export const POOL_DETECTION = {
  FREQUENCY_SHARE: 0.2,
  COUNTERPARTY_SHARE: 0.3,
};

export const INSIDER_FLOW = {
  /** How many of the first buyers to examine. */
  EARLY_COHORT: 20,
  /** Fraction of the early cohort's original position already sold. */
  DISTRIBUTED: { lo: 0.15, hi: 0.7 },
  /** Early wallets sharing one funding source — the clustering signal. */
  CLUSTER_SIZE: { lo: 2, hi: 8 },
  /** Early wallets still holding above this share of float is its own risk. */
  COHORT_FLOAT_HELD: { lo: 0.1, hi: 0.45 },
};

export const EXHAUSTION = {
  /** Drawdown from ATH, 0..1. Peaks score high; deep unwinds score lower
   *  because the damage is already done. */
  DRAWDOWN_PEAK_ZONE: { lo: 0.0, hi: 0.35 },
  /** Hours of series needed for the divergence read. */
  MIN_SERIES_HOURS: 12,
  /** Volume falling while price rises: magnitude of the gap that counts. */
  DIVERGENCE: { lo: 0.15, hi: 0.6 },
};

/** Composite bands, for presentation only. */
export const BANDS = [
  { max: 25, label: "low" },
  { max: 50, label: "elevated" },
  { max: 72, label: "high" },
  { max: 100, label: "severe" },
] as const;

export function band(score: number): string {
  return BANDS.find((b) => score <= b.max)?.label ?? "unknown";
}
