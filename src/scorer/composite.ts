import { scoreConcentration } from "./stages/concentration.js";
import { scoreExhaustion } from "./stages/exhaustion.js";
import { scoreIgnition } from "./stages/ignition.js";
import { scoreInsiderFlow } from "./stages/insiderFlow.js";
import { scoreLiquidityTrap } from "./stages/liquidityTrap.js";
import { MIN_SUPPLY_COVERAGE, WEIGHTS } from "./thresholds.js";
import type { Phase, Report, StageId, StageResult, TokenSnapshot } from "./types.js";

/**
 * The entry point. Pure: no network, no clock beyond snapshot.fetchedAt.
 *
 * Stages that could not run are kept in the output with their reason rather
 * than dropped, so a thin read is visibly thin instead of quietly confident.
 */
export function score(snap: TokenSnapshot): Report {
  const stages: StageResult[] = [
    scoreIgnition(snap),
    scoreConcentration(snap),
    scoreLiquidityTrap(snap),
    scoreInsiderFlow(snap),
    scoreExhaustion(snap),
  ];

  const live = stages.filter((s) => s.confidence > 0 && !s.unavailable);

  // Each stage's declared weight, scaled by how much it trusts itself. A stage
  // that ran on partial data pulls the composite less than one that didn't.
  const weighted = live.map((s) => ({
    score: s.score,
    weight: (WEIGHTS[s.stage] ?? 0) * s.confidence,
  }));
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

  const composite =
    totalWeight > 0
      ? Math.round(weighted.reduce((sum, w) => sum + w.score * w.weight, 0) / totalWeight)
      : 0;

  const confidence =
    live.length > 0 ? live.reduce((sum, s) => sum + s.confidence, 0) / live.length : 0;

  const { phase, rationale } = inferPhase(stages);

  return {
    mint: snap.mint,
    ...(snap.symbol !== undefined ? { symbol: snap.symbol } : {}),
    generatedAt: snap.fetchedAt,
    composite,
    confidence: Number(confidence.toFixed(2)),
    phase,
    phaseRationale: rationale,
    stages,
    caveats: collectCaveats(snap, stages),
  };
}

const at = (stages: StageResult[], id: StageId): StageResult | undefined =>
  stages.find((s) => s.stage === id);

/**
 * Phase is read from the SHAPE of the stage scores, not from the composite.
 * Two tokens can score 70 for opposite reasons — one loading up, one already
 * unwinding — and the distinction is the whole point of a staged model.
 */
function inferPhase(stages: StageResult[]): { phase: Phase; rationale: string } {
  const get = (id: StageId) => {
    const s = at(stages, id);
    return s && !s.unavailable && s.confidence > 0.25 ? s.score : null;
  };

  const ignition = get("ignition");
  const concentration = get("concentration");
  const insider = get("insiderFlow");
  const exhaustion = get("exhaustion");

  const known = [ignition, concentration, insider, exhaustion].filter((v) => v !== null).length;
  if (known < 2) {
    return {
      phase: "indeterminate",
      rationale: "Too few stages produced a confident read to place this in the lifecycle.",
    };
  }

  if (insider !== null && insider >= 65 && exhaustion !== null && exhaustion >= 55) {
    return {
      phase: "unwinding",
      rationale: "Early holders are distributing and the move is already off its high.",
    };
  }
  if (insider !== null && insider >= 60) {
    return {
      phase: "distributing",
      rationale: "Early holders are selling into the move while the price still holds up.",
    };
  }
  if (exhaustion !== null && exhaustion >= 65) {
    return {
      phase: "exhausted",
      rationale: "Buying is thinning out under a price that has not adjusted yet.",
    };
  }
  if (ignition !== null && ignition >= 60 && (concentration ?? 0) >= 50) {
    return {
      phase: "igniting",
      rationale: "Attention is arriving fast into a float that a few wallets control.",
    };
  }
  if (ignition !== null && ignition >= 60) {
    return {
      phase: "igniting",
      rationale: "Attention is arriving fast; no distribution visible yet.",
    };
  }
  return { phase: "quiet", rationale: "No stage is signalling strongly." };
}

function collectCaveats(snap: TokenSnapshot, stages: StageResult[]): string[] {
  const out: string[] = [];

  // Provider failures first — they explain most of what follows.
  for (const n of snap.notes ?? []) out.push(n);

  for (const s of stages) {
    if (s.unavailable) out.push(`${s.stage}: ${s.unavailable}`);
  }
  if (snap.holders.length > 0 && snap.supply.total > 0) {
    const coverage = snap.holders.reduce((s, h) => s + h.amount, 0) / snap.supply.total;
    if (coverage < MIN_SUPPLY_COVERAGE) {
      out.push(
        `The ${snap.holders.length} holder rows cover ${(coverage * 100).toFixed(1)}% of supply; a large untagged position could sit outside that window.`,
      );
    }
  }
  if (!snap.supply.circulating) {
    out.push("No circulating-supply figure; float is derived from total supply minus tagged accounts.");
  }
  out.push(
    "Thresholds are ported from EVM-side research on AI-agent narrative tokens and have not been calibrated on Solana. Treat the magnitude as indicative and the ordering as the useful part.",
  );
  return out;
}
