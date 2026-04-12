import { memo } from "react";
import { TYPE_LABELS } from "../utils/typeLabels";

export const TypeBadge = memo(function TypeBadge({
  type,
  size = "normal",
  className,
  title,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  type: string;
  size?: "normal" | "sm";
  className?: string;
  title?: string;
  children?: React.ReactNode;
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
}) {
  const classes = ["type-badge", size === "sm" ? "type-badge-sm" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      data-type={type}
      title={title}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children ?? (TYPE_LABELS[type] ?? type)}
    </span>
  );
});
