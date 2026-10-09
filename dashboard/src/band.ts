// Mirrors BANDS in src/scorer/thresholds.ts — presentation only, same reason
// api.ts doesn't import the server's types: this reads the API like any
// other caller would.
const BANDS = [
  { max: 25, label: "low" },
  { max: 50, label: "elevated" },
  { max: 72, label: "high" },
  { max: 100, label: "severe" },
] as const;

export function band(score: number): string {
  return BANDS.find((b) => score <= b.max)?.label ?? "unknown";
}
