import type { Candle, TokenSnapshot } from "../scorer/types.js";
import { ProviderError, type DataProvider } from "./provider.js";

/**
 * DexScreener — market data. No API key, no signup.
 *
 * Liquidity is SUMMED ACROSS PAIRS, which matters more than it sounds. A
 * token trading in six pools has its depth spread across them; reading only
 * the top pair makes every widely-traded token look like a liquidity trap.
 * BONK on a single pair shows a market-cap-to-liquidity ratio in the hundreds;
 * summed across its pools the real figure is a fraction of that.
 *
 * This provider knows nothing about holders — merge() it with a chain
 * provider.
 */
/**
 * DexScreener is keyless and IP-rate-limited. On a host with a shared egress
 * IP (Render's free tier, for one) that bucket is shared with OTHER
 * tenants' traffic, so a 429 can show up regardless of this process's own
 * request rate. A short retry absorbs that kind of transient spike; it does
 * not paper over a real outage — MAX_RETRIES is small on purpose, and a 429
 * that survives all of them still surfaces as a true provider failure.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  const MAX_RETRIES = 2;
  const BASE_DELAY_MS = 300;

  let lastRes: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    if (res.ok || (res.status !== 429 && res.status < 500)) return res;
    lastRes = res;
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
    }
  }
  return lastRes!;
}

export function dexscreener(): DataProvider {
  const base = "https://api.dexscreener.com/latest/dex";

  return {
    name: "dexscreener",

    async health() {
      try {
        const res = await fetchWithRetry(
          `${base}/tokens/So11111111111111111111111111111111111111112`,
        );
        return res.ok
          ? { ok: true, detail: "reachable, no key required" }
          : { ok: false, detail: `${res.status} ${res.statusText}` };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },

    async getSnapshot(mint: string): Promise<TokenSnapshot> {
      const res = await fetchWithRetry(`${base}/tokens/${mint}`);
      if (!res.ok) {
        throw new ProviderError("dexscreener", res.status, `${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as { pairs: Pair[] | null };
      const pairs = (json.pairs ?? []).filter((p) => p.chainId === "solana");
      if (pairs.length === 0) {
        throw new ProviderError("dexscreener", undefined, `no Solana pairs for ${mint}`);
      }

      const liquidityUsd = pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0);
      const volume24hUsd = pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0);

      // Deepest pair is the reference for price and age — it is the one whose
      // quote the market actually follows.
      const deepest = [...pairs].sort(
        (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
      )[0]!;

      const priceUsd = Number(deepest.priceUsd ?? 0);
      const marketCapUsd = deepest.marketCap ?? deepest.fdv ?? 0;

      // Earliest pair creation across all pools is the token's real age; a new
      // pool on an old token should not reset the ignition clock.
      const created = pairs
        .map((p) => p.pairCreatedAt)
        .filter((t): t is number => typeof t === "number" && t > 0);
      const pairCreatedAt = created.length > 0 ? Math.min(...created) : undefined;

      const history = deepest.pairAddress
        ? await fetchOhlcv(deepest.pairAddress, priceUsd, pairCreatedAt)
        : { notes: [] };

      return {
        mint,
        ...(deepest.baseToken?.symbol ? { symbol: deepest.baseToken.symbol } : {}),
        fetchedAt: Date.now(),
        // DexScreener does not expose supply reliably; the chain provider owns
        // this. Left at zero so merge() prefers the chain figure.
        supply: { total: 0, decimals: 0 },
        holders: [],
        market: {
          priceUsd,
          marketCapUsd,
          liquidityUsd,
          volume24hUsd,
          priceChange: {
            ...(deepest.priceChange?.h1 !== undefined ? { h1: deepest.priceChange.h1 } : {}),
            ...(deepest.priceChange?.h6 !== undefined ? { h6: deepest.priceChange.h6 } : {}),
            ...(deepest.priceChange?.h24 !== undefined ? { h24: deepest.priceChange.h24 } : {}),
          },
          ...(pairCreatedAt !== undefined ? { pairCreatedAt } : {}),
          ...(history.ath ? { ath: history.ath } : {}),
        },
        ...(history.series?.length ? { series: history.series } : {}),
        ...(history.notes.length > 0 ? { notes: history.notes } : {}),
      };
    },
  };
}

/** GeckoTerminal's free OHLCV endpoint, keyed by pool (pair) address rather
 *  than mint — no key, no signup. Capped at 1000 hourly candles (~41 days);
 *  for anything older than that, the all-time high is only a high-since-window
 *  and the caller is told so rather than left to assume it is exhaustive.
 */
async function fetchOhlcv(
  poolAddress: string,
  livePriceUsd: number,
  pairCreatedAt: number | undefined,
): Promise<{ series?: Candle[]; ath?: { priceUsd: number; at: number }; notes: string[] }> {
  const notes: string[] = [];
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=1000`,
    );
    if (!res.ok) {
      notes.push(`exhaustion: GeckoTerminal OHLCV unavailable (${res.status} ${res.statusText})`);
      return { notes };
    }
    const json = (await res.json()) as {
      data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } };
    };
    const rows = json.data?.attributes?.ohlcv_list ?? [];
    if (rows.length === 0) {
      notes.push("exhaustion: GeckoTerminal returned no candles for this pool");
      return { notes };
    }

    // GeckoTerminal returns newest-first; the scorer wants oldest-first.
    const sorted = [...rows].sort((a, b) => a[0] - b[0]);

    const series: Candle[] = sorted.map(([t, , , , close, volumeUsd]) => ({
      t: t * 1000,
      close,
      volumeUsd,
    }));

    let athPriceUsd = livePriceUsd;
    let athAt = Date.now();
    for (const [t, , high] of sorted) {
      if (high > athPriceUsd) {
        athPriceUsd = high;
        athAt = t * 1000;
      }
    }

    const earliestCandle = sorted[0]![0] * 1000;
    if (pairCreatedAt !== undefined && earliestCandle - pairCreatedAt > 3_600_000) {
      notes.push(
        "exhaustion: all-time high is computed only over the last 1000 hourly candles (~41 days); " +
          "this pool is older than that window, so a higher true all-time high may exist outside it.",
      );
    }

    return { series, ath: { priceUsd: athPriceUsd, at: athAt }, notes };
  } catch (e) {
    notes.push(
      `exhaustion: GeckoTerminal OHLCV fetch failed — ${e instanceof Error ? e.message : String(e)}`,
    );
    return { notes };
  }
}

interface Pair {
  chainId: string;
  priceUsd?: string;
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  pairAddress?: string;
  baseToken?: { address: string; symbol?: string; name?: string };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h1?: number; h6?: number; h24?: number };
}
