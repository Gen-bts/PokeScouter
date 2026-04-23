import { describe, it, expect } from "vitest";
import {
  computePayoff,
  buildSingleMatchupMatrix,
  type PokemonSpec,
} from "../src/game/payoff.js";

// 現実的なステータスに近い値を直接注入 (base + 性格補正込みの実数値)
const GARCHOMP: PokemonSpec = {
  pokemon_key: "garchomp",
  stats: { hp: 183, atk: 182, def: 115, spa: 100, spd: 105, spe: 169 },
  ability_key: "roughskin",
  item_key: "lifeorb",
  move_keys: ["earthquake", "dragonclaw", "stoneedge", "firefang"],
};

const PIKACHU: PokemonSpec = {
  pokemon_key: "pikachu",
  stats: { hp: 110, atk: 85, def: 55, spa: 100, spd: 60, spe: 156 },
  ability_key: "static",
  item_key: null,
  move_keys: ["thunderbolt", "irontail", "quickattack"],
};

const BLISSEY: PokemonSpec = {
  pokemon_key: "blissey",
  stats: { hp: 362, atk: 30, def: 62, spa: 95, spd: 157, spe: 75 },
  ability_key: "naturalcure",
  item_key: null,
  move_keys: ["hyperbeam", "shadowball"],
};

describe("computePayoff", () => {
  it("同じポケモン・同じ stats 同士 → payoff ≈ 0 (速度同じ, ダメージ同じ)", () => {
    const v = computePayoff(GARCHOMP, GARCHOMP);
    expect(Math.abs(v)).toBeLessThan(0.1);
  });

  it("明確に不利 (ピカチュウ vs ガブリアス) → payoff < 0", () => {
    // Pikachu: thunderbolt は Garchomp の地面タイプで無効 (2倍じゃないし、一方Garchompの技は強力)
    const v = computePayoff(PIKACHU, GARCHOMP);
    expect(v).toBeLessThan(0);
  });

  it("明確に有利 (ガブリアス vs ピカチュウ) → payoff > 0", () => {
    const v = computePayoff(GARCHOMP, PIKACHU);
    expect(v).toBeGreaterThan(0);
  });

  it("ピカチュウ vs ガブリアス と ガブリアス vs ピカチュウ は対称 (payoff 符号反転)", () => {
    const a = computePayoff(GARCHOMP, PIKACHU);
    const b = computePayoff(PIKACHU, GARCHOMP);
    expect(a + b).toBeCloseTo(0, 0); // 精度1桁 (速度差・ダメージ計算の非線形性で完全対称ではない)
    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThan(0);
  });

  it("ペイオフは [-1, +1] の範囲", () => {
    const v = computePayoff(GARCHOMP, BLISSEY);
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("技なしポケモン → dmg=0 で速度のみの補正", () => {
    const noMove: PokemonSpec = { ...GARCHOMP, move_keys: [] };
    const v = computePayoff(noMove, noMove);
    // dmg 同じ = 0, 速度同じ = 0 → payoff = 0
    expect(Math.abs(v)).toBeLessThan(0.01);
  });

  it("速度差による補正は明示的に効く", () => {
    // 同じスペック2 匹、片方が遅い → 速い方が +0.12 有利
    const fast: PokemonSpec = {
      ...GARCHOMP,
      stats: { ...GARCHOMP.stats, spe: 200 },
    };
    const slow: PokemonSpec = {
      ...GARCHOMP,
      stats: { ...GARCHOMP.stats, spe: 100 },
    };
    const v = computePayoff(fast, slow);
    expect(v).toBeGreaterThan(0.05);
  });

  it("speedBonus オプションが効く", () => {
    const fast: PokemonSpec = {
      ...GARCHOMP,
      stats: { ...GARCHOMP.stats, spe: 200 },
    };
    const slow: PokemonSpec = {
      ...GARCHOMP,
      stats: { ...GARCHOMP.stats, spe: 100 },
    };
    const vDefault = computePayoff(fast, slow);
    const vHigh = computePayoff(fast, slow, { speedBonus: 0.3 });
    expect(vHigh).toBeGreaterThan(vDefault);
  });
});

describe("buildSingleMatchupMatrix", () => {
  it("6×6 の対面行列を生成する", () => {
    const team = [GARCHOMP, PIKACHU, BLISSEY, GARCHOMP, PIKACHU, BLISSEY];
    const matrix = buildSingleMatchupMatrix(team, team);
    expect(matrix.length).toBe(6);
    expect(matrix[0]!.length).toBe(6);
  });

  it("同じチームの対面行列は対角 = 0 近似 (同ポケモンは互角)", () => {
    const team = [GARCHOMP, PIKACHU, BLISSEY, GARCHOMP, PIKACHU, BLISSEY];
    const matrix = buildSingleMatchupMatrix(team, team);
    // 対角セル: 同じポケモン同士
    expect(Math.abs(matrix[0]![0]!)).toBeLessThan(0.1);
    expect(Math.abs(matrix[1]![1]!)).toBeLessThan(0.1);
  });

  it("行列は反対称的 (A vs B ≈ -(B vs A))", () => {
    const team = [GARCHOMP, PIKACHU, BLISSEY];
    const matrix = buildSingleMatchupMatrix(team, team);
    // matrix[i][j] + matrix[j][i] ≈ 0 (厳密には非対称だが概ね)
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const sum = matrix[i]![j]! + matrix[j]![i]!;
        expect(Math.abs(sum)).toBeLessThan(0.3);
      }
    }
  });
});
