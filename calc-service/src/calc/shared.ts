/**
 * 両エンジンで共有するユーティリティ関数.
 */

import { TYPE_CHART } from "@smogon/calc";

const GEN_NUM = 9;

export function capitalizeType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

/**
 * タイプ相性倍率を計算する.
 */
export function getTypeEffectiveness(
  moveType: string,
  defenderTypes: string[],
): number {
  const chart = TYPE_CHART[GEN_NUM] as Record<string, Record<string, number>> | undefined;
  if (!chart) return 1;

  const moveTypeCap = capitalizeType(moveType);
  const attackChart = chart[moveTypeCap];
  if (!attackChart) return 1;

  let effectiveness = 1;
  for (const dType of defenderTypes) {
    const dTypeCap = capitalizeType(dType);
    const mult = attackChart[dTypeCap];
    if (mult != null) {
      effectiveness *= mult;
    }
  }
  return effectiveness;
}

/**
 * 確定数の日本語表記を生成する.
 */
export function koDescription(
  minPercent: number,
  maxPercent: number,
  guaranteedKo: number,
): string {
  const pctStr = `${minPercent.toFixed(1)}% - ${maxPercent.toFixed(1)}%`;
  if (guaranteedKo <= 0) return `${pctStr} (確定数不明)`;
  if (guaranteedKo === 1) return `${pctStr} (確1)`;
  return `${pctStr} (確${guaranteedKo})`;
}

export function normalizeWeather(
  weather?: string | null,
): "Sun" | "Rain" | "Sand" | "Hail" | "Snow" | undefined {
  if (!weather) return undefined;
  const w = weather.toLowerCase();
  if (w === "sun" || w === "sunny" || w === "harsh sunshine") return "Sun";
  if (w === "rain" || w === "rainy" || w === "heavy rain") return "Rain";
  if (w === "sand" || w === "sandstorm") return "Sand";
  if (w === "hail") return "Hail";
  if (w === "snow") return "Snow";
  return undefined;
}

export function normalizeTerrain(
  terrain?: string | null,
): "Electric" | "Grassy" | "Psychic" | "Misty" | undefined {
  if (!terrain) return undefined;
  const t = terrain.toLowerCase();
  if (t === "electric") return "Electric";
  if (t === "grassy") return "Grassy";
  if (t === "psychic") return "Psychic";
  if (t === "misty") return "Misty";
  return undefined;
}
