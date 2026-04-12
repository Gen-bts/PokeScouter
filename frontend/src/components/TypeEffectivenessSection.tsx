import { memo } from "react";
import { TypeBadge } from "./TypeBadge";
import type { TypeEffectivenessData } from "../types";

export function formatMultiplier(m: number): string {
  if (m === 0) return "x0";
  if (m === 0.25) return "x1/4";
  if (m === 0.5) return "x1/2";
  if (m === 2) return "x2";
  if (m === 4) return "x4";
  return `x${m}`;
}

export const TypeEffectivenessSection = memo(function TypeEffectivenessSection({
  typeEffectiveness,
}: {
  typeEffectiveness: TypeEffectivenessData;
}) {
  return (
    <>
      {typeEffectiveness.weak.length > 0 && (
        <div className="tooltip-section">
          <div className="tooltip-section-label">弱点</div>
          <div className="opponent-tooltip-eff-list">
            {typeEffectiveness.weak.map((e) => (
              <span key={e.type} className="opponent-tooltip-eff-item opponent-tooltip-eff-weak">
                <TypeBadge type={e.type} size="sm" />
                <span className="opponent-tooltip-eff-mult">{formatMultiplier(e.multiplier)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {typeEffectiveness.resist.length > 0 && (
        <div className="tooltip-section">
          <div className="tooltip-section-label">耐性</div>
          <div className="opponent-tooltip-eff-list">
            {typeEffectiveness.resist.map((e) => (
              <span key={e.type} className="opponent-tooltip-eff-item opponent-tooltip-eff-resist">
                <TypeBadge type={e.type} size="sm" />
                <span className="opponent-tooltip-eff-mult">{formatMultiplier(e.multiplier)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {typeEffectiveness.immune.length > 0 && (
        <div className="tooltip-section">
          <div className="tooltip-section-label">無効</div>
          <div className="opponent-tooltip-eff-list">
            {typeEffectiveness.immune.map((e) => (
              <span key={e.type} className="opponent-tooltip-eff-item opponent-tooltip-eff-immune">
                <TypeBadge type={e.type} size="sm" />
                <span className="opponent-tooltip-eff-mult">{formatMultiplier(e.multiplier)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
});
