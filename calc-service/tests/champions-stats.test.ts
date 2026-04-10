import { describe, it, expect } from "vitest";
import {
  calcChampionsHP,
  calcChampionsStat,
  calcAllStats,
  getNatureModifiers,
} from "../src/calc/champions-stats.js";

describe("Champions ステータス計算", () => {
  describe("calcChampionsHP", () => {
    it("Charizard (base 78) stat_points=0 → 153", () => {
      // floor((2*78 + 31) * 50/100 + 50 + 10) + 0
      // = floor(187 * 0.5 + 60) = floor(93.5 + 60) = floor(153.5) = 153
      expect(calcChampionsHP(78, 0)).toBe(153);
    });

    it("Charizard (base 78) stat_points=32 → 185", () => {
      expect(calcChampionsHP(78, 32)).toBe(153 + 32);
    });

    it("Dragonite (base 91) stat_points=0 → 166", () => {
      // floor((2*91 + 31) * 50/100 + 50 + 10) + 0
      // = floor(213 * 0.5 + 60) = floor(106.5 + 60) = floor(166.5) = 166
      expect(calcChampionsHP(91, 0)).toBe(166);
    });

    it("Blissey (base 255) stat_points=32 → 362", () => {
      // floor((2*255 + 31) * 50/100 + 50 + 10) + 32
      // = floor(541 * 0.5 + 60) + 32 = floor(270.5 + 60) + 32 = 330 + 32 = 362
      expect(calcChampionsHP(255, 32)).toBe(362);
    });

    it("Shedinja (base 1) → 常に 1", () => {
      expect(calcChampionsHP(1, 0)).toBe(1);
      expect(calcChampionsHP(1, 32)).toBe(1);
    });
  });

  describe("calcChampionsStat", () => {
    it("Charizard SpA (base 109) stat_points=0, neutral → 129", () => {
      // floor((2*109 + 31) * 50/100 + 5) + 0
      // = floor(249 * 0.5 + 5) = floor(124.5 + 5) = floor(129.5) = 129
      expect(calcChampionsStat(109, 0, 1.0)).toBe(129);
    });

    it("Charizard SpA (base 109) stat_points=32, neutral → 161", () => {
      expect(calcChampionsStat(109, 32, 1.0)).toBe(129 + 32);
    });

    it("性格補正 ×1.1 が正しく適用される", () => {
      // 129 * 1.1 = 141.9 → floor = 141
      expect(calcChampionsStat(109, 0, 1.1)).toBe(141);
    });

    it("性格補正 ×0.9 が正しく適用される", () => {
      // 129 * 0.9 = 116.1 → floor = 116
      expect(calcChampionsStat(109, 0, 0.9)).toBe(116);
    });

    it("stat_points + 性格補正の組み合わせ", () => {
      // (129 + 32) * 1.1 = 161 * 1.1 = 177.1 → floor = 177
      expect(calcChampionsStat(109, 32, 1.1)).toBe(177);
    });
  });

  describe("getNatureModifiers", () => {
    it("Adamant → atk +, spa -", () => {
      const mods = getNatureModifiers("Adamant");
      expect(mods.atk).toBe(1.1);
      expect(mods.spa).toBe(0.9);
      expect(mods.def).toBe(1);
      expect(mods.spd).toBe(1);
      expect(mods.spe).toBe(1);
    });

    it("Timid → spe +, atk -", () => {
      const mods = getNatureModifiers("Timid");
      expect(mods.spe).toBe(1.1);
      expect(mods.atk).toBe(0.9);
    });

    it("null/undefined → 全て 1.0", () => {
      const mods = getNatureModifiers(null);
      expect(mods.atk).toBe(1);
      expect(mods.spa).toBe(1);
    });
  });

  describe("calcAllStats", () => {
    it("Charizard 全ステータス計算", () => {
      const baseStats = { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 };
      const statPoints = { hp: 0, atk: 0, def: 0, spa: 32, spd: 2, spe: 32 };
      const stats = calcAllStats(baseStats, statPoints, "Modest");

      // HP: floor((2*78+31)*50/100+50+10)+0 = 153
      expect(stats.hp).toBe(153);
      // SpA: (floor((2*109+31)*50/100+5)+32)*1.1 = 161*1.1 = 177.1 → 177
      expect(stats.spa).toBe(177);
      // Atk: (floor((2*84+31)*50/100+5)+0)*0.9 = 104*0.9 = 93.6 → 93
      expect(stats.atk).toBe(93);
      // Spe: floor((2*100+31)*50/100+5)+32 = 120+32 = 152
      expect(stats.spe).toBe(152);
    });
  });
});
