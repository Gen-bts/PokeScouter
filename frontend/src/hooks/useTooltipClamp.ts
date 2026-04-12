import { useLayoutEffect, useRef, useState } from "react";

/**
 * ツールチップをビューポート内にクランプするフック。
 * anchorMidY: トリガー要素の垂直中心（px）
 * visible: ツールチップが表示中か
 * padding: ビューポート端からの余白（px）
 */
export function useTooltipClamp(
  anchorMidY: number | null,
  visible: boolean,
  padding = 8,
) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [clampedTop, setClampedTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!visible || anchorMidY == null || !el) {
      setClampedTop(null);
      return;
    }

    const h = el.offsetHeight;
    const idealTop = anchorMidY - h / 2;
    const maxTop = window.innerHeight - h - padding;
    const finalTop = Math.max(padding, Math.min(idealTop, maxTop));

    // 矢印位置: アンカー中心がツールチップ内のどこに来るか（%）
    const arrowPx = anchorMidY - finalTop;
    const arrowPct = Math.max(10, Math.min(90, (arrowPx / h) * 100));
    el.style.setProperty("--arrow-top", `${arrowPct}%`);

    setClampedTop(finalTop);
  }, [visible, anchorMidY, padding]);

  return { tooltipRef, clampedTop };
}
