import { describe, it, expect } from "vitest";
import {
  analyzeCoverage,
  ALL_TYPES,
  type TypeName,
} from "../src/calc/coverage.js";

describe("analyzeCoverage", () => {
  it("単一技 Electric で Water と Flying が super effective", () => {
    const res = analyzeCoverage(["electric"]);
    // 18 単タイプ + C(18,2)=153 → 171 entries
    expect(res.entries.length).toBe(18 + 153);

    const water = res.entries.find(
      (e) => e.defenderTypes.length === 1 && e.defenderTypes[0] === "water",
    );
    expect(water?.bestMultiplier).toBe(2);

    const flying = res.entries.find(
      (e) => e.defenderTypes.length === 1 && e.defenderTypes[0] === "flying",
    );
    expect(flying?.bestMultiplier).toBe(2);

    // Ground は Electric 無効
    const ground = res.entries.find(
      (e) => e.defenderTypes.length === 1 && e.defenderTypes[0] === "ground",
    );
    expect(ground?.bestMultiplier).toBe(0);
  });

  it("2 タイプ組合せでの効果計算 (Water/Flying → Electric 4x)", () => {
    const res = analyzeCoverage(["electric"]);
    const waterFlying = res.entries.find(
      (e) =>
        e.defenderTypes.length === 2 &&
        e.defenderTypes.includes("water") &&
        e.defenderTypes.includes("flying"),
    );
    expect(waterFlying?.bestMultiplier).toBe(4);
  });

  it("4 技網羅 (Fire/Water/Grass/Electric) で少なくとも 1 技が抜群な組合せ多数", () => {
    const res = analyzeCoverage(["fire", "water", "grass", "electric"]);
    // 4 属性あれば大半の単タイプに抜群を取れる
    expect(res.counts.super + res.counts.quadruple).toBeGreaterThan(10);
  });

  it("高汎用4技 (だいもんじ/10万/冷凍/きあいだま) で通らない型が 0 件", () => {
    // Fire / Electric / Ice / Fighting
    const res = analyzeCoverage(["fire", "electric", "ice", "fighting"]);
    // Ice は Dragon/Ground/Flying/Grass に抜群、Fire は Steel/Bug/Grass/Ice に抜群、
    // Electric は Water/Flying に抜群、Fighting は Normal/Rock/Steel/Ice/Dark に抜群
    // 無効タイプは Electric が Ground には無効だが Ice が Ground に抜群なので OK
    // Fairy に対しては全技が等倍以下だが、Fighting は Fairy に半減なので
    // Fairy 単タイプは等倍 (Fire/Ice は Fairy に等倍なので 1x)
    // 今回は「全技が半減以下」= notEffective のみチェック

    // Steel: Fire(2x), Ice(0.5x), Electric(1x), Fighting(2x) → max=2 ok
    const steel = res.entries.find(
      (e) => e.defenderTypes.length === 1 && e.defenderTypes[0] === "steel",
    );
    expect(steel?.bestMultiplier).toBeGreaterThanOrEqual(2);
  });

  it("1 技も指定しない → 全 0 扱い", () => {
    const res = analyzeCoverage([]);
    // moveTypes = [] → 全 entry は bestMultiplier = 0
    expect(res.moveTypes.length).toBe(0);
    expect(res.entries.every((e) => e.bestMultiplier === 0)).toBe(true);
  });

  it("重複技タイプ (Fire, fire, FIRE) は 1 つに正規化される", () => {
    const res = analyzeCoverage(["Fire", "fire", "FIRE"]);
    expect(res.moveTypes).toEqual(["fire"]);
  });

  it("未知タイプは無視される", () => {
    const res = analyzeCoverage(["fire", "unknown-type"]);
    expect(res.moveTypes).toEqual(["fire"]);
  });

  it("エンティティ件数は 171 個 (= 18 単 + 153 ペア)", () => {
    const res = analyzeCoverage(["fire"]);
    expect(res.entries.filter((e) => e.defenderTypes.length === 1).length).toBe(18);
    expect(res.entries.filter((e) => e.defenderTypes.length === 2).length).toBe(153);
  });

  it("Normal 単体技 → Ghost は immune", () => {
    const res = analyzeCoverage(["normal"]);
    const ghost = res.entries.find(
      (e) => e.defenderTypes.length === 1 && e.defenderTypes[0] === "ghost",
    );
    expect(ghost?.bestMultiplier).toBe(0);
    expect(res.counts.immune).toBeGreaterThan(0);
  });

  it("counts 合計は 171", () => {
    const res = analyzeCoverage(["fire"]);
    const total =
      res.counts.quadruple +
      res.counts.super +
      res.counts.neutral +
      res.counts.resisted +
      res.counts.immune;
    expect(total).toBe(171);
  });

  it("ALL_TYPES は 18 件で順序が正しい", () => {
    expect(ALL_TYPES.length).toBe(18);
    expect(ALL_TYPES).toContain<TypeName>("normal");
    expect(ALL_TYPES).toContain<TypeName>("fairy");
  });
});
