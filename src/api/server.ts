import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { dexscreener } from "../data/dexscreener.js";
import { helius } from "../data/helius.js";
import { merge, type DataProvider } from "../data/provider.js";
import { score } from "../scorer/composite.js";
import { EARLY_WALLETS_FETCH } from "../scorer/thresholds.js";

/**
 * The HTTP route the dashboard — and anyone else's wallet, launchpad or
 * trading UI — calls. Thin on purpose: this file does validation, error
 * shaping and transport, nothing the scorer itself should know about.
 *
 * A live request is not a CLI invocation. insiderFlow's transaction-history
 * walk can take up to ~50s and ~70 Helius calls on a high-volume token,
 * which is fine for someone who typed `npm run score` and is watching a
 * terminal, and is not fine for a judge hitting an endpoint expecting
 * seconds. EARLY_WALLETS_FETCH.API_MAX_PAGES is deliberately much smaller
 * than the CLI's budget for exactly this reason — see thresholds.ts.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function providers(): DataProvider {
  const key = process.env["HELIUS_API_KEY"];
  if (!key) {
    console.error(
      "warning: HELIUS_API_KEY is not set — serving market-only stages.\n" +
        "         concentration and insiderFlow will report unavailable on every request.",
    );
    return dexscreener();
  }
  return merge(helius(key, { earlyWalletsMaxPages: EARLY_WALLETS_FETCH.API_MAX_PAGES }), dexscreener());
}

const provider = providers();

const app = new Hono();

app.use("*", cors());

// Liveness only: is this process up and serving requests. No external call —
// a host's deploy health check must never depend on a third party's uptime,
// or a Helius/DexScreener blip reads as "this app is broken" and gets the
// instance killed and restarted for a problem restarting it cannot fix.
app.get("/", (c) => c.json({ ok: true, service: "foreshock-api" }));

// Dependency health, for a human or judge to check deliberately — this one
// IS allowed to say unhealthy, because that is a true, different claim from
// liveness above. Do not point a host's health check at this route.
app.get("/health", async (c) => {
  const h = await provider.health();
  return c.json(h, h.ok ? 200 : 503);
});

app.get("/score/:mint", async (c) => {
  const mint = c.req.param("mint");

  if (!BASE58.test(mint)) {
    return c.json(
      {
        error: `"${mint}" is not a valid Solana mint address — expected 32-44 base58 characters (no 0, O, I or l).`,
      },
      400,
    );
  }

  let snap;
  try {
    snap = await provider.getSnapshot(mint);
  } catch (e) {
    // A real upstream failure, not a stage declaring itself unavailable —
    // those two must never look the same. See merge()/chain() in
    // provider.ts: this only throws when every provider in the chain failed.
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }

  return c.json(score(snap));
});

app.notFound((c) => c.json({ error: "Not found. Try GET /health or GET /score/:mint" }, 404));

const port = Number(process.env["PORT"] ?? 8787);
// 0.0.0.0, not the library default: a container host's health check reaches
// this on its own network interface, not loopback.
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`foreshock api listening on 0.0.0.0:${info.port}`);
});
