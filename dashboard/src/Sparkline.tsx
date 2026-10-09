import type { Candle } from "./api";

/**
 * The one chart the cut-line kept. Price only, no axes, no legend — it is
 * here to show the shape of the move at a glance, not to replace the
 * evidence rows below it.
 */
export function Sparkline({ series }: { series: Candle[] }) {
  if (series.length < 2) return null;

  const width = 320;
  const height = 64;
  const pad = 4;

  const closes = series.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  const points = series.map((c, i) => {
    const x = pad + (i / (series.length - 1)) * (width - pad * 2);
    const y = height - pad - ((c.close - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const rising = closes[closes.length - 1]! >= closes[0]!;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="sparkline"
      role="img"
      aria-label={`Price over the last ${series.length} hourly candles`}
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={rising ? "var(--up)" : "var(--down)"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
