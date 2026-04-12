import { memo } from "react";

export const ItemSprite = memo(function ItemSprite({
  identifier,
  size = 20,
  className,
}: {
  identifier: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!identifier) return null;
  return (
    <img
      src={`/item-sprites/${identifier}.png`}
      alt={identifier}
      width={size}
      height={size}
      className={className}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
});
