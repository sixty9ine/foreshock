# Foreshock

**An early-warning read on Solana tokens. Open, scored, callable by anyone.**

A foreshock is a smaller quake that runs ahead of the main one. Seismologists don't predict the mainshock from it — they recognise the sequence, because they have seen it before.

This is that, for token float.

---

## What it does

Most token risk tools are closed dashboards. You visit their site, or you get nothing — which means the risk read never reaches the moment someone is about to buy.

Foreshock is built the other way round: a scored API first, a dashboard second. Give it a mint address and it returns where that token sits across five stages — attention ignition, float concentration, liquidity trap, insider distribution, exhaustion — with the on-chain evidence behind every number. Any wallet, launchpad or trading UI can call it and surface the read in their own interface.

The model comes from structural research on AI-agent narrative tokens that collapsed along a repeatable arc. Each stage reports confidence separately from score, and a stage with no data says so rather than returning a reassuring zero.

MIT licensed, no key required to read. The thresholds aren't yet calibrated for Solana and this README says exactly that — the ordering is more trustworthy than any single magnitude.

```
GET /score/<mint>  →  { composite, confidence, phase, stages[], caveats[] }
```

The scorer is a pure function — snapshot in, report out, no network inside it — so it can also be imported directly and run against your own data source.

**Submitted to:** Crypto World's Fair — Data & Analytics track, Solana ecosystem track.

## The model

Five stages, derived from structural research on AI-agent narrative tokens (BICO, HEI, DEXE, TUT) that followed a repeatable arc: narrative ignition → wallet concentration → squeeze → insider distribution → violent correction.

| Stage | Reads | Weight |
|---|---|---|
| `ignition` | Attention arriving faster than the token's own history justifies | 0.15 |
| `concentration` | Share of **float** held by few wallets, LP/burn/CEX excluded | 0.30 |
| `liquidityTrap` | Notional resting on pool depth; modelled cost of exiting | 0.20 |
| `insiderFlow` | Early cohort selling, shared funding sources, unsold overhang | 0.25 |
| `exhaustion` | Position against the high; volume fading under a held price | 0.10 |

Two outputs, not one:

- **`composite`** — 0–100, weighted across stages, each stage's weight scaled by its own confidence. A stage running on partial data pulls the number less.
- **`phase`** — read from the *shape* of the stage scores, not from the composite. Two tokens can both score 70 for opposite reasons, one loading up and one already unwinding, and that distinction is the point of a staged model.

Every stage reports `confidence` separately from `score`. A stage with no data declares itself `unavailable` rather than returning zero, because a silent zero is indistinguishable from "no risk found" and that is how risk tools lie.

## Run it

No API key needed to see it work:

```bash
npm install
npm run score -- --fixture distributing
npm test
```

Against live data:

```bash
export HELIUS_API_KEY=...
npm run score -- --health          # probe providers first
npm run score -- <mint>
npm run score -- <mint> --json
```

As an HTTP route (`src/api/server.ts`), hosted at **https://foreshock-api.onrender.com**:

```bash
curl https://foreshock-api.onrender.com/health
curl https://foreshock-api.onrender.com/score/<mint>
```

Or locally:

```bash
export HELIUS_API_KEY=...
npm run api                         # listens on :8787 by default, PORT to override
curl localhost:8787/health
curl localhost:8787/score/<mint>
```

The hosted instance is free-tier: it sleeps after inactivity (first request after idle takes ~30-60s), and its shared egress IP occasionally gets rate-limited by DexScreener or GeckoTerminal — see Limitations below. Neither ever produces a silently wrong score, only a visibly thinner one.

A live request runs a smaller `insiderFlow` lookback budget than the CLI (`EARLY_WALLETS_FETCH.API_MAX_PAGES` in `thresholds.ts`) — a CLI invocation is someone willing to wait tens of seconds; an HTTP caller generally is not. The tradeoff is not correctness, only how often that stage gives up and declares itself unavailable rather than keep searching.

## Worked example

`MASKIT` (`Cd8LqgfpwzxjtU8YwrK9BvFwtR2FvPAHVbLZrVwpump`) launched on Solana at **2026-10-07 14:37 UTC**. Scored twice in its first three hours, then once more live, two days later, for this section.

**T+2h38m** — `examples/maskit-2026-10-07-after-phase-fix.json`:

```
composite 76/100 (severe)   phase: captured
concentration   100/100     top 10 wallets hold 100% of float; largest single wallet holds 97.4%
insiderFlow      53/100     19 of 20 first buyers already fully exited; 0% of float still held by the original cohort
```

**Today** — reproducible right now, `npm run score -- Cd8LqgfpwzxjtU8YwrK9BvFwtR2FvPAHVbLZrVwpump`:

```
composite 83/100 (severe)   phase: captured
caveat: provider dexscreener failed: no Solana pairs for this mint
```

DexScreener no longer lists a pair for this mint at all — the trading venue itself is gone. The model didn't predict that; it read the float as 97%+ controlled by a single wallet with its entire first-buyer cohort already out, within the token's first three hours, which is exactly the shape of a token that doesn't have anywhere good left to go. Full raw output for both runs, including the market data each one scored, is in `examples/`.

This is also the mint that caught a real bug in the model. The first run above originally reported `phase: quiet` on that same 76/100 severe composite — concentration had no path to a phase label without an active ignition signal, so severe risk read as safe. Fixed the same day: `inferPhase()` gained a `captured` phase for exactly this shape, and `reconcilePhase()` now makes "quiet" structurally impossible against a high-or-severe composite, regardless of which stage combination produced it (`src/scorer/composite.ts`). Both the buggy and the fixed run are kept side by side in `examples/` — `maskit-2026-10-07.json` and `maskit-2026-10-07-after-phase-fix.json` — as the record, with a provenance note for each explaining what changed and why.

## Limitations

Stated plainly, because a risk tool that oversells itself is worse than none.

- **The thresholds are not calibrated for Solana.** They are ported from EVM-side research in a different liquidity regime. The *ordering* the model produces is more trustworthy than the magnitude of any single score.
- **Float tagging is the weak point.** Concentration is measured against float, which requires correctly identifying LP, burn, CEX and program accounts. An untagged pool address reads as a whale and inflates the score. `KNOWN_ADDRESSES` covers the obvious cases; pool resolution is heuristic.
- **The exit-impact figure is an upper bound.** Constant product, single pool, no routing. Real aggregator routing does better. Replacing this with a live quote is the highest-value single improvement available.
- **Insider flow needs first-buyer data** that not every provider exposes. Where it is missing the stage sits out rather than guessing.
- **The hosted instance can hit upstream rate limits.** Free-tier hosting means a shared egress IP, and DexScreener/GeckoTerminal are both keyless, best-effort public APIs — a 429 from either reads in the output as `ignition`/`exhaustion` unavailable and a named caveat, never a silent wrong number. Re-running the same mint a few seconds later usually clears it. This is a hosting constraint, not a scoring one.
- **This is not financial advice and not a rug detector.** It describes structure, not intent. A high score means a token is shaped like ones that collapsed, which is not the same as saying it will.

## Methodology provenance

The five-stage framework comes from prior independent research by the author on AI-agent narrative tokens, conducted before this hackathon. **The framework is pre-existing; all code in this repository was written during the hackathon period** against Solana data, which the earlier work did not cover. No code from that earlier research is included here.

## Licence

MIT. Use it, fork it, call the endpoint, build the risk read into your own product.
