# Handover — Foreshock

**Written 6 October 2026.** For a fresh Claude session picking this up on the Mac. Read this first, then `README.md`, then `ENTRY.md`.

---

## The clock

Submission deadline: **11:59pm PT, Sunday 12 October** = **7:59am Lagos, Monday 13 October**.
Kill checkpoint: **Friday 9 October, end of day** — see "Kill criteria" below. That date is not advisory.

## What this is

Foreshock — an open risk-scoring primitive for Solana tokens. Paste a mint address, get a score across five stages of the pump-and-collapse lifecycle, with the on-chain evidence behind each number. Ships as a callable API; the dashboard is the reference client, not the product.

Submitted to the **Crypto World's Fair** hackathon (Colosseum), **Data & Analytics** product track plus the **Solana** ecosystem track. Prizes pay USDC-SPL to a wallet, which is the only verified-clean payout rail Polymath has — he works from Nigeria and bank-transfer prizes frequently do not reach him. Nigeria is not on Colosseum's exclusion list; that was checked against the rules PDF.

Registration on colosseum.com is a precondition of submitting. **Confirm this was done** — as of writing it had not been.

## Current state of the code

Verified working:

- 9/9 tests pass, `tsc --noEmit` clean.
- Fixture scores: `captured` **69**, `distributing` **79**, `healthy` **7**. These are the regression check — if they move, the model moved.
- DexScreener provider confirmed working from Polymath's connection. Market-driven stages populate correctly: WIF read $244.63M market cap over $7.10M pooled liquidity, 34.5×, which is right.
- **The Helius code path now works.** `--health` passes, and a live `getSnapshot` against WIF (`EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm`) returns real holder data. Key lives in `.env` (gitignored) as `HELIUS_API_KEY`; load it with `set -a && source .env && set +a` before `npm run score`. Confirmed 2026-10-06.
- **`KNOWN_ADDRESSES` in `src/data/provider.ts` populated with WIF's exchange wallets.** Cross-referenced WIF's top-20 Helius holders against Solscan tags and added 14 CEX addresses (Binance, Coinbase, Kraken, Bybit, OKX, Robinhood, BtcTurk). WIF concentration dropped from 64/100 to **0/100** and largest single holder from 15.4% to **4.0%** — single digits, the sanity-check target this doc named. Composite dropped from 40 to 7 (low), which is the right direction for a large, liquid, CEX-heavy token. A few top-20 addresses stayed untagged because Solscan shows no label for them (e.g. `AVPKzX2QZ8E23SWR728yhMTnnqr9UjAZdgemfaE3qHg5`) — don't assume those are pools or exchanges without evidence.
- **`exhaustion` now runs.** `dexscreener.ts` fetches hourly OHLCV from GeckoTerminal (free, no key, keyed by DexScreener's `pairAddress`) to populate `market.ath` and `series`. Capped at 1000 hourly candles (~41 days); when a pool is older than that window, a caveat says the all-time high may be an undercount rather than silently treating the window as exhaustive — confirmed firing correctly on WIF (1051 days old). Confirmed 2026-10-06. While here, also fixed a real bug in `merge()`: a provider's own `notes` (e.g. "GeckoTerminal unavailable") were being dropped on a successful call — only top-level provider failures survived. Both providers' notes now merge.

Confirmed, and partially fixed:

- **Untagged liquidity pools do inflate concentration, as predicted.** Scoring SNDWITCH (`J9qzFhTLYnmf3tZYvHBaF96rH3YKToELAAVMzz66pump`, a 3h-old pump.fun token) found its "largest holder" at 8.75% was actually the Pump.fun AMM pool's own PDA. While fixing it, found that `KNOWN_ADDRESSES` was typed as `Record<string, "burn" | "program" | "cex">` — missing the `"lp"` and `"treasury"` tags the scorer's `HolderTag` type already supports. Widened the type and tagged that one pool address `"lp"`. SNDWITCH concentration dropped from 12/100 to 0/100; composite 48 → 43, now correctly driven by ignition alone rather than a false concentration read. Confirmed 2026-10-06.
- **This fix does not generalize.** The tagged address is that one pool's PDA — every pump.fun/Raydium/Orca pool has its own address, so the next new token will hit the same gap. The real fix (resolve any top holder back to its controlling AMM program automatically, instead of an address list) is still open — `helius.ts` already names it as the highest-value improvement. Until it's built, treat a low concentration score on a freshly-minted or thinly-traded token as unverified — check whether the top holder is actually a pool before trusting it.
- Float tagging is otherwise still heuristic beyond `KNOWN_ADDRESSES`, which is now built from two tokens' (WIF's and SNDWITCH's) top-20 holders. Extending it is an ongoing task, not a one-time fix.
- **`insiderFlow` now runs** (`src/data/earlyWallets.ts`). It walks a mint's Helius transaction history backward from the current tip, looking for genesis (the pool-creation transaction) within a 3,000-transaction budget (`EARLY_WALLETS_FETCH` in `thresholds.ts`). If genesis is reached, it ranks the first 20 distinct non-pool, non-deployer buyers by first appearance — pool/deployer exclusion is a frequency heuristic (whichever address is party to a disproportionate share of transfers), not a program-specific address list, so it works across Raydium/Orca/Pump.fun alike. If the budget runs out first, it declares itself unavailable rather than report on a window that is not provably the earliest — verified both ways: MASKIT (`Cd8LqgfpwzxjtU8YwrK9BvFwtR2FvPAHVbLZrVwpump`, ~20 min old, low volume) reached genesis and scored a real cohort (13 of 20 first buyers already out); SNDWITCH (now 19h old, ~2 swaps/sec) correctly hit the budget wall and said so. Confirmed 2026-10-07.
- **This is slow and not free.** A budget-exceeded run costs up to ~70 Helius calls (30 pages walking back + per-wallet balance/funder lookups) and took 47 seconds on SNDWITCH; the happy path on a quiet token took under 8 seconds. Fine for the CLI, a real design decision for a live API — see "Immediate next actions."
- Funding-source tracing (`fundedBy`) is itself best-effort within best-effort: one lookback call per wallet, and it only catches a SOL transfer immediately before the first buy. A wallet funded by a token swap, an airdrop, or that simply pre-existed with a balance reads as untraceable, not as "no shared funder" — confirmed on MASKIT, where only 25% of the cohort traced and the stage's own confidence score reflected that rather than hiding it.
- **Fixed a real bug in `extractEarlyBuyers`'s pool-exclusion step, 2026-10-07.** It classified a pool by appearance frequency alone — but a wash-trading wallet round-tripping against the pool can cross any frequency share just by trading with itself more, and was getting silently dropped as a "pool." That is exactly the wallet insiderFlow exists to catch, and the output gave no sign anything had been removed — the same failure mode as the bugs in HANDOVER's own "bug pattern" section. Fixed by requiring both frequency AND counterparty breadth (`POOL_DETECTION` in `thresholds.ts`): a pool trades with nearly everyone, a wash-trader's counterparty set stays at one address no matter how many round trips it makes. Re-ran the committed MASKIT example after the fix — unchanged, confirmed byte-for-byte except the timestamp; its cohort didn't happen to include a wash-trader. See `examples/maskit-2026-10-07.md` for that provenance note.
- **Fixed a second, more visible bug in `inferPhase`, same day: concentration had no path to a phase without ignition.** `examples/maskit-2026-10-07.json` is the proof — one wallet holding 97.4% of float, composite 76 (severe), and phase `quiet`. Every phase branch required `ignition >= 60` or a specific insider/exhaustion read; a token that was severely concentrated but NOT currently pumping fell through all of them to the `quiet` catch-all. Severe risk reported as quiet is the single worst thing this model can say. Fixed two ways: (1) added a `captured` phase that fires on concentration alone above `CONCENTRATION.CAPTURED_PHASE_MIN` (80), placed after the distributing/exhausted branches so an actively unwinding token still reports that first; (2) added `reconcilePhase()` as a standing invariant — `quiet` can never survive a high-or-severe composite band, regardless of which stage combination produced it, catching this class of contradiction even from a future cause this fix didn't anticipate (liquidityTrap carries real composite weight and was never part of phase inference at all). Re-ran MASKIT after the fix: phase is now `captured`, composite 77 — see `examples/maskit-2026-10-07-after-phase-fix.{json,txt,md}`. Keep both MASKIT pairs; together they're the record of this bug and its fix, not just the current reading.
- **`Report` now echoes its own scored inputs** (`inputs.market` — price, market cap, liquidity, volume, price change, pair age — and `inputs.holderRows`), a plain copy from the snapshot, not re-derived. Added so a saved example can be checked against what the provider actually returned instead of standing on the composite and phase alone — the gap that made the quiet/severe contradiction above harder to catch from the JSON alone.
- **The API route exists and runs** (`src/api/server.ts`, Hono + `@hono/node-server`). `npm run api` serves `GET /health` and `GET /score/:mint`; CORS is open, matching the "any wallet, launchpad or trading UI can call it" pitch. It resolves the latency decision flagged below by giving a live request a much smaller `insiderFlow` lookback budget than the CLI (`EARLY_WALLETS_FETCH.API_MAX_PAGES = 5` vs the CLI's `MAX_PAGES = 30`, in `thresholds.ts`) — `helius()` and `fetchEarlyWallets()` both now take the budget as a parameter rather than reading the constant directly, so the CLI's own behavior is unchanged. Verified live through the actual HTTP route both ways: a high-volume token (WIF) now hits the budget wall and honestly declines in ~9s instead of ~50s; a low-volume token that reaches genesis (MASKIT) still returns a real cohort in ~6s. **Not yet deployed anywhere** — runs locally only. Confirmed 2026-10-09.

Does not exist yet:

- **The React dashboard.**
- The worked example in the README, which is a TODO and matters more than a sixth signal stage.
- **Deployment.** Target is Render, chosen 2026-10-09. `render.yaml` (Blueprint spec) is in the repo root — build `npm install && npm run build`, start `node dist/api/server.js`, `HELIUS_API_KEY` marked `sync: false` so Render prompts for it in the dashboard rather than reading it from the repo. **Claude cannot create the Render account or click deploy** — account creation is a hard no, and there are no Render credentials in this environment anyway. Sign in at render.com (GitHub login is simplest), New + → Blueprint → select `sixty9ine/foreshock`, paste `HELIUS_API_KEY` when prompted — not anywhere in the repo. Free tier sleeps after inactivity: first request after idle takes ~30-60s. Do not claim a live API in `ENTRY.md`/`SUBMISSION.md` until the URL is confirmed reachable.
- **First deploy attempt crash-looped: "Instance failed... HTTP health check failed with status code 503."** Root cause, found 2026-10-09 without needing dashboard access — `render.yaml`'s `healthCheckPath` pointed at `/health`, and that route returns 503 whenever Helius or DexScreener report unhealthy. Render reads ANY non-2xx from its health check as "this app is broken" and kills the instance — but a third-party dependency blip is not the same claim as "this process is not running," and conflating them meant a Helius hiccup (or the key simply not being entered yet) would get a perfectly fine server killed in a loop it could never fix by restarting. Fixed by splitting the two concerns: `GET /` is now pure liveness (no external call, always 200 once the process is up) and is what `render.yaml` points at; `GET /health` still reports true dependency health for a human to check deliberately, and deliberately still returns 503 when something upstream is down — that is correct for its purpose, just wrong as a deploy gate. Verified locally both ways: `/` stays 200 even with a deliberately broken Helius key (401), `/health` correctly reports 503 in the same run. If the Render deploy still fails after this, the cause is something else — check the dashboard logs rather than assume this fix covers it.

## The bug pattern — read this before writing code

Three bugs were found in two days and all three were the same mistake: **producing a plausible value instead of admitting a gap.**

1. `walletsToHalf` returned the array length when the loop never reached 50% of float, reporting "1000" as if it were a measurement.
2. The CLI substituted a placeholder mint when none was supplied, so a typo surfaced several seconds later as an opaque `WrongSize` from the RPC.
3. `merge()` collected successful providers and silently discarded failures, so a dead chain provider and a token with no holders produced identical output.

A fourth, related: concentration confidence was computed from the *number of holder rows* rather than the fraction of supply they covered, so 1000 dust wallets reported 100% confidence on a 0% concentration reading. Confidently wrong, which for a risk tool is the worst possible failure.

This matters beyond hygiene. The project's pitch is that a stage with no data says so rather than returning a reassuring zero. Any new code that guesses, defaults, or falls back silently contradicts the thing being submitted. When a value cannot be determined, return null and say why.

## Immediate next actions

1. ~~Confirm Colosseum registration.~~ Done — confirmed 2026-10-06.
2. ~~Get one successful Helius call.~~ Done — `--health` and a live WIF snapshot both work. See "Current state of the code" above.
3. ~~Populate `KNOWN_ADDRESSES` against WIF.~~ Done — 14 CEX wallets tagged, WIF concentration settled to single digits. See above.
4. ~~Build `insiderFlow`.~~ Done 2026-10-07 — see "Current state of the code." All five stages now run or honestly decline; none are permanently stubbed.
5. ~~Build the API route; decide insiderFlow's latency for it.~~ Done 2026-10-09 — `src/api/server.ts` exists, runs locally, and uses a smaller lookback budget than the CLI. See "Current state of the code."
6. **Next: finish the Render deploy** (the blueprint is written and verified locally; someone with hands needs to sign in and click through — see "Does not exist yet" above), then the dashboard, then the worked example. A deployed-but-unreachable route is still "does not exist" for a judge — don't claim it in `ENTRY.md`/`SUBMISSION.md` until the URL is confirmed reachable.
7. Keep extending `KNOWN_ADDRESSES` as other mints get scored. Confirmed working for CEX wallets (WIF) and one pump.fun pool (SNDWITCH) — still a per-address list, not general pool detection. Building the general case (resolve a top holder's controlling program automatically) is the next real lift on this front, not just more entries.

## Cut-line

Already decided. Do not relitigate this at 2am on Sunday.

**Must ship:** registered; public repo with MIT licence; scorer returns a real result for a real mint from live data; demo video; submission form completed.

**Should ship:** hosted API endpoint a judge can hit; three of five stages genuinely computed; business-plan paragraph; a worked example on a token that actually collapsed.

**Cut in this order:** historical backtest view → any chain but Solana → accounts/auth/watchlists → every chart but one sparkline → the fourth and fifth signal stages.

Three stages computed well beats five stubbed. Between a fourth signal and the README worked example, build the example.

## Kill criteria

**If there is no composite score from live data by end of Friday 9 October, stop and abandon the entry.**

Not "push through the weekend" — stop, and start the Qloo Agentic Hackathon on Saturday with 21 days instead of 17. Failing fast is one of Polymath's own standing rules and this is where it applies. A missed deadline is worth zero and the hours come straight out of the better-odds entry.

## Judging criteria, and what was built for them

Functionality, Potential Impact, Novelty, UX, open-source status and composability with other crypto primitives, and Business Plan. No published weights.

Two design decisions exist specifically to answer them, and should survive refactoring:

- **API-first, dashboard second**, with the scorer as a pure function and all network access behind a provider interface. This is the composability answer, stated as architecture rather than as a claim.
- **Two outputs, not one** — a composite score *and* a separately inferred phase. Two tokens can both score 70 for opposite reasons, one loading up and one already unwinding, and collapsing that into a single number destroys what makes a staged model worth having.

## Known limitations — keep them stated, do not quietly drop them

- Thresholds are ported from EVM-side research on AI-agent narrative tokens (BICO, HEI, DEXE, TUT) and have not been calibrated on Solana. The ordering is more trustworthy than any magnitude.
- The exit-impact figure is a constant-product upper bound, single pool, no routing. Replacing it with a real aggregator quote is the highest-value single improvement in the repo.
- Float tagging is heuristic beyond `KNOWN_ADDRESSES`.
- Excluding CEX balances from float is a judgement call, not a fact. Those tokens can reach the market; the argument for excluding them is that concentration asks "could a few actors crash this", and an exchange wallet is many actors.

Stating these is a strength with judges, not a weakness. The README says all of them.

## Where everything lives

- **Code** — this repo, public on GitHub at https://github.com/sixty9ine/foreshock (created and pushed 2026-10-07). `src/scorer/` is pure logic, `src/data/` is all network access, `test/` has the 17 tests.
- **Thresholds** — `src/scorer/thresholds.ts`, every tuned number in one file, by design.
- **Submission description** (486 words) — `SUBMISSION.md`.
- **Entry form answers** (six questions) and the 467-character registration blurb — `ENTRY.md`.
- **Bounty ledger** — https://claude.ai/artifact/5B7TiAbEEbXkkwrufb1gCu — tracks this and other hackathons. Foreshock is the `colosseum-worlds-fair` entry, status `building`. Qloo is `shortlisted` as the next one.
- **Weekly sweep** — a scheduled task runs Mondays 06:00 UTC (7am Lagos), reads and writes that ledger.

## About Polymath

Solo builder and trader, works from Nigeria (Lagos). Bench science background, now across biotech, crypto/forex trading and web development. TypeScript/Node, React, Next.js, Python.

Standing rules that apply here: bootstrap first, move fast without sacrificing efficiency, **fail fast** — failing is fine as long as it is fast.

Prior work the model draws on: a pump-exhaustion / rug-risk scoring framework derived from deep dives on BICO, HEI, DEXE and TUT; a crypto Early Warning System with a React dashboard and a leverage fragility gauge; a strategy-agnostic forex scanner and backtester in Node/TypeScript.

**On reuse:** the framework predates the hackathon, the code here does not. The README states this plainly and it must stay accurate. Do not import the old `finance/bico-tracker` repo — porting the method rather than the repository is a deliberate choice, both because the rules require disclosure and because Novelty is on the scorecard.
