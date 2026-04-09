import { useCallback, useEffect, useRef, useState } from "react";
import { frameUrl } from "../../api/devtools";
import { useFullMatchStore } from "../../stores/useFullMatchStore";

const REGION_COLORS = [
  "#22d3ee", "#a78bfa", "#f472b6", "#34d399",
  "#fb923c", "#60a5fa", "#facc15", "#c084fc",
];

/** 簡易 LRU キャッシュ */
class ImageCache {
  private cache = new Map<string, HTMLImageElement>();
  private order: string[] = [];
  private maxSize: number;

  constructor(maxSize = 5) {
    this.maxSize = maxSize;
  }

  get(url: string): HTMLImageElement | undefined {
    return this.cache.get(url);
  }

  set(url: string, img: HTMLImageElement) {
    if (this.cache.has(url)) {
      this.order = this.order.filter((k) => k !== url);
    } else if (this.order.length >= this.maxSize) {
      const evict = this.order.shift()!;
      this.cache.delete(evict);
    }
    this.cache.set(url, img);
    this.order.push(url);
  }
}

const imageCache = new ImageCache(5);

export function FullMatchFrameViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const sessionId = useFullMatchStore((s) => s.sessionId);
  const selectedFrameIndex = useFullMatchStore((s) => s.selectedFrameIndex);
  const frameFilenames = useFullMatchStore((s) => s.frameFilenames);
  const ocrResults = useFullMatchStore((s) => s.ocrResults);
  const frameResults = useFullMatchStore((s) => s.frameResults);
  const sceneDisplayName = useFullMatchStore((s) => s.sceneDisplayName);

  const filename =
    selectedFrameIndex !== null ? frameFilenames[selectedFrameIndex] : null;
  const url = filename ? frameUrl(sessionId, filename) : null;
  const ocrDetail =
    selectedFrameIndex !== null ? ocrResults[selectedFrameIndex] : null;
  const frameSummary = selectedFrameIndex !== null
    ? frameResults.find((f) => f.frame_index === selectedFrameIndex)
    : null;

  // フレーム画像の読み込み（デバウンス付き）
  useEffect(() => {
    if (!url) return;

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    const cached = imageCache.get(url);
    if (cached) {
      setLoadedUrl(url);
      return;
    }

    debounceRef.current = window.setTimeout(() => {
      const img = new Image();
      img.onload = () => {
        imageCache.set(url, img);
        setLoadedUrl(url);
      };
      img.src = url;
    }, 80);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [url]);

  // Canvas 描画
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loadedUrl) return;

    const img = imageCache.get(loadedUrl);
    if (!img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.parentElement?.clientWidth ?? img.naturalWidth;
    const scale = displayW / img.naturalWidth;
    const displayH = img.naturalHeight * scale;

    canvas.width = displayW * dpr;
    canvas.height = displayH * dpr;
    canvas.style.width = `${displayW}px`;
    canvas.style.height = `${displayH}px`;
    ctx.scale(dpr, dpr);

    // フレーム画像描画
    ctx.drawImage(img, 0, 0, displayW, displayH);

    // OCR リージョンオーバーレイ
    if (ocrDetail) {
      ocrDetail.regions.forEach((region, i) => {
        const color = REGION_COLORS[i % REGION_COLORS.length] ?? "#60a5fa";
        const isHovered = hoveredRegion === region.name;
        const x = region.x * scale;
        const y = region.y * scale;
        const w = region.w * scale;
        const h = region.h * scale;

        // 矩形
        ctx.strokeStyle = color;
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.globalAlpha = isHovered ? 1.0 : 0.7;
        ctx.strokeRect(x, y, w, h);

        // 半透明背景
        ctx.fillStyle = color;
        ctx.globalAlpha = isHovered ? 0.2 : 0.08;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1.0;

        // ラベル
        ctx.font = `${Math.max(10, 12 * scale)}px monospace`;
        const label = region.name;
        const metrics = ctx.measureText(label);
        const labelH = 16 * scale;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y - labelH, metrics.width + 6 * scale, labelH);
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = "#000";
        ctx.fillText(label, x + 3 * scale, y - 4 * scale);

        // ホバー時にOCRテキスト表示
        if (isHovered) {
          const engines = Object.entries(region.engines);
          if (engines.length > 0) {
            let bestText = "";
            let bestConf = -1;
            for (const [, v] of engines) {
              if (v.confidence > bestConf) {
                bestConf = v.confidence;
                bestText = v.text;
              }
            }
            const text = bestText || "(empty)";
            ctx.font = `bold ${Math.max(12, 14 * scale)}px monospace`;
            const tm = ctx.measureText(text);
            const tx = x;
            const ty = y + h + 20 * scale;
            ctx.fillStyle = "rgba(0,0,0,0.8)";
            ctx.fillRect(tx - 2, ty - 14 * scale, tm.width + 8, 18 * scale);
            ctx.fillStyle = "#fff";
            ctx.fillText(text, tx + 2, ty);
          }
        }
      });
    }

    // フレーム情報オーバーレイ（左上）
    if (frameSummary) {
      const infoLines = [
        `#${selectedFrameIndex} | ${sceneDisplayName(frameSummary.scene_key)}`,
        `detect: ${frameSummary.detection_ms.toFixed(0)}ms | ocr: ${frameSummary.ocr_ms.toFixed(0)}ms | total: ${frameSummary.total_ms.toFixed(0)}ms`,
      ];
      ctx.font = `${Math.max(10, 11 * scale)}px monospace`;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, Math.max(...infoLines.map((l) => ctx.measureText(l).width)) + 12, infoLines.length * 16 * scale + 8);
      ctx.fillStyle = "#fff";
      infoLines.forEach((line, idx) => {
        ctx.fillText(line, 6, (idx + 1) * 16 * scale);
      });
    }
  }, [loadedUrl, ocrDetail, hoveredRegion, frameSummary, selectedFrameIndex, sceneDisplayName]);

  useEffect(() => {
    draw();
  }, [draw]);

  // マウスホバーでリージョン検出
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!ocrDetail || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const img = loadedUrl ? imageCache.get(loadedUrl) : null;
      if (!img) return;
      const scale = rect.width / img.naturalWidth;

      let found: string | null = null;
      for (const region of ocrDetail.regions) {
        const rx = region.x * scale;
        const ry = region.y * scale;
        const rw = region.w * scale;
        const rh = region.h * scale;
        if (mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh) {
          found = region.name;
          break;
        }
      }
      setHoveredRegion(found);
    },
    [ocrDetail, loadedUrl],
  );

  if (selectedFrameIndex === null) return null;

  return (
    <section className="panel-section">
      <h3>フレームビューワー</h3>
      <div className="frame-viewer">
        {url ? (
          <canvas
            ref={canvasRef}
            className="frame-viewer-canvas"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredRegion(null)}
          />
        ) : (
          <div className="frame-viewer-placeholder">
            フレーム画像が利用できません (#{selectedFrameIndex})
          </div>
        )}
      </div>
    </section>
  );
}
