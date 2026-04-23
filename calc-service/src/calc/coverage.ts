/**
 * 技範囲 (coverage) 分析.
 *
 * 複数の技タイプが与えられたとき、防御側の各タイプ/タイプペアに対する
 * 「最も効果抜群な 1 技」の倍率を計算し、不通過タイプ (半減以下しか当たらない)
 * のリストを返す。
 *
 * pkdx の `coverage` コマンド相当。PokeScouter では OpponentPanel の
 * 既知技からも呼び出し可能にする。
 */

import { getTypeEffectiveness } from "./shared.js";

/** 18 タイプ (Gen 9). */
export const ALL_TYPES = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

export type TypeName = (typeof ALL_TYPES)[number];

export interface CoverageEntry {
  /** 防御側タイプ (単一または 2 タイプ) */
  defenderTypes: TypeName[];
  /** 与えられた技の中で最も効果抜群な倍率 */
  bestMultiplier: number;
  /** どの技が最適かのタイプ */
  bestMoveType: TypeName | null;
}

export interface CoverageAnalysis {
  /** 入力技タイプ (重複除去済み). */
  moveTypes: TypeName[];
  /** 単一タイプ 18 個 + 2 タイプ組合せ C(18,2)=153 → 合計 171 の評価 */
  entries: CoverageEntry[];
  /** 倍率別のカウント. */
  counts: {
    quadruple: number; // 4x
    super: number;     // 2x - 3.99x (≥2 かつ <4)
    neutral: number;   // 1x
    resisted: number;  // 0.25x - 0.99x (<1 で >0)
    immune: number;    // 0x
  };
  /** 半減以下 (<1) しか当たらない防御タイプ組合せ. */
  notEffective: CoverageEntry[];
  /** 完全無効 (0x) な防御タイプ組合せ. */
  immune: CoverageEntry[];
}

/** 2 タイプ組合せ (順不同) を列挙する. */
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

/**
 * 技タイプの集合に対する coverage を分析する.
 *
 * @param rawMoveTypes 技タイプ配列 (大文字小文字/重複は正規化される)
 * @returns 各防御タイプ組合せへの最高倍率 + 統計
 */
export function analyzeCoverage(rawMoveTypes: string[]): CoverageAnalysis {
  // 小文字化 + 重複除去 + 未知タイプ除外
  const moveTypes: TypeName[] = Array.from(
    new Set(rawMoveTypes.map((t) => t.toLowerCase())),
  ).filter((t): t is TypeName => (ALL_TYPES as readonly string[]).includes(t));

  const entries: CoverageEntry[] = [];

  // 単一タイプ 18 個
  for (const defType of ALL_TYPES) {
    const { bestMultiplier, bestMoveType } = findBestMultiplier(moveTypes, [defType]);
    entries.push({
      defenderTypes: [defType],
      bestMultiplier,
      bestMoveType,
    });
  }

  // 2 タイプ組合せ
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

  // 統計
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

function findBestMultiplier(
  moveTypes: TypeName[],
  defenderTypes: TypeName[],
): { bestMultiplier: number; bestMoveType: TypeName | null } {
  let best = 0;
  let bestType: TypeName | null = null;
  for (const mt of moveTypes) {
    const m = getTypeEffectiveness(mt, defenderTypes);
    if (m > best) {
      best = m;
      bestType = mt;
    }
  }
  if (bestType === null && moveTypes.length > 0) {
    // 全技が 0 の場合 (完全免疫) → 代表として最初の技タイプを返す
    best = 0;
    bestType = moveTypes[0] ?? null;
  }
  return { bestMultiplier: best, bestMoveType: bestType };
}
