import { useCallback, useEffect, useState } from "react";
import { useBenchmarkStore, type EngineSamples } from "../stores/useBenchmarkStore";
import { getRegions, upsertRegion } from "../api/devtools";

interface EngineStats {
  engine: string;
  modeText: string;
  consistency: number;
  avgSpeed: number;
  avgConfidence: number;
  sampleCount: number;
}

function computeStats(engine: string, samples: EngineSamples): EngineStats {
  const n = samples.texts.length;
  if (n === 0) {
    return { engine, modeText: "", consistency: 0, avgSpeed: 0, avgConfidence: 0, sampleCount: 0 };
  }

  // 最頻テキスト
  const freq = new Map<string, number>();
  for (const t of samples.texts) {
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  let modeText = "";
  let maxCount = 0;
  for (const [text, count] of freq) {
    if (count > maxCount) {
      maxCount = count;
      modeText = text;
    }
  }

  const consistency = maxCount / n;
  const avgSpeed =
    samples.elapsed_ms_values.reduce((a, b) => a + b, 0) / n;
  const avgConfidence =
    samples.confidences.reduce((a, b) => a + b, 0) / n;

  return { engine, modeText, consistency, avgSpeed, avgConfidence, sampleCount: n };
}

function findBestEngine(stats: EngineStats[]): string {
  if (stats.length === 0) return "";
  // 一貫性が最も高く、同率なら速度が速いほうを選ぶ
  return stats.reduce((best, s) => {
    if (s.consistency > best.consistency) return s;
    if (s.consistency === best.consistency && s.avgSpeed < best.avgSpeed) return s;
    return best;
  }).engine;
}

export function BenchmarkReport() {
  const frameCount = useBenchmarkStore((s) => s.frameCount);
  const regionData = useBenchmarkStore((s) => s.regionData);
  const scene = useBenchmarkStore((s) => s.scene);
  const reset = useBenchmarkStore((s) => s.reset);

  // 現在のエンジン割り当て（regions.json から取得）
  const [currentEngines, setCurrentEngines] = useState<Record<string, string>>({});
  // ユーザーの選択
  const [selectedEngines, setSelectedEngines] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    getRegions().then((config) => {
      const sceneConfig = config.scenes[scene];
      if (!sceneConfig) return;
      const engines: Record<string, string> = {};
      for (const [name, def] of Object.entries(sceneConfig.regions)) {
        engines[name] = def.engine;
      }
      setCurrentEngines(engines);
      setSelectedEngines(engines);
    });
  }, [scene]);

  const handleSelect = useCallback((regionName: string, engine: string) => {
    setSelectedEngines((prev) => ({ ...prev, [regionName]: engine }));
    setApplied(false);
  }, []);

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      for (const [name, engine] of Object.entries(selectedEngines)) {
        if (engine !== currentEngines[name]) {
          const data = regionData[name];
          if (data) {
            await upsertRegion(scene, name, {
              x: data.x,
              y: data.y,
              w: data.w,
              h: data.h,
              engine,
            });
          }
        }
      }
      setCurrentEngines({ ...selectedEngines });
      setApplied(true);
    } finally {
      setApplying(false);
    }
  }, [selectedEngines, currentEngines, regionData, scene]);

  const hasChanges = Object.entries(selectedEngines).some(
    ([name, engine]) => engine !== currentEngines[name],
  );

  if (frameCount === 0) return null;

  const regionNames = Object.keys(regionData);

  return (
    <section className="panel-section benchmark-report">
      <div className="benchmark-header">
        <h2>ベンチマークレポート ({frameCount} frames)</h2>
        <button className="btn-small" onClick={reset}>
          クリア
        </button>
      </div>

      {regionNames.map((regionName) => {
        const acc = regionData[regionName];
        const engineNames = Object.keys(acc.engines);
        const stats = engineNames.map((e) => computeStats(e, acc.engines[e]));
        const bestEngine = findBestEngine(stats);

        return (
          <div key={regionName} className="benchmark-region-card">
            <h3>{regionName}</h3>
            {acc.lastCrop && (
              <img
                src={`data:image/jpeg;base64,${acc.lastCrop}`}
                alt={regionName}
                className="debug-crop-img"
              />
            )}
            <table className="benchmark-table">
              <thead>
                <tr>
                  <th>Engine</th>
                  <th>Text (最頻)</th>
                  <th>一貫性</th>
                  <th>平均速度</th>
                  <th>Confidence</th>
                  <th>選択</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={s.engine}
                    className={s.engine === bestEngine ? "best-engine" : ""}
                  >
                    <td>
                      {s.engine}
                      {s.engine === bestEngine && " \u2605"}
                    </td>
                    <td className="text-cell" title={s.modeText}>
                      {s.modeText || "(empty)"}
                    </td>
                    <td>{Math.round(s.consistency * 100)}%</td>
                    <td>{Math.round(s.avgSpeed)}ms</td>
                    <td>{Math.round(s.avgConfidence * 100)}%</td>
                    <td>
                      <input
                        type="radio"
                        name={`engine-${regionName}`}
                        checked={selectedEngines[regionName] === s.engine}
                        onChange={() => handleSelect(regionName, s.engine)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="benchmark-actions">
        <button
          disabled={!hasChanges || applying}
          onClick={handleApply}
        >
          {applying ? "適用中..." : "変更を適用"}
        </button>
        {applied && <span className="applied-msg">適用完了</span>}
      </div>
    </section>
  );
}
