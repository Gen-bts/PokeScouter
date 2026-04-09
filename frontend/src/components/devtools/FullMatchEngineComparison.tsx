import { useFullMatchStore } from "../../stores/useFullMatchStore";
import { computeStats, findBestEngine } from "../../utils/engineStats";

export function FullMatchEngineComparison() {
  const selectedFrameIndex = useFullMatchStore((s) => s.selectedFrameIndex);
  const ocrResults = useFullMatchStore((s) => s.ocrResults);
  const engineStats = useFullMatchStore((s) => s.engineStats);
  const sceneDisplayName = useFullMatchStore((s) => s.sceneDisplayName);

  const ocrDetail =
    selectedFrameIndex !== null ? ocrResults[selectedFrameIndex] : null;

  if (!ocrDetail && Object.keys(engineStats).length === 0) return null;

  return (
    <section className="panel-section">
      <h3>エンジン比較</h3>

      {/* 選択フレームのリージョン別比較 */}
      {ocrDetail && (
        <div className="engine-frame-detail">
          <h4>
            フレーム #{ocrDetail.frame_index} — {sceneDisplayName(ocrDetail.scene)} ({ocrDetail.elapsed_ms.toFixed(0)}ms)
          </h4>
          {ocrDetail.regions.map((region) => {
            const engines = Object.entries(region.engines);
            const bestConf = Math.max(...engines.map(([, v]) => v.confidence));

            return (
              <div key={region.name} className="engine-region-block">
                <span className="engine-region-name">{region.name}</span>
                <div className="engine-comparison-grid">
                  {engines.map(([engineName, result]) => {
                    const isBest = result.confidence === bestConf && bestConf > 0;
                    return (
                      <div
                        key={engineName}
                        className={`engine-card ${isBest ? "engine-card--best" : ""}`}
                      >
                        <div className="engine-card-header">{engineName}</div>
                        <div className="engine-card-text" title={result.text}>
                          {result.text || "(empty)"}
                        </div>
                        <div className="engine-card-stats">
                          <span>
                            信頼度: {(result.confidence * 100).toFixed(1)}%
                          </span>
                          <span>{result.elapsed_ms.toFixed(0)}ms</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 全体集計（engineStats） */}
      {Object.keys(engineStats).length > 0 && (
        <div className="engine-aggregate">
          <h4>全フレーム集計</h4>
          {Object.entries(engineStats).map(([regionName, acc]) => {
            const engineNames = Object.keys(acc.engines);
            const stats = engineNames.map((e) =>
              computeStats(e, acc.engines[e]!),
            );
            const best = findBestEngine(stats);

            return (
              <div key={regionName} className="engine-region-block">
                <span className="engine-region-name">{regionName}</span>
                <table className="benchmark-table engine-stats-table">
                  <thead>
                    <tr>
                      <th>Engine</th>
                      <th>最頻テキスト</th>
                      <th>一貫性</th>
                      <th>平均速度</th>
                      <th>信頼度</th>
                      <th>サンプル</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s) => (
                      <tr
                        key={s.engine}
                        className={s.engine === best ? "best-engine" : ""}
                      >
                        <td>
                          {s.engine}
                          {s.engine === best && " \u2605"}
                        </td>
                        <td className="text-cell" title={s.modeText}>
                          {s.modeText || "(empty)"}
                        </td>
                        <td>{Math.round(s.consistency * 100)}%</td>
                        <td>{Math.round(s.avgSpeed)}ms</td>
                        <td>{Math.round(s.avgConfidence * 100)}%</td>
                        <td>{s.sampleCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
