# Demo video script

Target length: **2:30**. Screen is the dashboard (`cd dashboard && npm run dev`) unless noted. Read the voiceover at a normal pace — it is timed to roughly 150 words/minute, so don't rush it to hit the clock; cut a line instead.

Record the dashboard screen first, narrate over it after — easier to get clean timing than talking live while clicking.

---

## 0:00–0:15 — Hook

**Screen:** blank terminal, or a static slide with the tagline.

> Most token risk tools are a dashboard you have to think to visit. By the time you check it, you've already bought. Foreshock is a risk read that lives where the decision actually happens — inside the wallet or the swap screen, because it's an API, not a destination.

## 0:15–0:35 — What it is

**Screen:** Foreshock dashboard, empty state, tagline visible.

> Paste a Solana mint address and it scores where that token sits across five stages of the pump-and-collapse lifecycle — attention ignition, float concentration, liquidity trap, insider distribution, exhaustion — with the on-chain evidence behind every number, not just a verdict.

## 0:35–1:20 — Live demo: a token that already collapsed

**Screen:** click the "MASKIT (captured)" example chip. Let it score (several seconds — don't cut this, the wait is honest). Scroll to show composite, phase, and the concentration card.

> This one launched a few days ago. [pause for load] Composite 83, severe. Phase: captured. Not predicted — read. Concentration is 100 out of 100: one wallet holds 97% of the float. Insider flow: the entire first-buyer cohort is already out. That's not a guess about the future, that's what's on-chain right now.

**Screen:** scroll to the caveats section, point out the DexScreener caveat if present (or just the general caveats list).

> And when a data source doesn't have something — like market data if a pair gets delisted — the model says so. It never fills the gap with a quiet zero. A silent zero and "no risk found" look identical, and that's exactly how risk tools lie.

## 1:20–1:45 — Composite vs. phase

**Screen:** point at the composite number, then the phase chip, side by side.

> Two numbers, not one. The composite says how severe. The phase says *why* — igniting, distributing, captured, exhausted. Two tokens can both score 70 for completely opposite reasons: one still loading up, one already unwinding. Collapsing that into a single number throws away the part that actually matters for a decision.

## 1:45–2:10 — It's an API, the dashboard is secondary

**Screen:** switch to a terminal, run:
```bash
curl https://foreshock-api.onrender.com/score/<mint>
```
Show the raw JSON scrolling.

> This dashboard exists to prove the API works — it isn't the product. The product is this: one HTTP call, JSON back, composite, phase, every stage's evidence. Any wallet, launchpad, or trading bot can call it directly and put the read in front of someone at the moment they're about to buy.

## 2:10–2:30 — Close

**Screen:** GitHub repo page, README visible.

> MIT licensed, open source, live right now. Every limitation it actually has is stated plainly in the README, not buried — a risk tool that oversells itself is worse than none. Foreshock.

---

## Notes for whoever records this

- **The MASKIT run can be slow or occasionally rate-limited** (DexScreener/GeckoTerminal on the hosted free tier — see README Limitations). If it comes back visibly degraded on the first take, that's fine to keep in — it's honest behavior, not a bug, and the script's line about "the model says so" covers it. If it's just slow, cut the dead air in editing rather than re-recording.
- **Don't promise a live API if it isn't reachable at record time** — check `curl https://foreshock-api.onrender.com/` (the liveness route) right before recording the terminal segment.
- If the free-tier instance is asleep, the first `curl` can take 30-60s to respond — either warm it up with a throwaway request before recording, or cut that wait in editing.
- Keep the composite/phase numbers you narrate matched to whatever the live run actually shows at record time — don't quote this script's numbers if a fresh run gives different ones. Say what's on screen.
