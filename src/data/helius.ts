import type { Holder, TokenSnapshot } from "../scorer/types.js";
import { fetchEarlyWallets } from "./earlyWallets.js";
import { KNOWN_ADDRESSES, ProviderError, type DataProvider } from "./provider.js";

/**
 * Helius provider — supply and the LARGEST holders.
 *
 * Why not the DAS `getTokenAccounts` endpoint: it returns the first N token
 * accounts, in no particular order, not the biggest ones. On a token with
 * 200k holders that hands you a thousand dust wallets, and the concentration
 * read comes out as 0% at full confidence — confidently wrong, which is the
 * worst failure mode a risk tool has.
 *
 * So this uses two plain Solana RPC calls instead:
 *   getTokenSupply          → authoritative supply and decimals
 *   getTokenLargestAccounts → the top 20 token accounts BY BALANCE
 * then one getMultipleAccounts to resolve those token accounts to owners,
 * because concentration is a question about actors, not addresses.
 *
 * Twenty is a small head, and that is fine: top-1 and top-10 are exactly what
 * it contains. Where the top 20 do not reach half the float, the scorer says
 * "more than 20" rather than inventing a figure.
 *
 * Helius does not price tokens — pair this with the DexScreener provider via
 * merge() so the market-driven stages have something to read.
 */
export function helius(apiKey: string): DataProvider {
  const rpc = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;

  async function call<T>(method: string, params: unknown): Promise<T> {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
    });
    if (!res.ok) {
      throw new ProviderError("helius", res.status, `${method} → ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new ProviderError("helius", undefined, `${method}: ${json.error.message}`);
    if (json.result === undefined) throw new ProviderError("helius", undefined, `${method}: empty result`);
    return json.result;
  }

  return {
    name: "helius",

    async health() {
      try {
        await call<unknown>("getHealth", []);
        return { ok: true, detail: "RPC reachable and key accepted" };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },

    async getSnapshot(mint: string): Promise<TokenSnapshot> {
      const [supplyRes, largest] = await Promise.all([
        call<{ value: { amount: string; decimals: number; uiAmount: number | null } }>(
          "getTokenSupply",
          [mint],
        ),
        call<{ value: Array<{ address: string; amount: string; uiAmount: number | null }> }>(
          "getTokenLargestAccounts",
          [mint],
        ),
      ]);

      const decimals = supplyRes.value.decimals;
      const total = supplyRes.value.uiAmount ?? Number(supplyRes.value.amount) / 10 ** decimals;
      if (!(total > 0)) throw new ProviderError("helius", undefined, `no supply for ${mint}`);

      const accounts = largest.value.filter((a) => (a.uiAmount ?? 0) > 0);
      if (accounts.length === 0) {
        throw new ProviderError("helius", undefined, `no token accounts hold ${mint}`);
      }

      // Resolve token accounts → owners. Several accounts can share an owner.
      const owners = await call<{
        value: Array<{ data?: { parsed?: { info?: { owner?: string } } } } | null>;
      }>("getMultipleAccounts", [accounts.map((a) => a.address), { encoding: "jsonParsed" }]);

      const byOwner = new Map<string, number>();
      accounts.forEach((acct, i) => {
        // Fall back to the token-account address when the owner cannot be
        // parsed: better to count it as its own holder than to drop supply.
        const owner = owners.value[i]?.data?.parsed?.info?.owner ?? acct.address;
        const amt = acct.uiAmount ?? Number(acct.amount) / 10 ** decimals;
        byOwner.set(owner, (byOwner.get(owner) ?? 0) + amt);
      });

      const holders: Holder[] = [...byOwner.entries()]
        .map(([address, amount]) => ({
          address,
          amount,
          pct: amount / total,
          tag: classify(address),
        }))
        .sort((a, b) => b.amount - a.amount);

      const { earlyWallets, notes } = await fetchEarlyWallets(apiKey, mint);

      return {
        mint,
        fetchedAt: Date.now(),
        supply: { total, decimals },
        holders,
        // These ARE the largest, by construction. This flag is what lets the
        // concentration stage trust the rows at all.
        holdersAreLargest: true,
        market: {
          priceUsd: 0,
          marketCapUsd: 0,
          liquidityUsd: 0,
          volume24hUsd: 0,
          priceChange: {},
        },
        ...(earlyWallets ? { earlyWallets } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      };
    },
  };
}

/**
 * Tagging decides what counts as float, which drives the heaviest-weighted
 * stage. The known-address list is reliable; the patterns below are not.
 * An unrecognised pool address reads as a whale and inflates the score.
 *
 * Highest-value improvement here: resolve pool addresses from the Raydium and
 * Orca program accounts rather than pattern-matching, and extend
 * KNOWN_ADDRESSES as you find them.
 */
function classify(address: string): Holder["tag"] {
  const known = KNOWN_ADDRESSES[address];
  if (known) return known;
  if (/^1nc1nerator/.test(address)) return "burn";
  if (/^(11111111|Token|ATokenGPv|Sysvar)/.test(address)) return "program";
  return "unknown";
}
