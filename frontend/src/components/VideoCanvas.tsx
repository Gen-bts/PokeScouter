import { useEffect, useRef } from "react";
import type { OcrResult } from "../types";

const COLORS = [
  "rgba(255, 107, 107, 0.7)",
  "rgba(78, 205, 196, 0.7)",
  "rgba(255, 230, 109, 0.7)",
  "rgba(162, 155, 254, 0.7)",
  "rgba(255, 159, 67, 0.7)",
  "rgba(46, 213, 115, 0.7)",
  "rgba(116, 185, 255, 0.7)",
  "rgba(223, 128, 255, 0.7)",
];

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  lastResult: OcrResult | null;
  debugOverlay: boolean;
}

export function VideoCanvas({ videoRef, canvasRef, lastResult, debugOverlay }: Props) {
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    if (!debugOverlay || !lastResult || !canvasRef.current) {
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      return;
    }

    const baseCanvas = canvasRef.current;
    overlay.width = baseCanvas.width;
    overlay.height = baseCanvas.height;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const refW = lastResult.resolution?.width ?? 1920;
    const refH = lastResult.resolution?.height ?? 1080;
    const scaleX = overlay.width / refW;
    const scaleY = overlay.height / refH;

    for (let i = 0; i < lastResult.regions.length; i++) {
      const region = lastResult.regions[i];
      const color = COLORS[i % COLORS.length];

      const rx = region.x * scaleX;
      const ry = region.y * scaleY;
      const rw = region.w * scaleX;
      const rh = region.h * scaleY;

      // 半透明の塗り
      ctx.fillStyle = color.replace("0.7", "0.15");
      ctx.fillRect(rx, ry, rw, rh);

      // 枠線
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);

      // リージョン名（矩形上部）
      ctx.font = `bold ${Math.max(12, 14 * scaleY)}px sans-serif`;
      ctx.fillStyle = color;
      const label = region.name;
      const labelY = ry - 4;
      if (labelY > 14) {
        ctx.fillText(label, rx + 2, labelY);
      } else {
        ctx.fillText(label, rx + 2, ry + 14 * scaleY);
      }

      // OCRテキスト（矩形内）
      if (region.text) {
        ctx.font = `bold ${Math.max(11, 13 * scaleY)}px monospace`;
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 3;
        const textY = ry + rh / 2 + 5 * scaleY;
        ctx.strokeText(region.text, rx + 4, textY);
        ctx.fillText(region.text, rx + 4, textY);
      }
    }
  }, [lastResult, debugOverlay, canvasRef]);

  return (
    <main className="video-area">
      <video ref={videoRef} autoPlay playsInline />
      <canvas ref={canvasRef} />
      <canvas ref={overlayRef} className="debug-overlay" />
    </main>
  );
}
