import assert from "node:assert/strict";
import { test } from "node:test";

import type { StoredRun } from "../src/data/history.js";
import { buildInference, findSimilar } from "../src/inference.js";
import type { Report } from "../src/scorer/types.js";

/** A minimal but fully-shaped Report, just the fields findSimilar/
 *  buildInference actually read. */
function report(mint: string, stages: Record<string, number>): Report {
  return {
    mint,
    generatedAt: Date.now(),
    composite: 80,
    confidence: 0.9,
    phase: "captured",
    phaseRationale: "Concentration scores 100/100.",
    stages: Object.entries(stages).map(([stage, score]) => ({
      stage: stage as Report["stages"][number]["stage"],
      score,
      confidence: 0.9,
      evidence: [],
    })),
    caveats: [],
    inputs: { market: { priceUsd: 0, marketCapUsd: 0, liquidityUsd: 0, volume24hUsd: 0, priceChange: {} }, holderRows: 0 },
  };
}

function stored(mint: string, generatedAt: number, composite: number, phase: Report["phase"], stages: Record<string, number>): StoredRun {
  return {
    mint,
    generatedAt,
    composite,
    phase,
    stages: Object.fromEntries(
      Object.entries(stages).map(([stage, score]) => [stage, { score, confidence: 0.9 }]),
    ),
  };
}

test("findSimilar cites a genuinely similar token and describes its real tracked lifecycle", () => {
  const current = report("NewMint111111111111111111111111111111111", {
    concentration: 100,
    insiderFlow: 53,
  });

  const earlyRun = stored("OldMint111111111111111111111111111111111", 1000, 76, "captured", {
    concentration: 100,
    insiderFlow: 50,
  });
  const laterRun = stored("OldMint111111111111111111111111111111111", 2000, 84, "captured", {
    concentration: 100,
    insiderFlow: 53,
  });

  const matches = findSimilar(current, [laterRun], (mint) =>
    mint === "OldMint111111111111111111111111111111111" ? [earlyRun, laterRun] : [],
  );

  assert.equal(matches.length, 1);
  const inference = buildInference(current, matches);
  assert.equal(inference.similar.length, 1);
  assert.match(inference.similar[0]!.note, /climbed from 76\/100 to 84\/100/);
  assert.match(inference.similar[0]!.note, /stayed captured/);
});

test("a candidate tracked only once is cited honestly, not given an invented trajectory", () => {
  const current = report("NewMint111111111111111111111111111111111", {
    concentration: 100,
    insiderFlow: 53,
  });
  const onceRun = stored("OnceMint11111111111111111111111111111111", 1000, 80, "captured", {
    concentration: 98,
    insiderFlow: 55,
  });

  const matches = findSimilar(current, [onceRun], () => [onceRun]);
  assert.equal(matches.length, 1);

  const inference = buildInference(current, matches);
  assert.match(inference.similar[0]!.note, /only been tracked once/i);
  assert.doesNotMatch(inference.similar[0]!.note, /climbed|fell|held steady/);
});

test("a candidate with too little stage overlap is not cited", () => {
  const current = report("NewMint111111111111111111111111111111111", {
    concentration: 100,
  });
  // Only one shared dimension (concentration) — below MIN_SHARED_STAGES.
  const thin = stored("ThinMint11111111111111111111111111111111", 1000, 80, "captured", {
    concentration: 98,
  });

  const matches = findSimilar(current, [thin], () => [thin]);
  assert.equal(matches.length, 0);
});

test("a candidate beyond the similarity threshold is not cited", () => {
  const current = report("NewMint111111111111111111111111111111111", {
    concentration: 100,
    insiderFlow: 90,
  });
  // Wildly different on both shared dimensions.
  const unlike = stored("UnlikeMint1111111111111111111111111111111", 1000, 5, "quiet", {
    concentration: 3,
    insiderFlow: 2,
  });

  const matches = findSimilar(current, [unlike], () => [unlike]);
  assert.equal(matches.length, 0);
});

test("buildInference's summary names the composite, phase and strongest live stage", () => {
  const r = report("NewMint111111111111111111111111111111111", {
    concentration: 100,
    insiderFlow: 40,
  });
  const inference = buildInference(r, []);
  assert.match(inference.summary, /80\/100/);
  assert.match(inference.summary, /captured/);
  assert.match(inference.summary, /concentration at 100\/100/);
});
