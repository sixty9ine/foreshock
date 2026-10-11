import type { Inference } from "./api";

export function InferenceCard({ inference }: { inference: Inference }) {
  return (
    <div className="inference">
      <h3>Here's what I think based on this result</h3>
      <p className="inference-summary">{inference.summary}</p>
      {inference.similar.length > 0 ? (
        <ul className="inference-similar">
          {inference.similar.map((s, i) => (
            <li key={i}>{s.note}</li>
          ))}
        </ul>
      ) : (
        <p className="inference-empty">
          No comparable tracked tokens yet — keep scoring tokens to build up the data bank this
          compares against.
        </p>
      )}
    </div>
  );
}
