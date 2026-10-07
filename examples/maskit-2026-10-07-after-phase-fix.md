# Provenance — maskit-2026-10-07-after-phase-fix

Same mint as `maskit-2026-10-07.json` (`Cd8LqgfpwzxjtU8YwrK9BvFwtR2FvPAHVbLZrVwpump`), re-scored
~2 hours later after fixing a bug in `inferPhase` (`src/scorer/composite.ts`).

**The bug.** The original `maskit-2026-10-07.json` reads `composite 76 (severe)` /
`phase quiet` — with one wallet holding 97.4% of float. Concentration had no path
to a phase that did not also require ignition, so a token that was severely
concentrated but not currently pumping fell through every branch to the "quiet"
catch-all. Severe risk reported as quiet.

**The fix.** Added a `captured` phase, reached by concentration alone above a
high bar (`CONCENTRATION.CAPTURED_PHASE_MIN`, `thresholds.ts`), placed after the
distributing/exhausted branches so an actively unwinding token still reports
that first. Also added `reconcilePhase()` as a standing invariant, independent
of this specific fix: `quiet` can never survive a high-or-severe composite,
whatever stage combination produced it — catching this class of contradiction
even from a cause other than concentration (e.g. liquidityTrap, which carries
composite weight but was never part of phase inference at all).

**This file is the "after."** Re-running the same mint:

| | before (`maskit-2026-10-07`) | after (this file) |
|---|---|---|
| composite | 76 (severe) | 77 (severe) |
| phase | `quiet` — "No stage is signalling strongly." | `captured` — "Concentration scores 100/100…" |
| concentration | 100, largest holder 97.4% | unchanged |
| trading | still active (99 buys / 100 sells, h1 volume nonzero) | stopped (0 buys/sells in m5 and h1; DexScreener reports no pooled liquidity figure at all) |

The small composite drift (76→77) and the newly-dark `liquidityTrap` stage are
real market movement in the ~2 hours between runs — the token stopped trading
entirely — not an effect of the phase fix. The phase fix is the `quiet` →
`captured` change, confirmed by holding concentration and composite roughly
constant across the two runs. Also added in this pass: both reports now carry
an `inputs` block (price, market cap, liquidity, volume, price change, pair
age, holder-row count) copied directly from the snapshot that was scored, so
a saved report can be checked against what the provider actually returned
rather than taken on the composite and phase alone.
