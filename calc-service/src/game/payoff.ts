/**
 * 単体対面ペイオフ計算.
 *
 * 2 匹のポケモン間の単純化された勝率予測を [-1, +1] のスカラー値で返す。
 * +1 = row (自軍側) がほぼ確実に勝つ、-1 = 相手が勝つ、0 = 互角。
 *
 * 計算モデル (MVP):
 *   payoff(A, B) = tanh((avg_dmg_a_per_turn - avg_dmg_b_per_turn) / 40) + speed_bonus
 *
 * - 各側の「最大火力技 1 発の平均ダメージ %」を使用
 * - 速度差で ±0.12 の補正 (A が速い = +0.12, 遅い = -0.12)
 * - tanh で [-1, +1] にクランプ
 *
 * pkdx の `ScreenedSwitchingGame` モデルの簡易版 (2 ターン DP + MC スクリーニング) の
 * 代わりに、static damage ratio + speed を使う。精度より計算速度を優先。
 */

import type { DamageRequest, StatsTable } from "../types.js";
import { SmogonDamageEngine } from "../calc/smogon-engine.js";

/** ペイオフ計算の入力ポケモン仕様. */
export interface PokemonSpec {
  pokemon_key: string;
  stats: StatsTable;
  ability_key?: string | null;
  item_key?: string | null;
  move_keys: string[]; // up to 4
  boosts?: Partial<StatsTable>;
  status?: string;
}

/** ペイオフ計算オプション. */
export interface PayoffOptions {
  /** 速度差の重み (既定 0.12) */
  speedBonus?: number;
  /** ダメージ差の tanh スケール (既定 40 ≒ 40% per turn で中立乖離 → +1 寄り) */
  damageScale?: number;
  /** フィールド状態 (天候/場). pkdx 仕様ではフィールドは個別 1v1 ごとに切り替わるが MVP では共通 */
  field?: DamageRequest["field"];
}

let sharedEngine: SmogonDamageEngine | null = null;
function getEngine(): SmogonDamageEngine {
  if (!sharedEngine) sharedEngine = new SmogonDamageEngine();
  return sharedEngine;
}

/**
 * 片方向の最大火力技の平均ダメージ % を求める.
 *
 * 各技について min_percent と max_percent の中点を取り、最大値を返す。
 * 技リストが空 or 全て status 技の場合は 0。
 */
function maxDamagePercent(attacker: PokemonSpec, defender: PokemonSpec, field?: DamageRequest["field"]): number {
  if (attacker.move_keys.length === 0) return 0;

  const req: DamageRequest = {
    attacker: {
      pokemon_key: attacker.pokemon_key,
      stats: attacker.stats,
      ability_key: attacker.ability_key,
      item_key: attacker.item_key,
      boosts: attacker.boosts,
      status: attacker.status,
    },
    defenders: [
      {
        pokemon_key: defender.pokemon_key,
        stats: defender.stats,
        ability_key: defender.ability_key,
        item_key: defender.item_key,
        boosts: defender.boosts,
        status: defender.status,
      },
    ],
    moves: attacker.move_keys.map((k) => ({ move_key: k })),
    field,
  };

  try {
    const resp = getEngine().calculateDamage(req);
    const def = resp.results[0];
    if (!def || def.moves.length === 0) return 0;

    let best = 0;
    for (const m of def.moves) {
      const mid = (m.min_percent + m.max_percent) / 2;
      if (mid > best) best = mid;
    }
    return best;
  } catch {
    return 0;
  }
}

/**
 * 2 匹の単体対面ペイオフを計算する.
 *
 * @returns payoff ∈ [-1, +1]. 行プレイヤー (A) の相対有利度.
 */
export function computePayoff(
  a: PokemonSpec,
  b: PokemonSpec,
  options: PayoffOptions = {},
): number {
  const speedBonus = options.speedBonus ?? 0.12;
  const damageScale = options.damageScale ?? 40;

  const dmgAtoB = maxDamagePercent(a, b, options.field);
  const dmgBtoA = maxDamagePercent(b, a, options.field);

  // 速度差から先手補正
  const speedDiff = a.stats.spe - b.stats.spe;
  let speedAdj = 0;
  if (speedDiff > 0) speedAdj = speedBonus;
  else if (speedDiff < 0) speedAdj = -speedBonus;

  // ダメージ差の tanh (damage % per turn)
  const raw = (dmgAtoB - dmgBtoA) / damageScale;
  const tanhValue = Math.tanh(raw);

  const payoff = tanhValue + speedAdj;
  return Math.max(-1, Math.min(1, payoff));
}

/**
 * 6×6 単体対面行列を事前計算する (対面ペイオフのキャッシュ).
 *
 * @param teamA row side (6 匹)
 * @param teamB col side (6 匹)
 * @returns 6×6 行列、各要素は teamA[i] vs teamB[j] の payoff
 */
export function buildSingleMatchupMatrix(
  teamA: PokemonSpec[],
  teamB: PokemonSpec[],
  options: PayoffOptions = {},
): number[][] {
  const matrix: number[][] = [];
  for (let i = 0; i < teamA.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < teamB.length; j++) {
      row.push(computePayoff(teamA[i]!, teamB[j]!, options));
    }
    matrix.push(row);
  }
  return matrix;
}
