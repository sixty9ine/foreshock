# Entry form content

Paste-ready answers for the Crypto World's Fair submission. Kept in the repo because these existed only in a chat window and would otherwise be lost.

**Project name:** Foreshock
**Product track:** Data & Analytics
**Ecosystem track:** Solana
**Tagline:** An early-warning read on Solana tokens. Open, scored, callable by anyone.

The long-form project description (486 words) is in `SUBMISSION.md`.

---

## Registration blurb — 467 characters

> Foreshock scores where a Solana token sits in the pump-and-collapse lifecycle — attention ignition, float concentration, liquidity trap, insider distribution, exhaustion — with the on-chain evidence behind every number. It ships as an open API any wallet, launchpad or bot can call, so the risk read reaches the moment someone is about to buy instead of sitting in a dashboard nobody opens. MIT licensed. Concentration is measured against float, not total supply.

Shorter version, 370 characters, if the field is tighter than expected:

> Foreshock reads where a Solana token sits in the pump-and-collapse lifecycle — ignition, float concentration, liquidity trap, insider distribution, exhaustion — with the on-chain evidence behind each score. It is an open API rather than a dashboard: any wallet, launchpad or bot can call it and show the risk where people actually buy. MIT licensed, no key required.

If the form counts bytes rather than characters, the em-dashes are three bytes each — swap them for commas.

---

## 1. What are you building and who is it for?

> Foreshock is an open risk-scoring primitive for Solana tokens. Give it a mint address and it returns where that token sits across five stages of the pump-and-collapse lifecycle — attention ignition, float concentration, liquidity trap, insider distribution, exhaustion — with the on-chain evidence behind every number.
>
> It is built for integrators rather than end users: wallets and launchpads that want a pre-trade risk read without building the model themselves, trading bots that need a programmatic gate, and researchers who want the underlying evidence rather than a verdict. The reference dashboard exists to demonstrate the API, not to compete for attention with it. The people ultimately served are retail buyers, who get the read inside the app they already use, at the moment they are about to buy.

## 2. Why did you decide to build this, and why build it now?

> I kept doing this by hand. Deep-diving AI-agent narrative tokens — BICO, HEI, DEXE, TUT — I found the same structural arc each time: narrative ignition, wallet concentration, a squeeze, insider distribution, violent correction. Reconstructing that sequence manually after each collapse taught me the pattern was repeatable, and that nobody was reading it before the fact.
>
> Now, because the surface finally exists. Wallets and swap interfaces have become the place where pre-trade information is shown, which means a risk read can reach someone at the moment of decision rather than living on a site they would have to think to visit. The structural data has been on-chain the whole time. What was missing was a scored, callable form that other products could put in front of people — and an incentive to publish it openly rather than sell signals.

## 3. What technologies are you using or integrating to build your product?

> TypeScript on Node 20, structured so the scoring logic is a pure function — snapshot in, report out, with no network calls inside it. That makes it testable without consuming rate limit and trivial to expose over HTTP, as a CLI, or as an imported library.
>
> All chain access sits behind a single provider interface, so the data source can be swapped without touching the scorer. The primary provider is the Helius DAS API for mint supply and token-account enumeration, with market data from DexScreener. HTTP via Hono. Tests with the Node test runner, run against a synthetic data provider that reproduces captured, distributing and healthy token shapes so the model can be validated deterministically. React for the reference client. MIT licensed throughout.

## 4. Which chains does your project use?

> Solana. Only Solana, deliberately — the model depends on reading holder distribution and early-wallet behaviour at account level, and doing that properly for one chain is worth more than doing it approximately for several.

## 5. How does your project use these chains?

> Read-only, and substantively — every signal is derived from Solana state rather than from a price feed with a chain logo on it. No programs are deployed and no transactions are sent.
>
> Mint supply and decimals come from the DAS API. Token accounts are enumerated and aggregated by owner, since one holder may control several accounts and concentration is a question about actors, not addresses. Each address is then classified — liquidity pool, burn, exchange, program-owned — to derive float, because concentration measured against total supply counts the liquidity pool as the largest holder and makes every well-funded token look captured. Early-buyer behaviour is reconstructed from transaction history where the provider exposes it, to detect distribution and shared funding sources across the first cohort; where it is not available, that stage reports itself unavailable rather than guessing.

## 6. What category best describes your product?

> Data & Analytics.

---

## Notes on these answers

**Q2 is the weakest if a judge pushes.** The honest counter is that this data has been available for a while, so the argument rests on the integration surface existing now. Be ready to make that point out loud rather than leaning on the text.

**Q5 is the one that wins or loses the ecosystem track.** It is long deliberately — "does this actually use Solana or just mention it" is the question that track exists to ask.

**Q3 describes architecture, not a deployed endpoint.** Keep it that way until the HTTP route actually exists and is reachable. Do not claim a live API before `src/api/server.ts` is written and deployed.
