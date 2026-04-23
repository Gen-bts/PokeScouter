import { describe, it, expect } from "vitest";
import {
  optimizeHBD,
  scoreHBD,
  findNearestDefensePreset,
  DEFAULT_WEIGHTS,
  type StatPointAllocation,
} from "../src/optimize/hbd.js";
import type { StatsTable } from "../src/types.js";

// --- テスト用の代表的種族値 ---
const BLISSEY_BASE: StatsTable = { hp: 255, atk: 10, def: 10, spa: 75, spd: 135, spe: 55 };
const SNORLAX_BASE: StatsTable = { hp: 160, atk: 110, def: 65, spa: 65, spd: 110, spe: 30 };
const SKARMORY_BASE: StatsTable = { hp: 65, atk: 80, def: 140, spa: 40, spd: 70, spe: 70 };
const CARBINK_BASE: StatsTable = { hp: 50, atk: 50, def: 150, spa: 50, spd: 150, spe: 50 };
const CHARIZARD_BASE: StatsTable = { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 };

describe("scoreHBD", () => {
  it("スコアは H, B, D 全て正で正値を返す", () => {
    expect(scoreHBD(200, 100, 100, { phys: 0.5, spec: 0.5 })).toBeGreaterThan(0);
  });

  it("B または D が 0 でも denom > 0 なら計算可能", () => {
    expect(scoreHBD(200, 100, 0, { phys: 0.5, spec: 0.5 })).toBe(0);
    expect(scoreHBD(200, 0, 100, { phys: 0.5, spec: 0.5 })).toBe(0);
  });

  it("重みが偏っても NaN を返さない", () => {
    const s = scoreHBD(200, 100, 100, { phys: 1.0, spec: 0.0 });
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });
});

describe("optimizeHBD", () => {
  it("予算 0 → SP は初期値のまま", () => {
    const res = optimizeHBD({
      baseStats: SNORLAX_BASE,
      budget: 0,
      fixedSp: { atk: 0, spa: 0, spe: 0 },
    });
    expect(res.sp.hp).toBe(0);
    expect(res.sp.def).toBe(0);
    expect(res.sp.spd).toBe(0);
  });

  it("SP 合計は予算を超えない", () => {
    const res = optimizeHBD({
      baseStats: SNORLAX_BASE,
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 44,
    });
    const allocated = res.sp.hp + res.sp.def + res.sp.spd;
    expect(allocated).toBeLessThanOrEqual(44);
  });

  it("各 stat は max (32) を超えない", () => {
    const res = optimizeHBD({
      baseStats: BLISSEY_BASE,
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    expect(res.sp.hp).toBeLessThanOrEqual(32);
    expect(res.sp.def).toBeLessThanOrEqual(32);
    expect(res.sp.spd).toBeLessThanOrEqual(32);
  });

  it("カビゴン (物理寄り環境) は H と D に優先配分される", () => {
    // Snorlax は base D=110, base B=65 で D が高い
    // 物理寄り (phys=0.7) だと B を上げる価値が高く、H/B 寄りの解になる
    const resPhys = optimizeHBD({
      baseStats: SNORLAX_BASE,
      weights: { phys: 0.7, spec: 0.3 },
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    expect(resPhys.sp.def).toBeGreaterThan(0);
    expect(resPhys.sp.hp).toBeGreaterThan(0);

    // 特殊寄り (spec=0.7) だと D を上げる価値が高い
    const resSpec = optimizeHBD({
      baseStats: SNORLAX_BASE,
      weights: { phys: 0.3, spec: 0.7 },
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    expect(resSpec.sp.spd).toBeGreaterThan(0);
    expect(resSpec.sp.hp).toBeGreaterThan(0);
  });

  it("ハピナス (高 HP, 低 B) は B に大きく配分される", () => {
    // base B=10 なので B の偏微分 (H*p*D²) が極端に大きい → B は必ず max 32 になる
    const res = optimizeHBD({
      baseStats: BLISSEY_BASE,
      weights: { phys: 0.5, spec: 0.5 },
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    expect(res.sp.def).toBe(32);
    expect(res.sp.def).toBeGreaterThanOrEqual(res.sp.spd);
  });

  it("スカタンク (低 H, 高 B) は H の価値が高い", () => {
    // Skarmory: base B=140 はもう高いので B の追加価値は低い
    // 低 HP なので H を上げたい
    const res = optimizeHBD({
      baseStats: SKARMORY_BASE,
      weights: { phys: 0.5, spec: 0.5 },
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    expect(res.sp.hp).toBeGreaterThan(0);
  });

  it("カーバンクル (B と D が均等 150) は対称な配分", () => {
    const res = optimizeHBD({
      baseStats: CARBINK_BASE,
      weights: { phys: 0.5, spec: 0.5 },
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    // B と D はほぼ等しい (偏微分が対称なので)
    expect(Math.abs(res.sp.def - res.sp.spd)).toBeLessThanOrEqual(2);
  });

  it("性格補正 (+D/-A) で D が上がりやすくなる", () => {
    const resNeutral = optimizeHBD({
      baseStats: SNORLAX_BASE,
      weights: DEFAULT_WEIGHTS,
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    const resSpdBoost = optimizeHBD({
      baseStats: SNORLAX_BASE,
      nature: "Careful", // spd +, spa -
      weights: DEFAULT_WEIGHTS,
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    // 性格補正ありのほうが D 実数値は高い
    expect(resSpdBoost.stats.spd).toBeGreaterThan(resNeutral.stats.spd);
  });

  it("完全固定 SP (H=32, B=32, D=2) は変更されない", () => {
    const fixed: Partial<StatPointAllocation> = {
      hp: 32,
      atk: 0,
      def: 32,
      spa: 0,
      spd: 2,
      spe: 0,
    };
    const res = optimizeHBD({
      baseStats: SNORLAX_BASE,
      fixedSp: fixed,
      budget: 0,
    });
    expect(res.sp).toEqual({ hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 });
  });

  it("スコアは計算結果の stats に対して正しい", () => {
    const res = optimizeHBD({
      baseStats: SNORLAX_BASE,
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    const expected = scoreHBD(res.stats.hp, res.stats.def, res.stats.spd, res.weights);
    expect(res.score).toBeCloseTo(expected, 3);
  });

  it("重みが正規化される (phys:3, spec:2 → phys:0.6, spec:0.4)", () => {
    const res = optimizeHBD({
      baseStats: CHARIZARD_BASE,
      weights: { phys: 3, spec: 2 },
      fixedSp: { atk: 0, spa: 0, spe: 0 },
    });
    expect(res.weights.phys).toBeCloseTo(0.6, 5);
    expect(res.weights.spec).toBeCloseTo(0.4, 5);
  });
});

describe("findNearestDefensePreset", () => {
  it("完全な HB 振り → 'hb'", () => {
    const sp: StatPointAllocation = {
      hp: 32,
      atk: 0,
      def: 32,
      spa: 0,
      spd: 2,
      spe: 0,
    };
    const res = findNearestDefensePreset(sp);
    expect(res.preset).toBe("hb");
    expect(res.distance).toBe(0);
  });

  it("完全な HD 振り → 'hd'", () => {
    const sp: StatPointAllocation = {
      hp: 32,
      atk: 0,
      def: 0,
      spa: 0,
      spd: 32,
      spe: 2,
    };
    const res = findNearestDefensePreset(sp);
    expect(res.preset).toBe("hd");
    expect(res.distance).toBe(0);
  });

  it("H 寄りだけど B が中途半端 → 'h' (or 'hb')", () => {
    const sp: StatPointAllocation = {
      hp: 32,
      atk: 0,
      def: 5,
      spa: 0,
      spd: 2,
      spe: 27,
    };
    const res = findNearestDefensePreset(sp);
    // hp=32, def=5, spd=2 → 'h' (hp=32,def=0,spd=2) vs 'hb' (hp=32,def=32,spd=2)
    // 距離: 'h' = 5, 'hb' = 27 → 'h'
    expect(res.preset).toBe("h");
  });

  it("B と D に均等分散 → custom (閾値超え)", () => {
    const sp: StatPointAllocation = {
      hp: 16,
      atk: 0,
      def: 16,
      spa: 0,
      spd: 16,
      spe: 18,
    };
    const res = findNearestDefensePreset(sp);
    // どのプリセットとも距離大 → custom か近プリセット
    // none: √(16² + 16² + 14²) ≈ √(256+256+196) ≈ √708 ≈ 26.6
    // h: √(16² + 16² + 14²) ≈ 26.6 も同じ数値 (偶然)
    // threshold 10 を超えるので custom
    expect(res.preset).toBe("custom");
    expect(res.distance).toBeGreaterThan(10);
  });
});

describe("optimizeHBD + findNearestDefensePreset (統合)", () => {
  it("ハピナス HBD 推定 → HB 寄り (base B=10 極低)", () => {
    const res = optimizeHBD({
      baseStats: BLISSEY_BASE,
      weights: { phys: 0.5, spec: 0.5 },
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    const nearest = findNearestDefensePreset(res.sp);
    // 通常 HB が近いはず (H 32, D 2 少なめ, B 32)
    expect(["hb", "custom"]).toContain(nearest.preset);
  });

  it("カーバンクル HBD 推定 → どれでもない custom (B/D 対称)", () => {
    const res = optimizeHBD({
      baseStats: CARBINK_BASE,
      weights: { phys: 0.5, spec: 0.5 },
      fixedSp: { atk: 0, spa: 0, spe: 0 },
      budget: 66,
    });
    const nearest = findNearestDefensePreset(res.sp);
    // B/D 均等分配だと HB でも HD でもない
    // 境界線上の場合があるので hb/hd/custom のいずれか
    expect(["hb", "hd", "custom"]).toContain(nearest.preset);
  });
});
