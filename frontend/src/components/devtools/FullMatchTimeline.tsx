import { useCallback, useEffect, useRef, useState } from "react";
import { useFullMatchStore } from "../../stores/useFullMatchStore";

/** シーンごとの色パレット */
const SCENE_COLORS: Record<string, string> = {
  none: "#d1d5db",
  pre_match: "#6b7280",
  team_select: "#3b82f6",
  team_confirm: "#6366f1",
  move_select: "#22c55e",
  battle: "#ef4444",
  pokemon_summary: "#f59e0b",
  battle_end: "#8b5cf6",
};
const DEFAULT_COLOR = "#9ca3af";

function getSceneColor(scene: string): string {
  const top = scene.split("/")[0] ?? scene;
  return SCENE_COLORS[top] ?? SCENE_COLORS[scene] ?? DEFAULT_COLOR;
}

const BAR_HEIGHT = 36;
const MARKER_Y = 4;
const CANVAS_HEIGHT = 48;

export function FullMatchTimeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    frame: number;
    ts: number;
    scene: string;
  } | null>(null);

  const sceneTimeline = useFullMatchStore((s) => s.sceneTimeline);
  const pokemonResults = useFullMatchStore((s) => s.pokemonResults);
  const totalFrames = useFullMatchStore((s) => s.totalFrames);
  const selectedFrameIndex = useFullMatchStore((s) => s.selectedFrameIndex);
  const selectFrame = useFullMatchStore((s) => s.selectFrame);
  const frameResults = useFullMatchStore((s) => s.frameResults);
  const sceneCounts = useFullMatchStore((s) => s.sceneCounts);
  const sceneDisplayName = useFullMatchStore((s) => s.sceneDisplayName);

  // タイムラインの各フレームがどのシーンに属するか計算
  const getSceneAtFrame = useCallback(
    (frameIndex: number): string => {
      let scene = "none";
      for (const sc of sceneTimeline) {
        if (sc.frame_index <= frameIndex) {
          scene = sc.scene;
        } else {
          break;
        }
      }
      return scene;
    },
    [sceneTimeline],
  );

  // シーン区間を構築
  const buildSegments = useCallback(() => {
    if (totalFrames === 0) return [];
    const segments: { start: number; end: number; scene: string }[] = [];

    if (sceneTimeline.length === 0) {
      segments.push({ start: 0, end: totalFrames - 1, scene: "none" });
      return segments;
    }

    // 最初のシーン遷移までの区間
    const first = sceneTimeline[0]!;
    if (first.frame_index > 0) {
      segments.push({
        start: 0,
        end: first.frame_index - 1,
        scene: "none",
      });
    }

    for (let i = 0; i < sceneTimeline.length; i++) {
      const current = sceneTimeline[i]!;
      const next = sceneTimeline[i + 1];
      const end = next ? next.frame_index - 1 : totalFrames - 1;
      segments.push({
        start: current.frame_index,
        end,
        scene: current.scene,
      });
    }

    return segments;
  }, [sceneTimeline, totalFrames]);

  // フレームインデックスからタイムスタンプを推定
  const getTimestampAtFrame = useCallback(
    (frameIndex: number): number => {
      // frameResults から最も近いフレームのタイムスタンプを探す
      const fr = frameResults.find((f) => f.frame_index === frameIndex);
      if (fr) return fr.timestamp_ms;
      // sceneTimeline から最近のものを探す
      for (let i = sceneTimeline.length - 1; i >= 0; i--) {
        const entry = sceneTimeline[i];
        if (entry && entry.frame_index <= frameIndex) {
          return entry.timestamp_ms;
        }
      }
      return 0;
    },
    [frameResults, sceneTimeline],
  );

  const pixelToFrame = useCallback(
    (px: number, canvasWidth: number): number => {
      if (totalFrames === 0) return 0;
      const frame = Math.round((px / canvasWidth) * (totalFrames - 1));
      return Math.max(0, Math.min(totalFrames - 1, frame));
    },
    [totalFrames],
  );

  // Canvas 描画
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;

    // クリア
    ctx.clearRect(0, 0, w, CANVAS_HEIGHT);

    if (totalFrames === 0) return;

    // シーン区間を描画
    const segments = buildSegments();
    for (const seg of segments) {
      const x0 = (seg.start / (totalFrames - 1 || 1)) * w;
      const x1 = ((seg.end + 1) / (totalFrames - 1 || 1)) * w;
      ctx.fillStyle = getSceneColor(seg.scene);
      ctx.fillRect(x0, MARKER_Y, x1 - x0, BAR_HEIGHT);
    }

    // ポケモン識別マーカー（ダイヤモンド）
    ctx.fillStyle = "#fbbf24";
    ctx.strokeStyle = "#92400e";
    ctx.lineWidth = 1;
    for (const pr of pokemonResults) {
      const x = (pr.frame_index / (totalFrames - 1 || 1)) * w;
      const y = MARKER_Y + BAR_HEIGHT / 2;
      const size = 5;
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 選択中フレームの縦線
    if (selectedFrameIndex !== null) {
      const x = (selectedFrameIndex / (totalFrames - 1 || 1)) * w;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // ハンドル
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, CANVAS_HEIGHT - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#374151";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [totalFrames, buildSegments, pokemonResults, selectedFrameIndex]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [draw]);

  const handlePointerEvent = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = pixelToFrame(x, rect.width);
      selectFrame(frame);
    },
    [pixelToFrame, selectFrame],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      handlePointerEvent(e);
    },
    [handlePointerEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frame = pixelToFrame(x, rect.width);
      const scene = getSceneAtFrame(frame);
      const ts = getTimestampAtFrame(frame);

      setHoverInfo({ x: e.clientX - rect.left, y: e.clientY - rect.top, frame, ts, scene });

      if (dragging) {
        selectFrame(frame);
      }
    },
    [dragging, pixelToFrame, selectFrame, getSceneAtFrame, getTimestampAtFrame],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setHoverInfo(null);
    setDragging(false);
  }, []);

  // キーボード操作
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selectedFrameIndex === null) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        selectFrame(Math.max(0, selectedFrameIndex - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        selectFrame(Math.min(totalFrames - 1, selectedFrameIndex + step));
      }
    },
    [selectedFrameIndex, totalFrames, selectFrame],
  );

  // 凡例用のユニークシーン
  const uniqueScenes = Object.keys(sceneCounts);

  return (
    <section className="panel-section">
      <h3>タイムライン</h3>
      <div
        ref={wrapperRef}
        className="timeline-wrapper"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <canvas
          ref={canvasRef}
          className="timeline-canvas"
          style={{ width: "100%", height: CANVAS_HEIGHT, cursor: "pointer" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />
        {/* ツールチップ */}
        {hoverInfo && !dragging && (
          <div
            className="timeline-tooltip"
            style={{
              left: Math.min(hoverInfo.x, (wrapperRef.current?.clientWidth ?? 300) - 160),
              top: -32,
            }}
          >
            #{hoverInfo.frame} / {(hoverInfo.ts / 1000).toFixed(1)}s / {sceneDisplayName(hoverInfo.scene)}
          </div>
        )}
      </div>

      {/* 凡例 */}
      <div className="timeline-legend">
        {uniqueScenes.map((scene) => (
          <span key={scene} className="timeline-legend-item">
            <span
              className="timeline-legend-color"
              style={{ backgroundColor: getSceneColor(scene) }}
            />
            {sceneDisplayName(scene)} ({sceneCounts[scene]})
          </span>
        ))}
        {pokemonResults.length > 0 && (
          <span className="timeline-legend-item">
            <span
              className="timeline-legend-color"
              style={{ backgroundColor: "#fbbf24", borderRadius: 0, transform: "rotate(45deg)" }}
            />
            Pokemon識別
          </span>
        )}
      </div>

      {/* 選択フレーム情報 */}
      {selectedFrameIndex !== null && (
        <div className="timeline-frame-info">
          フレーム #{selectedFrameIndex} / {(getTimestampAtFrame(selectedFrameIndex) / 1000).toFixed(1)}s / シーン: {sceneDisplayName(getSceneAtFrame(selectedFrameIndex))}
          <span className="hint-text" style={{ marginLeft: 12 }}>
            ← → で移動 (Shift+で10フレーム)
          </span>
        </div>
      )}
    </section>
  );
}
