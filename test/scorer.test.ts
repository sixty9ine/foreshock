import assert from "node:assert/strict";
import { test } from "node:test";

import { extractEarlyBuyers } from "../src/data/earlyWallets.js";
import { fixture } from "../src/data/fixture.js";
import { merge, type DataProvider } from "../src/data/provider.js";
import { score } from "../src/scorer/composite.js";
import { scoreConcentration } from "../src/scorer/stages/concentration.js";
import type { TokenSnapshot } from "../src/scorer/types.js";

const snapshot = (shape: "captured" | "distributing" | "healthy"): Promise<TokenSnapshot> =>
  fixture(shape).getSnapshot("TestMint111111111111111111111111111111111");

test("a captured float scores higher than a healthy one", async () => {
  const captured = score(await snapshot("captured"));
  const healthy = score(await snapshot("healthy"));
  assert.ok(
    captured.composite > healthy.composite,
    `captured ${captured.composite} should exceed healthy ${healthy.composite}`,
  );
});

test("LP and burn balances are excluded from float", async () => {
  const snap = await snapshot("captured");
  const withLp = scoreConcentration(snap);

  // Same token, but the pool is mislabelled as an ordinary holder.
  const mislabelled: TokenSnapshot = {
    ...snap,
    holders: snap.holders.map((h) => (h.tag === "lp" ? { ...h, tag: "unknown" as const } : h)),
  };
  const without = scoreConcentration(mislabelled);

  assert.ok(
    without.score > withLp.score,
    "counting the pool as a holder must inflate concentration — if it does not, tagging is not being applied",
  );
});

test("distribution by early wallets moves the phase off 'igniting'", async () => {
  const r = score(await snapshot("distributing"));
  assert.ok(
    ["distributing", "unwinding", "exhausted"].includes(r.phase),
    `expected a late-lifecycle phase, got ${r.phase}`,
  );
});

test("an unsorted holder sample refuses to score rather than reporting 0%", async () => {
  const snap = await snapshot("captured");
  // What a paginated, unsorted provider actually hands back: a slice of the
  // tail. Reporting "top 10 hold 0%" off this at full confidence is the
  // failure this guards against.
  const sample: TokenSnapshot = {
    ...snap,
    holders: snap.holders.slice(-200),
    holdersAreLargest: false,
  };
  const r = scoreConcentration(sample);
  assert.equal(r.confidence, 0);
  assert.ok(r.unavailable, "must declare itself unavailable, not score the sample");
});

test("confidence tracks supply coverage, not row count", async () => {
  const snap = await snapshot("captured");
  const full = scoreConcentration(snap);

  // Same head, but the token's supply is 20× larger — so these rows now cover
  // a sliver of it. Same number of rows, far less of the picture.
  const thin: TokenSnapshot = {
    ...snap,
    supply: { ...snap.supply, total: snap.supply.total * 20, circulating: undefined },
  };
  const r = scoreConcentration(thin);
  assert.ok(
    r.confidence < full.confidence,
    `thin coverage (${r.confidence}) must be trusted less than full (${full.confidence})`,
  );
});

test("missing inputs lower confidence instead of inventing a score", async () => {
  const snap = await snapshot("captured");
  const blind: TokenSnapshot = { ...snap, earlyWallets: [], series: [] };
  const r = score(blind);

  const insider = r.stages.find((s) => s.stage === "insiderFlow");
  assert.equal(insider?.confidence, 0);
  assert.ok(insider?.unavailable, "insiderFlow must declare itself unavailable, not score 0 silently");
  assert.ok(r.confidence < score(snap).confidence);
});

test("a provider that fails inside merge() is reported, not swallowed", async () => {
  const broken: DataProvider = {
    name: "broken-chain",
    async health() {
      return { ok: false, detail: "down" };
    },
    async getSnapshot() {
      throw new Error("401 Unauthorized");
    },
  };

  const snap = await merge(broken, fixture("healthy")).getSnapshot("TestMint1111111111111111111111111111");
  const r = score(snap);

  assert.ok(
    r.caveats.some((c) => c.includes("broken-chain") && c.includes("401")),
    `the failure must reach the caveats, got:\n${r.caveats.join("\n")}`,
  );
});

test("no holder data reads differently from all-holders-tagged", async () => {
  const snap = await snapshot("captured");

  const empty = scoreConcentration({ ...snap, holders: [] });
  assert.match(empty.unavailable ?? "", /no chain provider contributed/i);

  const allTagged = scoreConcentration({
    ...snap,
    holders: snap.holders.map((h) => ({ ...h, tag: "lp" as const })),
  });
  assert.match(allTagged.unavailable ?? "", /tagged as LP/i);
  assert.notEqual(empty.unavailable, allTagged.unavailable);
});

test("an igniting token never claims insiders are clean when that stage is dark", async () => {
  const captured = await snapshot("captured");
  const healthy = await snapshot("healthy");

  // Keep captured's ignition (needs concentration < 50 and exhaustion dark
  // too, or an earlier branch in inferPhase fires first and this one is
  // never reached) but borrow healthy's long-tail holders so concentration
  // doesn't also claim a float a few wallets control.
  const snap = {
    ...captured,
    holders: healthy.holders,
    earlyWallets: [],
    market: { ...captured.market, ath: undefined },
    series: [],
  };

  const r = score(snap);
  assert.equal(r.phase, "igniting");
  assert.match(r.phaseRationale, /unknown|no data/i);
  assert.doesNotMatch(r.phaseRationale, /not yet selling/i);
});

test("low coverage from a largest-first provider is not reported as a hidden whale", async () => {
  const snap = await snapshot("captured");
  const thin: TokenSnapshot = {
    ...snap,
    supply: { ...snap.supply, total: snap.supply.total * 20, circulating: undefined },
  };

  const r = score(thin);
  const joined = r.caveats.join("\n");
  assert.match(joined, /upper bound and is reliable/i);
  assert.doesNotMatch(joined, /could sit outside that window/i);
});

test("extractEarlyBuyers excludes the pool and the deployer, and does not re-rank a repeat buyer", () => {
  const POOL = "Pool11111111111111111111111111111111111111";
  const DEPLOYER = "Deployer1111111111111111111111111111111111";
  const BUYER_A = "BuyerA111111111111111111111111111111111111";
  const BUYER_B = "BuyerB111111111111111111111111111111111111";
  const BUYER_C = "BuyerC111111111111111111111111111111111111";

  const tx = (from: string, to: string, tokenAmount: number, sig: string) => ({
    signature: sig,
    timestamp: 0,
    fromUserAccount: from,
    toUserAccount: to,
    tokenAmount,
  });

  // The pool and a few genuine traders are party to every real transfer, so
  // a transfer list of this size (not a handful) is what keeps a buyer who
  // trades more than once from crossing the pool-frequency threshold itself.
  const filler = Array.from({ length: 15 }, (_, i) =>
    tx(POOL, `Filler${i}11111111111111111111111111111111`, 1, `f${i}`),
  );

  const transfers = [
    tx(DEPLOYER, POOL, 1_000_000, "seed"), // pool creation — excluded as deployer
    tx(POOL, BUYER_A, 50, "s1"), // BUYER_A's first buy — rank 1
    tx(POOL, BUYER_B, 30, "s2"), // BUYER_B's first buy — rank 2
    tx(BUYER_A, POOL, 20, "s3"), // BUYER_A sells some back — not a new rank
    tx(POOL, BUYER_A, 10, "s4"), // BUYER_A buys again — must not change rank or acquiredAmount
    tx(POOL, BUYER_C, 15, "s5"), // BUYER_C's first buy — rank 3
    ...filler,
  ];

  const ranked = extractEarlyBuyers(transfers, 10);
  const addresses = ranked.map((w) => w.address);

  assert.ok(!addresses.includes(POOL), "the pool must not appear as a buyer");
  assert.ok(!addresses.includes(DEPLOYER), "the deployer must not appear as a buyer");
  assert.deepEqual(ranked.slice(0, 3).map((w) => w.address), [BUYER_A, BUYER_B, BUYER_C]);

  const a = ranked.find((w) => w.address === BUYER_A)!;
  assert.equal(a.rank, 1);
  assert.equal(
    a.acquiredAmount,
    50,
    "acquiredAmount must come from the FIRST buy, not a later repeat purchase",
  );
});

test("extractEarlyBuyers stops at the requested cohort size", () => {
  const POOL = "Pool11111111111111111111111111111111111111";
  const transfers = Array.from({ length: 30 }, (_, i) => ({
    signature: `s${i}`,
    timestamp: 0,
    fromUserAccount: POOL,
    toUserAccount: `Buyer${String(i).padStart(2, "0")}1111111111111111111111111111`,
    tokenAmount: 1,
  }));

  const ranked = extractEarlyBuyers(transfers, 5);
  assert.equal(ranked.length, 5);
  assert.equal(ranked[0]!.address, transfers[0]!.toUserAccount);
  assert.equal(ranked[4]!.address, transfers[4]!.toUserAccount);
});

test("extractEarlyBuyers does not drop a wash-trading wallet as a pool", () => {
  const DEPLOYER = "Deployer1111111111111111111111111111111111";
  const POOL = "Pool11111111111111111111111111111111111111";
  const WASHER = "Washer111111111111111111111111111111111111";

  let i = 0;
  const tx = (from: string, to: string) => ({
    signature: `s${i++}`,
    timestamp: 0,
    fromUserAccount: from,
    toUserAccount: to,
    tokenAmount: 1,
  });

  const transfers = [tx(DEPLOYER, POOL), tx(POOL, WASHER)];
  // Self-churn: frequency climbs with every round trip, but WASHER's
  // counterparty set never grows past {POOL} — that is the whole point.
  for (let k = 0; k < 30; k++) {
    transfers.push(tx(WASHER, POOL));
    transfers.push(tx(POOL, WASHER));
  }
  for (let k = 0; k < 40; k++) {
    transfers.push(tx(POOL, `Buyer${k}`));
  }

  const ranked = extractEarlyBuyers(transfers, 20);
  assert.ok(
    ranked.some((w) => w.address === WASHER),
    "a wash-trading wallet must not be classified as a pool just for trading with itself a lot",
  );
  assert.equal(ranked[0]!.address, WASHER, "WASHER bought first and must hold rank 1");
});

test("extractEarlyBuyers excludes two legitimate pools, not just the loudest one", () => {
  const DEPLOYER = "Deployer1111111111111111111111111111111111";
  const POOL_A = "PoolA111111111111111111111111111111111111";
  const POOL_B = "PoolB111111111111111111111111111111111111";

  let i = 0;
  const tx = (from: string, to: string) => ({
    signature: `s${i++}`,
    timestamp: 0,
    fromUserAccount: from,
    toUserAccount: to,
    tokenAmount: 1,
  });

  const transfers = [tx(DEPLOYER, POOL_A), tx(DEPLOYER, POOL_B)];
  // Two pools, each trading with its own disjoint set of buyers — neither
  // is the single loudest address, so a "top one address only" rule would
  // miss the second.
  for (let k = 0; k < 20; k++) transfers.push(tx(POOL_A, `BuyerA${k}`));
  for (let k = 0; k < 20; k++) transfers.push(tx(POOL_B, `BuyerB${k}`));

  const ranked = extractEarlyBuyers(transfers, 50);
  const addresses = ranked.map((w) => w.address);
  assert.ok(!addresses.includes(POOL_A), "pool A must be excluded");
  assert.ok(!addresses.includes(POOL_B), "pool B must be excluded");
  assert.equal(ranked.length, 40, "all 40 genuine buyers across both pools must survive");
});

test("scores and confidence stay in range across all shapes", async () => {
  for (const shape of ["captured", "distributing", "healthy"] as const) {
    const r = score(await snapshot(shape));
    assert.ok(r.composite >= 0 && r.composite <= 100, `${shape}: composite out of range`);
    assert.ok(r.confidence >= 0 && r.confidence <= 1, `${shape}: confidence out of range`);
    for (const s of r.stages) {
      assert.ok(s.score >= 0 && s.score <= 100, `${shape}/${s.stage}: score out of range`);
    }
  }
});
