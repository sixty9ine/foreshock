import type { StageResult } from "./api";

const STAGE_LABEL: Record<StageResult["stage"], string> = {
  ignition: "Ignition",
  concentration: "Concentration",
  liquidityTrap: "Liquidity trap",
  insiderFlow: "Insider flow",
  exhaustion: "Exhaustion",
};

export function StageCard({ stage }: { stage: StageResult }) {
  if (stage.unavailable) {
    return (
      <div className="stage stage-unavailable">
        <div className="stage-head">
          <span className="stage-name">{STAGE_LABEL[stage.stage]}</span>
          <span className="stage-score stage-score-dash">—</span>
        </div>
        <p className="stage-unavailable-reason">{stage.unavailable}</p>
      </div>
    );
  }

  return (
    <div className="stage">
      <div className="stage-head">
        <span className="stage-name">{STAGE_LABEL[stage.stage]}</span>
        <span className="stage-score">{stage.score}</span>
        <span className="stage-conf">conf {Math.round(stage.confidence * 100)}%</span>
      </div>
      <div className="stage-bar-track">
        <div className="stage-bar-fill" style={{ width: `${stage.score}%` }} />
      </div>
      <ul className="evidence">
        {stage.evidence.map((e, i) => (
          <li key={i}>
            <span className="evidence-label">{e.label}</span>
            <span className="evidence-value">{e.value}</span>
            {e.note && <span className="evidence-note">{e.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
