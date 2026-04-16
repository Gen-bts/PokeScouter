import { memo, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMoveDetail } from "../hooks/useMoveDetail";
import { TypeBadge } from "./TypeBadge";

interface MoveInfoChipProps {
  moveKey: string;
  moveName: string;
  className?: string;
  children?: React.ReactNode;
}

export const MoveInfoChip = memo(function MoveInfoChip({
  moveKey,
  moveName,
  className,
  children,
}: MoveInfoChipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const { detail, loading } = useMoveDetail(hovered ? moveKey : null);

  const handleMouseEnter = useCallback(() => {
    if (ref.current) {
      const r = ref.current.getBoundingClientRect();
      setPos({ top: r.top - 6, left: r.left + r.width / 2 });
    }
    setHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => setHovered(false), []);

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children ?? moveName}
      {hovered &&
        createPortal(
          <div
            className="move-info-tooltip"
            style={{ top: pos.top, left: pos.left }}
          >
            {loading && !detail ? (
              <span className="move-info-tooltip-loading">読込中...</span>
            ) : detail ? (
              <>
                <div className="move-info-tooltip-header">
                  <span className="move-info-tooltip-name">
                    {detail.move_name_ja}
                  </span>
                  <TypeBadge type={detail.type} size="sm" />
                  <span className="move-info-tooltip-class">
                    {detail.damage_class_name_ja}
                  </span>
                </div>
                <div className="move-info-tooltip-stats">
                  {detail.power != null && (
                    <span className="move-info-tooltip-stat">
                      威力 {detail.power}
                    </span>
                  )}
                  {detail.accuracy != null && (
                    <span className="move-info-tooltip-stat">
                      命中 {detail.accuracy}
                    </span>
                  )}
                  {detail.pp != null && (
                    <span className="move-info-tooltip-stat">
                      PP {detail.pp}
                    </span>
                  )}
                  {detail.priority !== 0 && (
                    <span className="move-info-tooltip-stat">
                      優先度 {detail.priority > 0 ? "+" : ""}
                      {detail.priority}
                    </span>
                  )}
                </div>
                {detail.short_desc_ja && (
                  <div className="move-info-tooltip-desc">
                    {detail.short_desc_ja}
                  </div>
                )}
              </>
            ) : (
              <span className="move-info-tooltip-error">
                {moveName}
              </span>
            )}
            <span className="move-info-tooltip-arrow" />
          </div>,
          document.body,
        )}
    </span>
  );
});
