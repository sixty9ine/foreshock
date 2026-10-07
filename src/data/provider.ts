import type { HolderTag, TokenSnapshot } from "../scorer/types.js";

/**
 * Every network call in this project goes behind this interface.
 *
 * You do not yet know which provider works from your connection, and you may
 * have to switch mid-week. If the scorer imports a vendor SDK directly, that
 * switch costs a day. It must not.
 */
export interface DataProvider {
  readonly name: string;
  /** Cheap liveness probe. Run this before anything else — it is the step that
   *  tells you on day one whether this provider is reachable from Nigeria. */
  health(): Promise<{ ok: boolean; detail: string }>;
  getSnapshot(mint: string): Promise<TokenSnapshot>;
}

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | undefined,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

/**
 * Try providers in order, first success wins. Build the fallback chain on day
 * one — the point is that a rate limit or a regional block on Saturday night
 * degrades the read instead of ending it.
 */
export function chain(...providers: DataProvider[]): DataProvider {
  if (providers.length === 0) throw new Error("chain() needs at least one provider");
  return {
    name: `chain(${providers.map((p) => p.name).join(" → ")})`,
    async health() {
      const results = await Promise.all(
        providers.map(async (p) => {
          const h = await p.health().catch((e: unknown) => ({
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          }));
          return `${p.name}: ${h.ok ? "ok" : `FAILED — ${h.detail}`}`;
        }),
      );
      return { ok: results.some((r) => r.includes(": ok")), detail: results.join("\n") };
    },
    async getSnapshot(mint) {
      const errors: string[] = [];
      for (const p of providers) {
        try {
          return await p.getSnapshot(mint);
        } catch (e) {
          errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      throw new ProviderError("chain", undefined, `all providers failed\n${errors.join("\n")}`);
    },
  };
}

/**
 * Combine providers that each know part of the picture — a chain provider for
 * supply and holders, a market provider for price and liquidity.
 *
 * Unlike chain(), this is not a fallback: it calls all of them and merges.
 * A provider that fails is skipped rather than failing the snapshot, so a
 * DexScreener outage costs you the market-driven stages and leaves
 * concentration intact instead of returning nothing.
 */
export function merge(...providers: DataProvider[]): DataProvider {
  if (providers.length === 0) throw new Error("merge() needs at least one provider");
  return {
    name: `merge(${providers.map((p) => p.name).join(" + ")})`,
    async health() {
      const results = await Promise.all(
        providers.map(async (p) => {
          const h = await p.health().catch((e: unknown) => ({
            ok: false,
            detail: e instanceof Error ? e.message : String(e),
          }));
          return { name: p.name, ...h };
        }),
      );
      return {
        ok: results.every((r) => r.ok),
        detail: results.map((r) => `${r.name}: ${r.ok ? "ok" : `FAILED — ${r.detail}`}`).join("\n"),
      };
    },
    async getSnapshot(mint) {
      const settled = await Promise.all(
        providers.map((p) =>
          p.getSnapshot(mint).then(
            (s) => ({ ok: true as const, snap: s, name: p.name }),
            (e: unknown) => ({
              ok: false as const,
              name: p.name,
              error: e instanceof Error ? e.message : String(e),
            }),
          ),
        ),
      );

      const good = settled.filter((r) => r.ok);
      if (good.length === 0) {
        throw new ProviderError(
          "merge",
          undefined,
          `every provider failed\n${settled.map((r) => (r.ok ? "" : `${r.name}: ${r.error}`)).join("\n")}`,
        );
      }

      // Field-by-field: first provider with real data for a field wins, so a
      // market provider's empty holder list never clobbers the chain's.
      const out: TokenSnapshot = {
        mint,
        fetchedAt: Date.now(),
        supply: { total: 0, decimals: 0 },
        holders: [],
        market: { priceUsd: 0, marketCapUsd: 0, liquidityUsd: 0, volume24hUsd: 0, priceChange: {} },
        // A provider that threw must never vanish. Without this, a dead chain
        // provider and a token with no holders produce identical output.
        notes: settled
          .filter((r) => !r.ok)
          .map((r) => `provider ${r.name} failed: ${"error" in r ? r.error : "unknown"}`),
      };

      for (const { snap } of good) {
        if (snap.symbol && !out.symbol) out.symbol = snap.symbol;
        if (snap.supply.total > 0 && out.supply.total === 0) out.supply = snap.supply;
        if (snap.holders.length > 0 && out.holders.length === 0) {
          out.holders = snap.holders;
          if (snap.holdersAreLargest !== undefined) out.holdersAreLargest = snap.holdersAreLargest;
          if (snap.holderCount !== undefined) out.holderCount = snap.holderCount;
          if (snap.holderCount24hAgo !== undefined) out.holderCount24hAgo = snap.holderCount24hAgo;
        }
        if (snap.market.liquidityUsd > 0 || snap.market.priceUsd > 0) {
          if (out.market.priceUsd === 0) out.market = snap.market;
        }
        if (snap.earlyWallets?.length && !out.earlyWallets) out.earlyWallets = snap.earlyWallets;
        if (snap.series?.length && !out.series) out.series = snap.series;
        // A provider can succeed overall but still have a sub-fetch fail
        // (e.g. a secondary data source) — those notes must survive too.
        if (snap.notes?.length) out.notes = [...(out.notes ?? []), ...snap.notes];
      }

      return out;
    },
  };
}

/** Known non-float addresses. Extend this as you find them — every address
 *  missing here inflates the concentration score. */
export const KNOWN_ADDRESSES: Record<string, HolderTag> = {
  "1nc1nerator11111111111111111111111111111111": "burn",
  "11111111111111111111111111111111": "program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "program",
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": "cex",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "cex",

  // Found scoring WIF's top-20 holders against Solscan tags, 2026-10-06.
  "51yZyDSnec4xnUv7XLRVYcDyV4x3wUtzrDcRaYbmQU5j": "cex", // Robinhood deposit address
  "4xLpwxgYuPwPvtQjE94RLS4WZ4aD8NJYYKr2AJk99Qdg": "cex", // Robinhood hot wallet
  "3gd3dqgtJ4jWfBfLYTX67DALFetjc5iS72sCgRhCkW2u": "cex", // Binance 10
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "cex", // Binance 2
  "GBrURzmtWujJRTA3Bkvo7ZgWuZYLMMwPCwre7BejJXnK": "cex", // Binance cold wallet
  "CK8i4zFXkDE2KWfyg7g9S748r6mwxajbcKcyGhQMR3qQ": "cex", // Bybit wallet 13
  "CMivUnnbDHxLq9ChV1bSuiQE5ycZf6JVvFFDePMHhHYK": "cex", // Bybit deposit address
  "CBEADkb8TZAXHjVE3zwad4L995GZE7rJcacJ7asebkVG": "cex", // OKX cold wallet
  "EFE3j1pcSP1paUzA86zW7989ZjsFP2J7ginyUqo4ewqR": "cex", // Kraken cold wallet
  "E2RvJg2myWpKcbkhBuF81gfhYr6KvmNcDbSmr5qnatYy": "cex", // Kraken cold wallet
  "6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF": "cex", // Kraken hot wallet
  "DCCkmmxPBS7MydoLZpNwr9NuxEdRr2UFkqr8sh9KT131": "cex", // Coinbase deposit address
  "DqN3URdzKMSYJHHtH73s2bnBEpEwb44nzZLSq5terQ1x": "cex", // Coinbase deposit address
  "3B7XAQrLoEMDEGvX8569F9GRb9PcXXocJmj5wvhhei9z": "cex", // BtcTurk cold wallet

  // Found scoring SNDWITCH (J9qzFhTLYnmf3tZYvHBaF96rH3YKToELAAVMzz66pump), 2026-10-06.
  "HU22UBaTZa7AjMkDJaSyoDHtfFw6XVS6d9bSXLt9ugDB": "lp", // Pump.fun AMM (SNDWITCH-WSOL) market account — token-specific, not reusable
};
