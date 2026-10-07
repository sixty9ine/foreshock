import assert from "node:assert/strict";
import { test } from "node:test";

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
