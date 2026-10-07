import type { Evidence, Holder, TokenSnapshot } from "./types.js";

export const clamp = (n: number, lo = 0, hi = 1): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;

/** Map v onto 0..1 across [lo, hi]. Values outside the range saturate. */
export function ramp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  if (hi === lo) return v >= hi ? 1 : 0;
  return clamp((v - lo) / (hi - lo));
}

/** ramp, inverted: high input, low output. */
export const invRamp = (v: number, lo: number, hi: number): number => 1 - ramp(v, lo, hi);

/** Weighted mean of 0..1 parts. Parts with weight 0 drop out cleanly. */
export function blend(parts: Array<{ value: number; weight: number }>): number {
  const total = parts.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return 0;
  return parts.reduce((s, p) => s + p.value * p.weight, 0) / total;
}

export const toScore = (unit: number): number => Math.round(clamp(unit) * 100);

export const pct = (unit: number, dp = 1): string => `${(unit * 100).toFixed(dp)}%`;

export const usd = (n: number): string =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `$${(n / 1_000).toFixed(1)}k`
      : `$${n.toFixed(0)}`;

export function ev(label: string, value: string, weight?: number, note?: string): Evidence {
  const e: Evidence = { label, value };
  if (weight !== undefined) e.weight = Number(weight.toFixed(2));
  if (note !== undefined) e.note = note;
  return e;
}

/**
 * Float = supply that can actually hit the market. LP, burn, program and CEX
 * balances are excluded. Getting this wrong is the single most common way a
 * concentration read lies: counting the LP position as a whale makes every
 * healthy token look captured.
 */
export function floatHolders(snap: TokenSnapshot): Holder[] {
  return snap.holders.filter((h) => h.tag === "unknown");
}

export function floatSupply(snap: TokenSnapshot): number {
  const excluded = snap.holders
    .filter((h) => h.tag !== "unknown")
    .reduce((s, h) => s + h.amount, 0);
  const base = snap.supply.circulating ?? snap.supply.total;
  return Math.max(base - excluded, 1);
}

export const hoursSince = (t: number | undefined, now: number): number | undefined =>
  t === undefined ? undefined : (now - t) / 3_600_000;
