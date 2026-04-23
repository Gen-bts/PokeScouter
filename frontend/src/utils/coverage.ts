/**
 * 技範囲 (coverage) 分析 — フロントエンド版.
 *
 * calc-service/src/calc/coverage.ts と同じロジックをフロントで計算する。
 * 型チャートは src/utils/typeChart.ts を利用。
 */

import {
  ALL_TYPES,
  TYPE_CHART,
  getTypeMultiplier,
  type TypeName,
} from "./typeChart";

export { ALL_TYPES, TYPE_CHART };
export type { TypeName };

export interface CoverageEntry {
  defenderTypes: TypeName[];
  bestMultiplier: number;
  bestMoveType: TypeName | null;
}

export interface CoverageAnalysis {
  moveTypes: TypeName[];
  entries: CoverageEntry[];
  counts: {
    quadruple: number;
    super: number;
    neutral: number;
    resisted: number;
    immune: number;
  };
  notEffective: CoverageEntry[];
  immune: CoverageEntry[];
}

function findBestMultiplier(
  moveTypes: TypeName[],
  defenderTypes: TypeName[],
): { bestMultiplier: number; bestMoveType: TypeName | null } {
  let best = 0;
  let bestType: TypeName | null = null;
  for (const mt of moveTypes) {
    const m = getTypeMultiplier(mt, defenderTypes);
    if (m > best) {
      best = m;
      bestType = mt;
    }
  }
  if (bestType === null && moveTypes.length > 0) {
    best = 0;
    bestType = moveTypes[0] ?? null;
  }
  return { bestMultiplier: best, bestMoveType: bestType };
}

function enumerateTypePairs(): [TypeName, TypeName][] {
  const pairs: [TypeName, TypeName][] = [];
  for (let i = 0; i < ALL_TYPES.length; i++) {
    for (let j = i + 1; j < ALL_TYPES.length; j++) {
      pairs.push([ALL_TYPES[i]!, ALL_TYPES[j]!]);
    }
  }
  return pairs;
}

const TYPE_PAIRS = enumerateTypePairs();

export function analyzeCoverage(rawMoveTypes: string[]): CoverageAnalysis {
  const moveTypes: TypeName[] = Array.from(
    new Set(rawMoveTypes.map((t) => t.toLowerCase())),
  ).filter((t): t is TypeName => (ALL_TYPES as readonly string[]).includes(t));

  const entries: CoverageEntry[] = [];

  for (const defType of ALL_TYPES) {
    const { bestMultiplier, bestMoveType } = findBestMultiplier(moveTypes, [defType]);
    entries.push({ defenderTypes: [defType], bestMultiplier, bestMoveType });
  }

  for (const pair of TYPE_PAIRS) {
    const { bestMultiplier, bestMoveType } = findBestMultiplier(
      moveTypes,
      pair as TypeName[],
    );
    entries.push({
      defenderTypes: pair as TypeName[],
      bestMultiplier,
      bestMoveType,
    });
  }

  const counts = { quadruple: 0, super: 0, neutral: 0, resisted: 0, immune: 0 };
  const notEffective: CoverageEntry[] = [];
  const immune: CoverageEntry[] = [];

  for (const entry of entries) {
    const m = entry.bestMultiplier;
    if (m >= 4) counts.quadruple++;
    else if (m >= 2) counts.super++;
    else if (m >= 1) counts.neutral++;
    else if (m > 0) counts.resisted++;
    else counts.immune++;

    if (m === 0) immune.push(entry);
    else if (m < 1) notEffective.push(entry);
  }

  return {
    moveTypes,
    entries,
    counts,
    notEffective,
    immune,
  };
}
