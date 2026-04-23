/**
 * HBD 耐久指数最適化 (Champions SP 適合版).
 *
 * pkdx bulk_theory.md の貪欲勾配法を Champions SP (0-32 per stat, total 66) に適合させた純関数。
 *
 * 目的関数: f = H * B * D / (s * B + p * D)
 *   - p: 物理脅威の重み (1 に近いほど B 寄りに配分)
 *   - s: 特殊脅威の重み (1 に近いほど D 寄りに配分)
 *   - p + s = 1 に正規化
 *
 * 偏微分:
 *   ∂f/∂H = B*D / (sB + pD)
 *   ∂f/∂B = H * p * D² / (sB + pD)²
 *   ∂f/∂D = H * s * B² / (sB + pD)²
 *
 * 11n 最適化は「+1 SP で実数値が +2 になる境界」で自然に勾配が膨らむため、
 * 明示フラグ不要で自動的に取れる (pkdx 仕様通り).
 */

import {
  calcChampionsHP,
  calcChampionsStat,
  getNatureModifiers,
  type NatureModifiers,
} from "../calc/champions-stats.js";
import type { StatsTable } from "../types.js";

/** SP 配分 (Champions: 各 0-32、合計 ≤ 66). */
export type StatPointAllocation = {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
};

export type StatKey = keyof StatPointAllocation;

/** 物理/特殊脅威の重み (合計 1). */
export interface ThreatWeights {
  phys: number;
  spec: number;
}

/** HBD 最適化の入力. */
export interface HBDInput {
  /** 種族値. */
  baseStats: StatsTable;
  /** 性格名 (smogon 英語名). null/undefined で無補正. */
  nature?: string | null;
  /** 物理/特殊脅威の重み. 省略時は [0.55, 0.45] (Champions メタの仮デフォルト). */
  weights?: ThreatWeights;
  /** 固定 SP (H/B/D 以外、または特定値に固定したい場合). undefined の stat が最適化対象. */
  fixedSp?: Partial<StatPointAllocation>;
  /** H/B/D に割り振る SP 予算. 省略時は 66 - sum(fixedSp). */
  budget?: number;
  /** stat ごとの最大値 (既定 32). */
  maxPerStat?: number;
  /** HP に課す剰余制約. null/undefined で制約なし. */
  hpConstraint?: "leftovers" | "sitrus" | "residual" | null;
}

/** HBD 最適化の結果. */
export interface HBDResult {
  /** 完全な SP 配分. */
  sp: StatPointAllocation;
  /** 実数値. */
  stats: StatsTable;
  /** HBD スコア. */
  score: number;
  /** HP 制約達成可否. */
  hpConstraintSatisfied: boolean;
  /** 使用した重み (正規化済み). */
  weights: ThreatWeights;
}

const CHAMPIONS_MAX_PER_STAT = 32;
const CHAMPIONS_TOTAL_BUDGET = 66;

/** 既定脅威重み. meta_threat_mix が無い場合のフォールバック. */
export const DEFAULT_WEIGHTS: ThreatWeights = { phys: 0.55, spec: 0.45 };

/** HBD スコアを計算する (f = H*B*D / (s*B + p*D)). */
export function scoreHBD(
  H: number,
  B: number,
  D: number,
  weights: ThreatWeights,
): number {
  const denom = weights.spec * B + weights.phys * D;
  if (denom <= 0) return 0;
  return (H * B * D) / denom;
}

/** 重みを合計 1 に正規化する. */
function normalizeWeights(w: ThreatWeights): ThreatWeights {
  const total = w.phys + w.spec;
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return { phys: w.phys / total, spec: w.spec / total };
}

/** HP 制約を満たすか判定. */
function checkHpConstraint(
  hp: number,
  constraint?: "leftovers" | "sitrus" | "residual" | null,
): boolean {
  if (!constraint) return true;
  switch (constraint) {
    case "leftovers":
      return hp % 16 === 1;
    case "residual":
      return hp % 16 === 15;
    case "sitrus":
      return hp % 2 === 0;
    default:
      return true;
  }
}

/**
 * HBD 最適化を実行する (離散貪欲勾配法).
 *
 * 各ステップで (H, B, D) のうちまだ余地のあるステータスに +1 SP したときのスコア増加量を比較し、
 * 最大増加のステータスに 1pt 投入する。予算ゼロ or 全ステータス飽和で終了。
 */
export function optimizeHBD(input: HBDInput): HBDResult {
  const weights = normalizeWeights(input.weights ?? DEFAULT_WEIGHTS);
  const maxPerStat = input.maxPerStat ?? CHAMPIONS_MAX_PER_STAT;
  const natureMods = getNatureModifiers(input.nature);

  const sp: StatPointAllocation = {
    hp: input.fixedSp?.hp ?? 0,
    atk: input.fixedSp?.atk ?? 0,
    def: input.fixedSp?.def ?? 0,
    spa: input.fixedSp?.spa ?? 0,
    spd: input.fixedSp?.spd ?? 0,
    spe: input.fixedSp?.spe ?? 0,
  };

  const fixedSum =
    (input.fixedSp?.atk ?? 0) + (input.fixedSp?.spa ?? 0) + (input.fixedSp?.spe ?? 0);
  const defaultBudget = Math.max(0, CHAMPIONS_TOTAL_BUDGET - fixedSum);
  let remaining = input.budget ?? defaultBudget;

  const targetStats: StatKey[] = ["hp", "def", "spd"];
  const unfixed = targetStats.filter((k) => input.fixedSp?.[k] === undefined);

  while (remaining > 0) {
    const currH = calcChampionsHP(input.baseStats.hp, sp.hp);
    const currB = calcChampionsStat(input.baseStats.def, sp.def, natureMods.def);
    const currD = calcChampionsStat(input.baseStats.spd, sp.spd, natureMods.spd);
    const currScore = scoreHBD(currH, currB, currD, weights);

    let bestStat: StatKey | null = null;
    let bestDelta = 0;

    for (const stat of unfixed) {
      if (sp[stat] >= maxPerStat) continue;

      let testH = currH;
      let testB = currB;
      let testD = currD;
      if (stat === "hp") {
        testH = calcChampionsHP(input.baseStats.hp, sp.hp + 1);
      } else if (stat === "def") {
        testB = calcChampionsStat(input.baseStats.def, sp.def + 1, natureMods.def);
      } else if (stat === "spd") {
        testD = calcChampionsStat(input.baseStats.spd, sp.spd + 1, natureMods.spd);
      }

      const testScore = scoreHBD(testH, testB, testD, weights);
      const delta = testScore - currScore;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestStat = stat;
      }
    }

    if (bestStat === null) break; // 全勾配が非正 → 収束
    sp[bestStat]++;
    remaining--;
  }

  // HP 制約を満たせるなら微調整 (budget に余裕があれば 1pt 足して HP を調整する)
  // 単純化: 制約違反でも SP 配分は固定、フラグのみ返す
  const stats: StatsTable = {
    hp: calcChampionsHP(input.baseStats.hp, sp.hp),
    atk: calcChampionsStat(input.baseStats.atk, sp.atk, natureMods.atk),
    def: calcChampionsStat(input.baseStats.def, sp.def, natureMods.def),
    spa: calcChampionsStat(input.baseStats.spa, sp.spa, natureMods.spa),
    spd: calcChampionsStat(input.baseStats.spd, sp.spd, natureMods.spd),
    spe: calcChampionsStat(input.baseStats.spe, sp.spe, natureMods.spe),
  };

  return {
    sp,
    stats,
    score: scoreHBD(stats.hp, stats.def, stats.spd, weights),
    hpConstraintSatisfied: checkHpConstraint(stats.hp, input.hpConstraint),
    weights,
  };
}

/** プリセット SP 定義 (backend/app/damage/stat_estimator.py と同一). */
const DEFENSE_PRESETS: Record<string, StatPointAllocation> = {
  none: { hp: 0, atk: 32, def: 0, spa: 0, spd: 2, spe: 32 },
  h: { hp: 32, atk: 0, def: 0, spa: 0, spd: 2, spe: 32 },
  hb: { hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 },
  hd: { hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 2 },
};

/** 最適化結果が既存 4 プリセット (none/h/hb/hd) のどれに最も近いかを返す. */
export function findNearestDefensePreset(sp: StatPointAllocation): {
  preset: "none" | "h" | "hb" | "hd" | "custom";
  distance: number;
} {
  let best: { preset: "none" | "h" | "hb" | "hd"; distance: number } = {
    preset: "none",
    distance: Infinity,
  };

  for (const [key, presetSp] of Object.entries(DEFENSE_PRESETS)) {
    const d = Math.sqrt(
      (sp.hp - presetSp.hp) ** 2 +
        (sp.def - presetSp.def) ** 2 +
        (sp.spd - presetSp.spd) ** 2,
    );
    if (d < best.distance) {
      best = { preset: key as "none" | "h" | "hb" | "hd", distance: d };
    }
  }

  // 距離が大きすぎる場合は custom 扱い
  // しきい値: HBD の Euclidean 距離が 10 超は「どのプリセットでもない」
  if (best.distance > 10) {
    return { preset: "custom", distance: best.distance };
  }
  return best;
}

// 内部型を再エクスポート
export type { NatureModifiers };
