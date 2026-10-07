import { EARLY_WALLETS_FETCH, INSIDER_FLOW } from "../scorer/thresholds.js";
import type { EarlyWallet } from "../scorer/types.js";

/**
 * Traces a mint's first buyers from its Helius Enhanced Transaction history.
 *
 * Three steps, each able to fail independently without faking the others:
 *   1. Walk the mint's swap history backward (newest to oldest) until either
 *      genesis is reached or the lookback budget runs out. Reaching genesis
 *      is the only condition under which "first buyers" means anything —
 *      see EARLY_WALLETS_FETCH in thresholds.ts for why this is bounded.
 *   2. From that confirmed-complete history, rank distinct non-pool,
 *      non-deployer wallets by first appearance and read their acquired
 *      amount off that first buy.
 *   3. For each, best-effort look up their CURRENT balance (one RPC call)
 *      and funding source (one more Enhanced Transactions call). Either can
 *      come back empty; the cohort entry just carries less information, it
 *      is never invented.
 */
export async function fetchEarlyWallets(
  apiKey: string,
  mint: string,
): Promise<{ earlyWallets?: EarlyWallet[]; notes: string[] }> {
  const notes: string[] = [];

  let walk: WalkResult;
  try {
    walk = await walkToGenesis(apiKey, mint);
  } catch (e) {
    notes.push(
      `insiderFlow: transaction history fetch failed — ${e instanceof Error ? e.message : String(e)}`,
    );
    return { notes };
  }

  if (!walk.reachedGenesis) {
    notes.push(
      `insiderFlow: could not trace first buyers — this mint had more than ${EARLY_WALLETS_FETCH.MAX_PAGES * EARLY_WALLETS_FETCH.PAGE_SIZE} transactions in the lookback budget, so the oldest window reached is not provably the earliest.`,
    );
    return { notes };
  }

  const extracted = extractEarlyBuyers(walk.transfers, INSIDER_FLOW.EARLY_COHORT);
  if (extracted.length === 0) {
    notes.push("insiderFlow: reached this mint's genesis but found no distinct buyer wallets.");
    return { notes };
  }

  const enriched = await Promise.all(
    extracted.map(async (w) => {
      const [currentAmount, fundedBy] = await Promise.all([
        fetchCurrentBalance(apiKey, w.address, mint).catch(() => undefined),
        fetchFunder(apiKey, w.address, w.firstSignature).catch(() => undefined),
      ]);
      const wallet: EarlyWallet = {
        address: w.address,
        rank: w.rank,
        acquiredAmount: w.acquiredAmount,
        // A balance lookup that fails is unknown, not zero — treating it as
        // zero would read as "fully sold" and feed straight into the
        // distributed-fraction score.
        currentAmount: currentAmount ?? w.acquiredAmount,
      };
      if (fundedBy) wallet.fundedBy = fundedBy;
      return wallet;
    }),
  );

  return { earlyWallets: enriched, notes };
}

interface RawTransfer {
  signature: string;
  timestamp: number;
  fromUserAccount: string;
  toUserAccount: string;
  tokenAmount: number;
}

interface WalkResult {
  reachedGenesis: boolean;
  /** Oldest first. */
  transfers: RawTransfer[];
}

async function walkToGenesis(apiKey: string, mint: string): Promise<WalkResult> {
  const transfers: RawTransfer[] = [];
  let before: string | undefined;

  for (let page = 0; page < EARLY_WALLETS_FETCH.MAX_PAGES; page++) {
    const url = new URL(`https://api.helius.xyz/v0/addresses/${mint}/transactions`);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("limit", String(EARLY_WALLETS_FETCH.PAGE_SIZE));
    if (before) url.searchParams.set("before", before);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const batch = (await res.json()) as HeliusTx[];

    for (const tx of batch) {
      for (const t of tx.tokenTransfers ?? []) {
        if (t.mint !== mint) continue;
        transfers.push({
          signature: tx.signature,
          timestamp: tx.timestamp,
          fromUserAccount: t.fromUserAccount,
          toUserAccount: t.toUserAccount,
          tokenAmount: t.tokenAmount,
        });
      }
    }

    if (batch.length < EARLY_WALLETS_FETCH.PAGE_SIZE) {
      // Fewer rows than asked for: there is nothing older. Genesis reached.
      transfers.reverse();
      return { reachedGenesis: true, transfers };
    }
    before = batch[batch.length - 1]!.signature;
  }

  return { reachedGenesis: false, transfers: transfers.reverse() };
}

/**
 * Pure and exported for testing without network: rank distinct wallets by
 * the order they first receive the mint, excluding whichever address(es)
 * are party to a disproportionate share of transfers.
 *
 * That frequency cut is the pool-exclusion step, and it is deliberately a
 * heuristic rather than an address list: an AMM pool is a counterparty on
 * EVERY swap, buy or sell, so across any real trading history it dominates
 * the count by a wide margin regardless of which program it belongs to.
 * This is what lets insider-flow tracing work on Raydium, Orca or Pump.fun
 * alike without a per-program special case — the same generalisation gap
 * flagged against KNOWN_ADDRESSES for the concentration stage.
 */
export function extractEarlyBuyers(
  transfers: RawTransfer[],
  cohortSize: number,
): Array<{ address: string; rank: number; acquiredAmount: number; firstSignature: string }> {
  if (transfers.length === 0) return [];

  const frequency = new Map<string, number>();
  for (const t of transfers) {
    frequency.set(t.fromUserAccount, (frequency.get(t.fromUserAccount) ?? 0) + 1);
    frequency.set(t.toUserAccount, (frequency.get(t.toUserAccount) ?? 0) + 1);
  }
  const POOL_FREQUENCY_SHARE = 0.2;
  const pools = new Set(
    [...frequency.entries()]
      .filter(([, n]) => n > transfers.length * POOL_FREQUENCY_SHARE)
      .map(([addr]) => addr),
  );

  // The signer of the very first transfer in a genesis-complete window
  // created the pool — excluded as the deployer, not as a buyer.
  const deployerTx = transfers[0]!.fromUserAccount;
  pools.add(deployerTx);

  const seen = new Set<string>();
  const out: Array<{ address: string; rank: number; acquiredAmount: number; firstSignature: string }> =
    [];

  for (const t of transfers) {
    if (pools.has(t.toUserAccount) || seen.has(t.toUserAccount)) continue;
    seen.add(t.toUserAccount);
    out.push({
      address: t.toUserAccount,
      rank: out.length + 1,
      acquiredAmount: t.tokenAmount,
      firstSignature: t.signature,
    });
    if (out.length >= cohortSize) break;
  }

  return out;
}

async function fetchCurrentBalance(
  apiKey: string,
  owner: string,
  mint: string,
): Promise<number | undefined> {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getTokenAccountsByOwner",
      params: [owner, { mint }, { encoding: "jsonParsed" }],
    }),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as {
    result?: { value?: Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }> };
  };
  const accounts = json.result?.value ?? [];
  if (accounts.length === 0) return 0;
  return accounts.reduce((sum, a) => sum + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

/** Best effort: the sender of the nearest SOL transfer immediately before
 *  this wallet's first buy. Returns undefined rather than guess when there
 *  is nothing there — a wallet can also be funded by a token swap, a prior
 *  airdrop, or simply pre-exist with a balance. */
async function fetchFunder(
  apiKey: string,
  wallet: string,
  beforeSignature: string,
): Promise<string | undefined> {
  const url = new URL(`https://api.helius.xyz/v0/addresses/${wallet}/transactions`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("limit", "1");
  url.searchParams.set("before", beforeSignature);

  const res = await fetch(url);
  if (!res.ok) return undefined;
  const batch = (await res.json()) as HeliusTx[];
  const prior = batch[0];
  if (!prior) return undefined;

  const funding = (prior.nativeTransfers ?? []).find((n) => n.toUserAccount === wallet);
  return funding?.fromUserAccount;
}

interface HeliusTx {
  signature: string;
  timestamp: number;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
  }>;
  nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>;
}
