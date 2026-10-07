/**
 * The scorer is pure: a TokenSnapshot goes in, a Report comes out.
 * Nothing in src/scorer may import a network client. The data layer's job
 * is to fill one of these; swapping Helius for Birdeye must not touch
 * anything below this line.
 */

export type StageId =
  | "ignition"
  | "concentration"
  | "liquidityTrap"
  | "insiderFlow"
  | "exhaustion";

/** How a holding address is classified. Supply held by anything other than
 *  `unknown` is not float and must not count toward concentration. */
export type HolderTag = "lp" | "cex" | "burn" | "program" | "treasury" | "unknown";

export interface Holder {
  address: string;
  /** UI amount, already adjusted for decimals. */
  amount: number;
  /** Share of total supply, 0..1. */
  pct: number;
  tag: HolderTag;
  /** Set when the provider can see it; used by insiderFlow. */
  firstSeenAt?: number;
}

/** One early buyer, for the insider-flow read. */
export interface EarlyWallet {
  address: string;
  /** Rank among the first buyers — 1 is the first non-deployer buy. */
  rank: number;
  acquiredAmount: number;
  currentAmount: number;
  /** Address that funded this wallet, when traceable. Shared funders across
   *  several early wallets is the clustering signal. */
  fundedBy?: string;
}

export interface Candle {
  t: number;
  close: number;
  volumeUsd: number;
}

export interface TokenSnapshot {
  mint: string;
  symbol?: string;
  fetchedAt: number;

  supply: {
    total: number;
    decimals: number;
    /** Total minus burned/locked, when the provider can determine it. */
    circulating?: number;
  };

  /** Holders, descending by amount. This is usually the TOP N, not all of
   *  them — what matters for confidence is not how many rows arrived but how
   *  much of the supply they cover. A provider that returns an unsorted or
   *  partial page must say so by leaving `holdersAreLargest` false. */
  holders: Holder[];
  /** True only when `holders` is genuinely the largest-first head of the
   *  distribution. False or absent means the rows are a sample and
   *  concentration cannot be trusted. */
  holdersAreLargest?: boolean;
  /** Total distinct holders, if the provider exposes it. */
  holderCount?: number;
  /** Holder count ~24h ago, for the growth-stall read. */
  holderCount24hAgo?: number;

  market: {
    priceUsd: number;
    marketCapUsd: number;
    /** Total USD pooled across DEX pairs. */
    liquidityUsd: number;
    volume24hUsd: number;
    /** Percent change, e.g. 42.5 for +42.5%. */
    priceChange: { h1?: number; h6?: number; h24?: number; d7?: number };
    ath?: { priceUsd: number; at: number };
    pairCreatedAt?: number;
  };

  earlyWallets?: EarlyWallet[];
  /** Hourly, oldest first. Used for the volume/price divergence read. */
  series?: Candle[];

  /** What went wrong while assembling this snapshot — a provider that failed,
   *  a source that was skipped. These reach the report's caveats, because a
   *  stage sitting out for want of data and a stage sitting out because a
   *  provider threw look identical in the output otherwise. */
  notes?: string[];
}

export interface Evidence {
  label: string;
  value: string;
  /** Contribution of this line to its stage score, 0..1. */
  weight?: number;
  note?: string;
}

export interface StageResult {
  stage: StageId;
  /** 0 = no signal, 100 = textbook. */
  score: number;
  /** 0..1. Drops when inputs are missing or thin. A high score at low
   *  confidence is a prompt to look, not a conclusion. */
  confidence: number;
  evidence: Evidence[];
  /** Set when the stage could not run at all. */
  unavailable?: string;
}

/** Where the token appears to sit in the lifecycle. Derived from the shape of
 *  the stage scores, not from the composite. */
export type Phase =
  | "quiet"
  | "igniting"
  | "captured"
  | "distributing"
  | "exhausted"
  | "unwinding"
  | "indeterminate";

export interface Report {
  mint: string;
  symbol?: string;
  generatedAt: number;
  /** 0..100. Weighted across stages that ran, reweighted by confidence. */
  composite: number;
  /** Mean confidence of the contributing stages. */
  confidence: number;
  phase: Phase;
  phaseRationale: string;
  stages: StageResult[];
  /** Anything that materially limited the read. */
  caveats: string[];
  /** A plain copy of the inputs the stages above actually scored — not a
   *  second source of truth, just enough of the snapshot for a saved report
   *  to be checked against what the provider returned at the time, instead
   *  of standing on the composite and phase alone. */
  inputs: {
    market: {
      priceUsd: number;
      marketCapUsd: number;
      liquidityUsd: number;
      volume24hUsd: number;
      priceChange: { h1?: number; h6?: number; h24?: number; d7?: number };
      pairCreatedAt?: number;
    };
    /** How many holder rows the snapshot carried — not the same as
     *  holderCount, which is the provider's own total-holder figure. */
    holderRows: number;
  };
}
