import type { EarlyWallet, Holder, TokenSnapshot } from "../scorer/types.js";
import type { DataProvider } from "./provider.js";

/**
 * A synthetic provider, so the scorer can be built and tested before any API
 * key exists.
 *
 * This is the piece that stops a blocked signup from costing you Wednesday.
 * Build the whole scorer against these fixtures, then swap in a live provider
 * when the key lands — the interface is identical, so nothing downstream moves.
 *
 * The shapes below are hand-built to exercise distinct code paths, not copied
 * from any real token. Do not present fixture output as a finding.
 */

type Shape = "captured" | "distributing" | "healthy";

export function fixture(shape: Shape = "captured"): DataProvider {
  return {
    name: `fixture:${shape}`,
    async health() {
      return { ok: true, detail: "synthetic data, always available" };
    },
    async getSnapshot(mint: string) {
      return build(mint, shape);
    },
  };
}

function build(mint: string, shape: Shape): TokenSnapshot {
  const total = 1_000_000_000;
  const now = Date.now();

  const lp: Holder = {
    address: "LPpooL1111111111111111111111111111111111111",
    amount: total * 0.18,
    pct: 0.18,
    tag: "lp",
  };
  const burn: Holder = {
    address: "1nc1nerator11111111111111111111111111111111",
    amount: total * 0.05,
    pct: 0.05,
    tag: "burn",
  };

  // Float distribution differs by shape: a captured token has a steep head,
  // a healthy one has a long tail.
  const headShares =
    shape === "healthy"
      ? [0.03, 0.025, 0.02, 0.018, 0.015, 0.013, 0.012, 0.011, 0.01, 0.009]
      : [0.14, 0.11, 0.08, 0.06, 0.05, 0.04, 0.035, 0.03, 0.025, 0.02];

  const head: Holder[] = headShares.map((pct, i) => ({
    address: `Whale${String(i + 1).padStart(2, "0")}${"x".repeat(38)}`.slice(0, 44),
    amount: total * pct,
    pct,
    tag: "unknown" as const,
  }));

  const tailCount = shape === "healthy" ? 400 : 60;
  const tailTotal = total * (shape === "healthy" ? 0.5 : 0.15);
  const tail: Holder[] = Array.from({ length: tailCount }, (_, i) => ({
    address: `Hold${String(i).padStart(4, "0")}${"y".repeat(36)}`.slice(0, 44),
    amount: tailTotal / tailCount,
    pct: tailTotal / tailCount / total,
    tag: "unknown" as const,
  }));

  const sold = shape === "distributing" ? 0.72 : shape === "captured" ? 0.08 : 0.2;
  const earlyWallets: EarlyWallet[] = Array.from({ length: 20 }, (_, i) => {
    const acquired = total * 0.006;
    return {
      address: `Early${String(i).padStart(3, "0")}${"z".repeat(36)}`.slice(0, 44),
      rank: i + 1,
      acquiredAmount: acquired,
      currentAmount: acquired * (1 - sold),
      // A shared funder across the first several wallets is the cluster signal.
      ...(shape !== "healthy" && i < 6
        ? { fundedBy: "Fund3r11111111111111111111111111111111111111" }
        : i % 3 === 0
          ? { fundedBy: `Src${i}${"q".repeat(40)}`.slice(0, 44) }
          : {}),
    };
  });

  const series = Array.from({ length: 24 }, (_, i) => ({
    t: now - (24 - i) * 3_600_000,
    // Price grinds up while volume fades in the back half.
    close: 0.00042 * (1 + i * (shape === "healthy" ? 0.004 : 0.012)),
    volumeUsd: shape === "healthy" ? 40_000 + i * 500 : i < 12 ? 120_000 : 120_000 * (1 - (i - 12) * 0.06),
  }));

  const liquidityUsd = shape === "healthy" ? 620_000 : 48_000;
  const priceUsd = series[series.length - 1]!.close;

  return {
    mint,
    symbol: shape.toUpperCase().slice(0, 6),
    fetchedAt: now,
    supply: { total, decimals: 6, circulating: total * 0.95 },
    holders: [lp, burn, ...head, ...tail],
    holdersAreLargest: true,
    holderCount: 2 + head.length + tail.length,
    holderCount24hAgo: Math.round((2 + head.length + tail.length) / (shape === "healthy" ? 1.04 : 1.9)),
    market: {
      priceUsd,
      marketCapUsd: priceUsd * total,
      liquidityUsd,
      volume24hUsd: series.reduce((s, c) => s + c.volumeUsd, 0),
      priceChange: {
        h24: shape === "healthy" ? 6 : 180,
        h6: shape === "healthy" ? 2 : 44,
      },
      ath: {
        priceUsd: priceUsd * (shape === "distributing" ? 1.3 : 1.02),
        at: now - 5 * 3_600_000,
      },
      pairCreatedAt: now - (shape === "healthy" ? 90 * 24 : 30) * 3_600_000,
    },
    earlyWallets,
    series,
  };
}
