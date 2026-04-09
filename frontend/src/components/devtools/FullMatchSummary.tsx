import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFullMatchStore } from "../../stores/useFullMatchStore";
import { computeStats, findBestEngine } from "../../utils/engineStats";

/** シーンカラー（Timelineと共通） */
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

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function FullMatchSummary() {
  const sparklineRef = useRef<HTMLCanvasElement>(null);

  const processedFrames = useFullMatchStore((s) => s.processedFrames);
  const skippedFrames = useFullMatchStore((s) => s.skippedFrames);
  const totalFrames = useFullMatchStore((s) => s.totalFrames);
  const totalElapsedMs = useFullMatchStore((s) => s.totalElapsedMs);
  const sceneCounts = useFullMatchStore((s) => s.sceneCounts);
  const sceneTimeline = useFullMatchStore((s) => s.sceneTimeline);
  const frameResults = useFullMatchStore((s) => s.frameResults);
  const pokemonResults = useFullMatchStore((s) => s.pokemonResults);
  const engineStats = useFullMatchStore((s) => s.engineStats);
  const sceneDisplayName = useFullMatchStore((s) => s.sceneDisplayName);

  const totalSceneTransitions = sceneTimeline.length;
  const totalPokemonIds = pokemonResults.length;
  const avgMs = processedFrames > 0 ? totalElapsedMs / processedFrames : 0;

  // シーン別統計
  const sceneStats = useMemo(() => {
    const grouped: Record<string, number[]> = {};
    for (const fr of frameResults) {
      if (!grouped[fr.scene_key]) grouped[fr.scene_key] = [];
      grouped[fr.scene_key]!.push(fr.total_ms);
    }

    return Object.entries(sceneCounts).map(([scene, count]) => {
      const times = grouped[scene] ?? [];
      const avg =
        times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
      const min = times.length > 0 ? Math.min(...times) : 0;
      const max = times.length > 0 ? Math.max(...times) : 0;
      const p50 = percentile(times, 50);
      return { scene, count, avg, min, max, p50 };
    });
  }, [sceneCounts, frameResults]);

  const maxAvg = Math.max(...sceneStats.map((s) => s.avg), 1);

  // シーン分布の合計
  const totalCount = Object.values(sceneCounts).reduce((a, b) => a + b, 0);

  // スパークライン描画
  const drawSparkline = useCallback(() => {
    const canvas = sparklineRef.current;
    if (!canvas || frameResults.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const values = frameResults.map((f) => f.total_ms);
    const maxVal = Math.max(...values, 1);
    const n = values.length;

    // 背景グリッド
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = h - (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // シーン遷移の縦破線
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.setLineDash([3, 3]);
    for (const sc of sceneTimeline) {
      // フレームインデックスを X 位置に変換
      const idx = frameResults.findIndex(
        (f) => f.frame_index >= sc.frame_index,
      );
      if (idx >= 0) {
        const x = (idx / (n - 1 || 1)) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // 処理時間ライン
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1 || 1)) * w;
      const y = h - ((values[i] ?? 0) / maxVal) * (h - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Y軸ラベル
    ctx.font = "10px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(`${Math.round(maxVal)}ms`, 2, 12);
    ctx.fillText("0ms", 2, h - 2);
  }, [frameResults, sceneTimeline]);

  useEffect(() => {
    drawSparkline();
  }, [drawSparkline]);

  // エンジン比較があるか
  const hasEngineStats = Object.keys(engineStats).length > 0;

  return (
    <section className="panel-section fullmatch-summary">
      <h3>パフォーマンスサマリー</h3>

      {/* KPI カード */}
      <div className="kpi-cards">
        <div className="kpi-card">
          <span className="kpi-value">
            {(totalElapsedMs / 1000).toFixed(1)}s
          </span>
          <span className="kpi-label">合計時間</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{processedFrames}</span>
          <span className="kpi-label">処理フレーム</span>
        </div>
        {skippedFrames > 0 && (
          <div className="kpi-card">
            <span className="kpi-value">
              {skippedFrames}
              <small style={{ fontSize: "0.6em", opacity: 0.7 }}>
                {" "}/ {totalFrames} ({((skippedFrames / totalFrames) * 100).toFixed(1)}%)
              </small>
            </span>
            <span className="kpi-label">スキップ</span>
          </div>
        )}
        <div className="kpi-card">
          <span className="kpi-value">{avgMs.toFixed(0)}ms</span>
          <span className="kpi-label">平均処理時間</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{totalSceneTransitions}</span>
          <span className="kpi-label">シーン遷移</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{totalPokemonIds}</span>
          <span className="kpi-label">ポケモン識別</span>
        </div>
      </div>

      {/* シーン分布バー */}
      {totalCount > 0 && (
        <>
          <h4>シーン分布</h4>
          <div className="scene-bar-chart">
            {Object.entries(sceneCounts).map(([scene, count]) => {
              const pct = (count / totalCount) * 100;
              return (
                <div
                  key={scene}
                  className="scene-bar-segment"
                  style={{
                    flexGrow: count,
                    backgroundColor: getSceneColor(scene),
                  }}
                  title={`${sceneDisplayName(scene)}: ${count} frames (${pct.toFixed(1)}%)`}
                >
                  {pct > 8 && (
                    <span className="scene-bar-label">
                      {sceneDisplayName(scene)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="scene-bar-legend">
            {Object.entries(sceneCounts).map(([scene, count]) => (
              <span key={scene} className="scene-bar-legend-item">
                <span
                  className="timeline-legend-color"
                  style={{ backgroundColor: getSceneColor(scene) }}
                />
                {sceneDisplayName(scene)} ({count}, {((count / totalCount) * 100).toFixed(1)}%)
              </span>
            ))}
          </div>
        </>
      )}

      {/* 処理時間スパークライン */}
      {frameResults.length > 0 && (
        <>
          <h4>処理時間推移</h4>
          <div className="sparkline-wrapper">
            <canvas
              ref={sparklineRef}
              className="sparkline-canvas"
              style={{ width: "100%", height: 100 }}
            />
          </div>
        </>
      )}

      {/* シーン別統計テーブル */}
      {sceneStats.length > 0 && (
        <>
          <h4>シーン別統計</h4>
          <table className="benchmark-table stat-table--enhanced">
            <thead>
              <tr>
                <th>シーン</th>
                <th>フレーム数</th>
                <th>平均</th>
                <th>p50</th>
                <th>min</th>
                <th>max</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sceneStats.map((s) => (
                <tr key={s.scene}>
                  <td>
                    <span
                      className="timeline-legend-color"
                      style={{ backgroundColor: getSceneColor(s.scene) }}
                    />
                    {sceneDisplayName(s.scene)}
                  </td>
                  <td>{s.count}</td>
                  <td>{s.avg.toFixed(0)}ms</td>
                  <td>{s.p50.toFixed(0)}ms</td>
                  <td>{s.min.toFixed(0)}ms</td>
                  <td>{s.max.toFixed(0)}ms</td>
                  <td style={{ width: "30%" }}>
                    <div className="inline-bar">
                      <div
                        className="inline-bar-fill"
                        style={{ width: `${(s.avg / maxAvg) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* エンジン比較サマリー */}
      {hasEngineStats && (
        <>
          <h4>エンジン比較（全フレーム集計）</h4>
          {Object.entries(engineStats).map(([regionName, acc]) => {
            const engineNames = Object.keys(acc.engines);
            const stats = engineNames.map((e) => computeStats(e, acc.engines[e]!));
            const best = findBestEngine(stats);

            return (
              <div key={regionName} className="engine-summary-block">
                <span className="engine-region-name">{regionName}</span>
                <div className="engine-comparison-grid">
                  {stats.map((s) => (
                    <div
                      key={s.engine}
                      className={`engine-card engine-card--compact ${s.engine === best ? "engine-card--best" : ""}`}
                    >
                      <div className="engine-card-header">
                        {s.engine}
                        {s.engine === best && " \u2605"}
                      </div>
                      <div className="engine-card-stats">
                        <span>一貫性: {Math.round(s.consistency * 100)}%</span>
                        <span>速度: {Math.round(s.avgSpeed)}ms</span>
                        <span>信頼度: {Math.round(s.avgConfidence * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
