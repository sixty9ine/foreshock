import { score } from "./scorer/composite.js";
import { band } from "./scorer/thresholds.js";
import type { Report, StageResult } from "./scorer/types.js";
import { dexscreener } from "./data/dexscreener.js";
import { fixture } from "./data/fixture.js";
import { helius } from "./data/helius.js";
import { merge, type DataProvider } from "./data/provider.js";
import { usd } from "./scorer/util.js";

/**
 * Usage
 *   npm run score -- --health                 probe every provider
 *   npm run score -- <mint>                   score a live mint
 *   npm run score -- --fixture distributing   score synthetic data, no key needed
 *   npm run score -- <mint> --json            machine-readable
 */

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = argv[i + 1];
  return next !== undefined && !next.startsWith("--") ? next : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

/** Base58 excludes 0, O, I and l. A Solana pubkey is 32 bytes, which encodes
 *  to 32-44 characters. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FIXTURE_MINT = "FixtureMint1111111111111111111111111111111";

/**
 * Resolve the mint, or explain why not and stop. Never substitute a
 * placeholder for a missing or malformed address: the providers will reject
 * it several seconds later with something opaque like "WrongSize", and the
 * person reading that error has no way to see it came from a default.
 */
function resolveMint(usingFixture: boolean): string {
  if (usingFixture) return FIXTURE_MINT;

  const positional = argv.filter((a) => !a.startsWith("--"));
  const flagLike = argv.filter((a) => a.startsWith("--") && BASE58.test(a.replace(/^--+/, "")));

  if (positional.length === 0 && flagLike.length > 0) {
    die(
      `"${flagLike[0]}" looks like a mint address with "--" stuck to the front.\n` +
        `The "--" is npm's separator and needs a space after it:\n` +
        `  npm run score -- ${flagLike[0]!.replace(/^--+/, "")}`,
    );
  }
  if (positional.length === 0) {
    die(
      "No mint address given.\n" +
        "  npm run score -- <mint>              score a live token\n" +
        "  npm run score -- --fixture captured  synthetic data, no key needed\n" +
        "  npm run score -- --health            probe the providers",
    );
  }

  const mint = positional[0]!;
  if (!BASE58.test(mint)) {
    die(
      `"${mint}" is not a valid Solana mint address.\n` +
        "Expected 32-44 base58 characters (no 0, O, I or l).",
    );
  }
  return mint;
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const usingFixture = has("fixture");

function providers(): DataProvider {
  if (usingFixture) {
    const shape = flag("fixture");
    const shapes = ["captured", "distributing", "healthy"] as const;
    if (shape !== undefined && !shapes.includes(shape as (typeof shapes)[number])) {
      die(`Unknown fixture "${shape}". Expected one of: ${shapes.join(", ")}`);
    }
    return fixture((shape as (typeof shapes)[number] | undefined) ?? "captured");
  }
  const key = process.env["HELIUS_API_KEY"];
  if (!key) {
    // Say this loudly. Silently dropping the chain provider turns the
    // heaviest-weighted stage off and the output looks merely incomplete
    // rather than misconfigured.
    console.error(
      "warning: HELIUS_API_KEY is not set in this shell — no holder data, so\n" +
        "         concentration and insider flow will sit out. Market stages still work.\n" +
        "         export HELIUS_API_KEY=... to enable them.\n",
    );
    return dexscreener();
  }
  return merge(helius(key), dexscreener());
}

async function main(): Promise<void> {
  const provider = providers();

  if (has("health")) {
    const h = await provider.health();
    console.log(`${provider.name}\n${h.detail}`);
    process.exit(h.ok ? 0 : 1);
  }

  const mint = resolveMint(usingFixture);

  const snap = await provider.getSnapshot(mint);
  const report = score(snap);

  if (has("json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  render(report);
}

function render(r: Report): void {
  const head = r.symbol ? `${r.symbol} · ${r.mint}` : r.mint;
  console.log(`\n${head}`);
  console.log("─".repeat(Math.min(head.length, 72)));
  console.log(
    `composite ${r.composite}/100  (${band(r.composite)})   confidence ${(r.confidence * 100).toFixed(0)}%`,
  );
  console.log(`phase     ${r.phase} — ${r.phaseRationale}\n`);

  for (const s of r.stages) {
    console.log(stageLine(s));
    for (const e of s.evidence) {
      const w = e.weight !== undefined ? ` [${e.weight.toFixed(2)}]` : "";
      console.log(`     ${e.label}: ${e.value}${w}`);
      if (e.note) console.log(`       ${e.note}`);
    }
    console.log("");
  }

  if (r.caveats.length > 0) {
    console.log("caveats");
    for (const c of r.caveats) console.log(`  · ${c}`);
    console.log("");
  }

  const m = r.inputs.market;
  const pc = Object.entries(m.priceChange)
    .map(([k, v]) => `${k} ${v! >= 0 ? "+" : ""}${v}%`)
    .join(", ");
  console.log("inputs scored (plain copy, not re-derived)");
  console.log(`  price $${m.priceUsd.toPrecision(6)}  market cap ${usd(m.marketCapUsd)}`);
  console.log(`  liquidity ${usd(m.liquidityUsd)}  volume24h ${usd(m.volume24hUsd)}`);
  if (pc) console.log(`  price change: ${pc}`);
  if (m.pairCreatedAt !== undefined) {
    console.log(`  pair created: ${new Date(m.pairCreatedAt).toISOString()}`);
  }
  console.log(`  holder rows: ${r.inputs.holderRows}`);
}

function stageLine(s: StageResult): string {
  if (s.unavailable) return `  ${s.stage.padEnd(16)}   —   ${s.unavailable}`;
  const filled = Math.round(s.score / 5);
  const bar = "█".repeat(filled) + "·".repeat(20 - filled);
  return `  ${s.stage.padEnd(16)} ${String(s.score).padStart(3)}  ${bar}  conf ${(s.confidence * 100).toFixed(0)}%`;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
