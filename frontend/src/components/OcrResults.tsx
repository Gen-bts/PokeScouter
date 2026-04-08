import type { OcrResult } from "../types";

interface Props {
  result: OcrResult | null;
  debugCrops: boolean;
}

export function OcrResults({ result, debugCrops }: Props) {
  return (
    <section className="panel-section">
      <h2>OCR結果</h2>
      <div className="results-container">
        {!result || result.regions.length === 0 ? (
          <p className="placeholder">結果なし</p>
        ) : (
          result.regions.map((region, i) => (
            <div className="result-item" key={i}>
              <div className="result-name">{region.name}</div>
              {debugCrops && region.crop_b64 && (
                <img
                  src={`data:image/jpeg;base64,${region.crop_b64}`}
                  alt={region.name}
                  className="debug-crop-img"
                />
              )}
              <div className="result-text">{region.text || "-"}</div>
              <div className="result-confidence">
                {Math.round(region.confidence * 100)}% / {region.elapsed_ms}ms
              </div>
            </div>
          ))
        )}
      </div>
      {result && (
        <div className="timing">
          合計: {result.elapsed_ms}ms ({result.scene})
        </div>
      )}
    </section>
  );
}
