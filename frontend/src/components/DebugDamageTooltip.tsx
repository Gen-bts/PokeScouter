import { memo, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSettingsStore } from "../stores/useSettingsStore";
import type { MoveDamageResult } from "../types";

interface DebugDamageTooltipProps {
  requestBody: Record<string, unknown> | null;
  moveResult: MoveDamageResult;
  children: React.ReactNode;
}

export const DebugDamageTooltip = memo(function DebugDamageTooltip({
  requestBody,
  moveResult,
  children,
}: DebugDamageTooltipProps) {
  const debugOverlay = useSettingsStore((s) => s.debugOverlay);
  const ref = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, placeLeft: false });

  const handleMouseEnter = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      const placeLeft = r.right + 490 > window.innerWidth;
      setPos({
        top: r.top,
        left: placeLeft ? r.left : r.right + 8,
        placeLeft,
      });
    }
    setHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => setHovered(false), []);

  if (!debugOverlay) {
    return <>{children}</>;
  }

  return (
    <span
      ref={ref}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: "help" }}
    >
      {children}
      {hovered &&
        createPortal(
          <div
            className="debug-damage-tooltip"
            style={{
              top: pos.top,
              left: pos.placeLeft ? undefined : pos.left,
              right: pos.placeLeft
                ? window.innerWidth - pos.left + 8
                : undefined,
            }}
          >
            <div className="debug-damage-tooltip__label">Request</div>
            <pre className="debug-damage-tooltip__json">
              {requestBody
                ? JSON.stringify(requestBody, null, 2)
                : "(no request body)"}
            </pre>
            <div className="debug-damage-tooltip__label">
              Response (this move)
            </div>
            <pre className="debug-damage-tooltip__json">
              {JSON.stringify(moveResult, null, 2)}
            </pre>
          </div>,
          document.body,
        )}
    </span>
  );
});
