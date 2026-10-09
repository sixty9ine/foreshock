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

As an HTTP route (`src/api/server.ts`), locally for now — not yet deployed:

```bash
export HELIUS_API_KEY=...
npm run api                         # listens on :8787 by default, PORT to override
curl localhost:8787/health
curl localhost:8787/score/<mint>
```

A live request runs a smaller `insiderFlow` lookback budget than the CLI (`EARLY_WALLETS_FETCH.API_MAX_PAGES` in `thresholds.ts`) — a CLI invocation is someone willing to wait tens of seconds; an HTTP caller generally is not. The tradeoff is not correctness, only how often that stage gives up and declares itself unavailable rather than keep searching.

## Worked example

> **TODO before submission.** Run this against a token that actually collapsed, with a snapshot from before the collapse, and paste the output here. This section is worth more than a sixth stage — it is the difference between a judge believing the model and taking your word for it.

## Limitations

Stated plainly, because a risk tool that oversells itself is worse than none.

- **The thresholds are not calibrated for Solana.** They are ported from EVM-side research in a different liquidity regime. The *ordering* the model produces is more trustworthy than the magnitude of any single score.
- **Float tagging is the weak point.** Concentration is measured against float, which requires correctly identifying LP, burn, CEX and program accounts. An untagged pool address reads as a whale and inflates the score. `KNOWN_ADDRESSES` covers the obvious cases; pool resolution is heuristic.
- **The exit-impact figure is an upper bound.** Constant product, single pool, no routing. Real aggregator routing does better. Replacing this with a live quote is the highest-value single improvement available.
- **Insider flow needs first-buyer data** that not every provider exposes. Where it is missing the stage sits out rather than guessing.
- **This is not financial advice and not a rug detector.** It describes structure, not intent. A high score means a token is shaped like ones that collapsed, which is not the same as saying it will.

## Methodology provenance

The five-stage framework comes from prior independent research by the author on AI-agent narrative tokens, conducted before this hackathon. **The framework is pre-existing; all code in this repository was written during the hackathon period** against Solana data, which the earlier work did not cover. No code from that earlier research is included here.

## Licence

MIT. Use it, fork it, call the endpoint, build the risk read into your own product.
