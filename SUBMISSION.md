Most token risk tools are closed dashboards. You visit their site, or you get nothing — so the risk read never arrives at the moment that matters, which is the moment someone is about to buy.

Foreshock inverts that. It is a scored API first and a dashboard second. Give it a mint address and it returns where that token sits across five stages of the pump-and-collapse lifecycle, with the on-chain evidence behind every number. Any wallet, launchpad, bot or trading interface can call it and surface the read inside their own product, where the decision is actually made.

**The model.** Five stages, derived from structural research on AI-agent narrative tokens that collapsed along a repeatable arc: attention ignition, float concentration, liquidity trap, insider distribution, exhaustion. Each is computed independently from holder distribution, pool depth and early-wallet behaviour.

Concentration is measured against float, not total supply — LP, burn, CEX and program balances are excluded before anything is divided. That sounds like a detail and isn't: count a liquidity pool as the top holder and every healthy token looks captured. It is the most common way a concentration read produces nonsense.

**Two outputs, not one.** A composite 0–100, and a phase inferred from the shape of the stage scores rather than their sum. Two tokens can score 70 for opposite reasons — one loading up, one already unwinding — and collapsing that into a single number destroys the distinction that makes a staged model worth having.

**Confidence is separate from score.** A stage with no data declares itself unavailable rather than returning zero, because a silent zero is indistinguishable from "no risk found," and that is exactly how risk tools mislead. Every number carries how much the model trusts it.

**Composability.** MIT licensed. The scorer is a pure function — snapshot in, report out, no network calls inside it — so it can be imported directly, run against your own data, or called over HTTP. The data layer sits behind a provider interface, so swapping one source for another touches nothing downstream. Nothing here is built to keep users on our page, because there is no page to keep them on.

**Who it is for.** Wallets and launchpads wanting a pre-trade risk read without building the model. Bots needing a programmatic gate. Researchers who want evidence rather than a verdict. The business is paid tiers on a primitive other products depend on; the open endpoint is the distribution, not the product.

**Limitations, stated plainly.** The thresholds are ported from EVM-side research and are not yet calibrated for Solana — the ordering the model produces is more trustworthy than any single magnitude. The exit-impact figure is a constant-product upper bound, not a routed quote. Float tagging is heuristic beyond the known addresses. The README says all three.

Foreshock describes structure, not intent. A high score means a token is shaped like ones that collapsed. A foreshock is recognised, not predicted — and so is this.
