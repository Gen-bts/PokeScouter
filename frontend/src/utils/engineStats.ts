// エンジン統計の共通ユーティリティ
// BenchmarkReport / FullMatchSummary の両方で使用

export interface EngineSamples {
  texts: string[];
  confidences: number[];
  elapsed_ms_values: number[];
}

export interface RegionAccumulator {
  engines: Record<string, EngineSamples>;
  lastCrop?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EngineStats {
  engine: string;
  modeText: string;
  consistency: number;
  avgSpeed: number;
  avgConfidence: number;
  sampleCount: number;
}

export function computeStats(engine: string, samples: EngineSamples): EngineStats {
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

export function findBestEngine(stats: EngineStats[]): string {
  if (stats.length === 0) return "";
  // 一貫性が最も高く、同率なら速度が速いほうを選ぶ
  return stats.reduce((best, s) => {
    if (s.consistency > best.consistency) return s;
    if (s.consistency === best.consistency && s.avgSpeed < best.avgSpeed) return s;
    return best;
  }).engine;
}
