/**
 * Mirrors the Report shape from src/scorer/types.ts, deliberately not
 * imported from there: this dashboard is a reference client, same as any
 * wallet or launchpad calling the public API would be, and an external
 * caller only ever sees this JSON — not the server's internal types.
 */

export interface Evidence {
  label: string;
  value: string;
  weight?: number;
  note?: string;
}

export interface StageResult {
  stage: "ignition" | "concentration" | "liquidityTrap" | "insiderFlow" | "exhaustion";
  score: number;
  confidence: number;
  evidence: Evidence[];
  unavailable?: string;
}

export type Phase =
  | "quiet"
  | "igniting"
  | "captured"
  | "distributing"
  | "exhausted"
  | "unwinding"
  | "indeterminate";

export interface Candle {
  t: number;
  close: number;
  volumeUsd: number;
}

export interface Report {
  mint: string;
  symbol?: string;
  generatedAt: number;
  composite: number;
  confidence: number;
  phase: Phase;
  phaseRationale: string;
  stages: StageResult[];
  caveats: string[];
  inputs: {
    market: {
      priceUsd: number;
      marketCapUsd: number;
      liquidityUsd: number;
      volume24hUsd: number;
      priceChange: { h1?: number; h6?: number; h24?: number; d7?: number };
      pairCreatedAt?: number;
    };
    holderRows: number;
    series?: Candle[];
  };
}

export interface ApiError {
  error: string;
}

const API_BASE = (import.meta.env["VITE_API_BASE"] as string | undefined) ?? "https://foreshock-api.onrender.com";

export class ScoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ScoreError";
  }
}

export async function scoreMint(mint: string): Promise<Report> {
  const res = await fetch(`${API_BASE}/score/${mint}`);
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? String((body as ApiError).error)
      : `${res.status} ${res.statusText}`;
    throw new ScoreError(message, res.status);
  }

  return body as Report;
}
