import { useState } from "react";

import { type Report, ScoreError, scoreMint } from "./api";
import { band } from "./band";
import { Sparkline } from "./Sparkline";
import { StageCard } from "./StageCard";

const EXAMPLES = [
  { label: "WIF", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { label: "MASKIT (captured)", mint: "Cd8LqgfpwzxjtU8YwrK9BvFwtR2FvPAHVbLZrVwpump" },
];

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; report: Report };

export function App() {
  const [mint, setMint] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function run(m: string) {
    const trimmed = m.trim();
    if (!trimmed) return;
    setStatus({ kind: "loading" });
    try {
      const report = await scoreMint(trimmed);
      setStatus({ kind: "ok", report });
    } catch (e) {
      const message =
        e instanceof ScoreError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Something went wrong reaching the API.";
      setStatus({ kind: "error", message });
    }
  }

  return (
    <div className="page">
      <header>
        <h1>Foreshock</h1>
        <p className="tagline">
          An early-warning read on Solana tokens. This is the reference client — the API is the
          product.
        </p>
      </header>

      <form
        className="mint-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(mint);
        }}
      >
        <input
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder="Paste a Solana mint address"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button type="submit" disabled={status.kind === "loading"}>
          {status.kind === "loading" ? "Scoring…" : "Score"}
        </button>
      </form>

      <div className="examples">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.mint}
            className="example-chip"
            onClick={() => {
              setMint(ex.mint);
              void run(ex.mint);
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {status.kind === "loading" && (
        <p className="hint">
          Scoring live — this can take several seconds, longer if the free-tier API is waking from
          sleep (~30-60s) or a stage is still searching its lookback budget.
        </p>
      )}

      {status.kind === "error" && (
        <p className="error">
          {status.message}
          {status.message.includes("no Solana pairs") && (
            <> — DexScreener no longer lists a market for this mint; the token may be dead.</>
          )}
        </p>
      )}

      {status.kind === "ok" && <ReportView report={status.report} />}
    </div>
  );
}

function ReportView({ report: r }: { report: Report }) {
  return (
    <section className="report">
      <div className="headline">
        <div>
          <h2>{r.symbol ? `${r.symbol}` : r.mint}</h2>
          <p className="mint-addr">{r.mint}</p>
        </div>
        <div className={`composite band-${band(r.composite)}`}>
          <span className="composite-number">{r.composite}</span>
          <span className="composite-band">{band(r.composite)}</span>
        </div>
      </div>

      <div className="phase-row">
        <span className="phase-chip">{r.phase}</span>
        <span className="phase-rationale">{r.phaseRationale}</span>
      </div>
      <p className="confidence">confidence {Math.round(r.confidence * 100)}%</p>

      {r.inputs.series && r.inputs.series.length >= 2 && (
        <Sparkline series={r.inputs.series} />
      )}

      <div className="stages">
        {r.stages.map((s) => (
          <StageCard key={s.stage} stage={s} />
        ))}
      </div>

      {r.caveats.length > 0 && (
        <div className="caveats">
          <h3>Caveats</h3>
          <ul>
            {r.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="raw">
        <summary>Raw inputs scored</summary>
        <pre>{JSON.stringify(r.inputs, null, 2)}</pre>
      </details>
    </section>
  );
}
