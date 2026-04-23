/**
 * 3 匹選出ゲーム (20×20 outer, 3×3 inner).
 *
 * 両陣営 6 匹から 3 匹を選出する対戦で、
 *   - outer ゲーム: C(6,3) = 20 パターン × 両陣営 = 20×20 outer ペイオフ行列
 *   - 各 outer セル: 選出 3×3 の inner サブゲームをナッシュ求解したゲーム値
 *
 * pkdx の SwitchingGame / ScreenedSwitchingGame に対応する。
 * MVP 版では inner サブゲームは「単体対面ペイオフのみ」(交代コスト・積み技等は考慮しない)。
 */

import { solveNashFP, blendPrior, type NashOptions } from "./nash.js";

/** 6 匹から 3 匹を選ぶ組合せ (20 通り). */
export function enumerateCombinations(size: number, k: number): number[][] {
  const result: number[][] = [];
  const combo: number[] = [];
  function recurse(start: number) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < size; i++) {
      combo.push(i);
      recurse(i + 1);
      combo.pop();
    }
  }
  recurse(0);
  return result;
}

/** Inner 3×3 サブゲーム用の部分行列を抽出する. */
function extractSubMatrix(
  matrix: number[][],
  rowIdx: number[],
  colIdx: number[],
): number[][] {
  return rowIdx.map((i) => colIdx.map((j) => matrix[i]![j]!));
}

/** Outer 選出ゲーム結果. */
export interface SelectionGameResult {
  /** 選出候補 (行). 各要素は 6 体から選ばれた 3 匹のインデックス. */
  picksA: number[][];
  /** 選出候補 (列). */
  picksB: number[][];
  /** 20×20 の outer ペイオフ行列 (各セルは inner サブゲームのゲーム値) */
  outerMatrix: number[][];
  /** outer Nash の行プレイヤー混合戦略 (サイズ = picksA.length) */
  strategyA: number[];
  /** outer Nash の列プレイヤー混合戦略 (サイズ = picksB.length) */
  strategyB: number[];
  /** outer ゲーム値 (A 視点) */
  value: number;
  /** outer 反復数 */
  iterations: number;
  /** outer 収束フラグ */
  status: "converged" | "iteration_limit" | "trivial";
  /** 行戦略で argmax の選出 (推奨 pick) */
  recommendedPickA: number[];
  /** outer exploitability */
  exploitability: number;
}

/** 事前分布 (Pikalytics 使用率) を outer 戦略に合成するオプション. */
export interface SelectionOptions {
  /** 選出数 (既定 3) */
  pickSize?: number;
  /** outer Nash のオプション */
  nashOptions?: NashOptions;
  /** 事前分布の重み (0-1, 既定 0). 行プレイヤー用 */
  priorAlphaA?: number;
  /** 事前分布 (行プレイヤー, サイズ = picksA.length). 未指定時は無補正 */
  priorA?: number[];
  /** 事前分布の重み (列) */
  priorAlphaB?: number;
  /** 事前分布 (列) */
  priorB?: number[];
}

/**
 * 単体対面ペイオフ行列 (6×6) から 20×20 選出ゲームを解く.
 *
 * @param singleMatrix 6×6 単体対面ペイオフ (row=A 側, col=B 側)
 * @param options 選出数・Nash オプション・事前分布
 */
export function solveSelectionGame(
  singleMatrix: number[][],
  options: SelectionOptions = {},
): SelectionGameResult {
  const teamSize = singleMatrix.length;
  const pickSize = options.pickSize ?? 3;

  // 選出候補を列挙
  const picksA = enumerateCombinations(teamSize, pickSize);
  const picksB = enumerateCombinations(teamSize, pickSize);

  // outer マトリクス構築: 各 (picksA[i], picksB[j]) セルで inner 3×3 Nash
  const outerMatrix: number[][] = [];
  for (let i = 0; i < picksA.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < picksB.length; j++) {
      const subMatrix = extractSubMatrix(singleMatrix, picksA[i]!, picksB[j]!);
      const subResult = solveNashFP(subMatrix, {
        maxIterations: 300, // inner は反復数を抑制 (最大で 400 × 300 = 120K iter になる)
        tolerance: 1e-4,
        checkInterval: 20,
      });
      row.push(subResult.value);
    }
    outerMatrix.push(row);
  }

  // outer Nash を解く
  const outerResult = solveNashFP(outerMatrix, options.nashOptions);

  // 事前分布合成
  let finalStrategyA = outerResult.rowStrategy;
  let finalStrategyB = outerResult.colStrategy;
  if (options.priorA && options.priorAlphaA != null && options.priorAlphaA > 0) {
    finalStrategyA = blendPrior(outerResult.rowStrategy, options.priorA, options.priorAlphaA);
  }
  if (options.priorB && options.priorAlphaB != null && options.priorAlphaB > 0) {
    finalStrategyB = blendPrior(outerResult.colStrategy, options.priorB, options.priorAlphaB);
  }

  // 推奨選出 = row 戦略の argmax
  let recommendedIdx = 0;
  let bestP = finalStrategyA[0] ?? 0;
  for (let i = 1; i < finalStrategyA.length; i++) {
    if (finalStrategyA[i]! > bestP) {
      bestP = finalStrategyA[i]!;
      recommendedIdx = i;
    }
  }
  const recommendedPickA = picksA[recommendedIdx] ?? [];

  return {
    picksA,
    picksB,
    outerMatrix,
    strategyA: finalStrategyA,
    strategyB: finalStrategyB,
    value: outerResult.value,
    iterations: outerResult.iterations,
    status: outerResult.status,
    recommendedPickA,
    exploitability: outerResult.exploitability,
  };
}
