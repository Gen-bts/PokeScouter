import { describe, it, expect } from "vitest";
import { calculateDamage } from "../src/calc/damage-calc.js";
import type { DamageRequest } from "../src/types.js";

describe("ダメージ計算", () => {
  it("基本的なダメージ計算が正しく動作する", () => {
    const req: DamageRequest = {
      attacker: {
        pokemon_key: "charizard",
        stats: { hp: 153, atk: 104, def: 98, spa: 161, spd: 105, spe: 152 },
        ability_key: "blaze",
      },
      defenders: [
        {
          pokemon_key: "dragonite",
          stats: { hp: 197, atk: 186, def: 115, spa: 120, spd: 120, spe: 100 },
          ability_key: "multiscale",
        },
      ],
      moves: [{ move_key: "flamethrower" }],
    };

    const result = calculateDamage(req);

    expect(result.results).toHaveLength(1);
    const defResult = result.results[0];
    expect(defResult.defender_pokemon_key).toBe("dragonite");
    expect(defResult.moves).toHaveLength(1);

    const moveResult = defResult.moves[0];
    expect(moveResult.move_key).toBe("flamethrower");
    expect(moveResult.damage.min).toBeGreaterThan(0);
    expect(moveResult.damage.max).toBeGreaterThanOrEqual(moveResult.damage.min);
    // Fire vs Dragon/Flying = 0.5
    expect(moveResult.type_effectiveness).toBe(0.5);
  });

  it("複数の技 × 複数の防御側を一括計算できる", () => {
    const req: DamageRequest = {
      attacker: {
        pokemon_key: "charizard",
        stats: { hp: 153, atk: 104, def: 98, spa: 161, spd: 105, spe: 152 },
        ability_key: "blaze",
      },
      defenders: [
        {
          pokemon_key: "dragonite",
          stats: { hp: 197, atk: 186, def: 115, spa: 120, spd: 120, spe: 100 },
          ability_key: "multiscale",
        },
        {
          pokemon_key: "tyranitar",
          stats: { hp: 207, atk: 186, def: 130, spa: 115, spd: 120, spe: 81 },
          ability_key: "sandstream",
        },
      ],
      moves: [{ move_key: "flamethrower" }, { move_key: "icebeam" }],
    };

    const result = calculateDamage(req);
    expect(result.results).toHaveLength(2);

    for (const defResult of result.results) {
      expect(defResult.moves).toHaveLength(2);
    }

    // Ice Beam vs Dragonite (Dragon/Flying) = 4x
    const iceDragonite = result.results[0].moves.find(
      (m) => m.move_key === "icebeam",
    );
    expect(iceDragonite).toBeDefined();
    expect(iceDragonite!.type_effectiveness).toBe(4);
  });

  it("Status 技はスキップされる", () => {
    const req: DamageRequest = {
      attacker: {
        pokemon_key: "gengar",
        stats: { hp: 135, atk: 85, def: 80, spa: 170, spd: 95, spe: 142 },
        ability_key: "cursedbody",
      },
      defenders: [
        {
          pokemon_key: "snorlax",
          stats: { hp: 267, atk: 142, def: 85, spa: 85, spd: 142, spe: 50 },
          ability_key: "thickfat",
        },
      ],
      moves: [{ move_key: "toxic" }],
    };

    const result = calculateDamage(req);
    expect(result.results[0].moves).toHaveLength(0);
  });

  it("タイプ相性: 無効 (0x) が正しく計算される", () => {
    const req: DamageRequest = {
      attacker: {
        pokemon_key: "gengar",
        stats: { hp: 135, atk: 85, def: 80, spa: 170, spd: 95, spe: 142 },
        ability_key: "cursedbody",
      },
      defenders: [
        {
          pokemon_key: "snorlax",
          stats: { hp: 267, atk: 142, def: 85, spa: 85, spd: 142, spe: 50 },
          ability_key: "thickfat",
        },
      ],
      moves: [{ move_key: "shadowball" }],
    };

    const result = calculateDamage(req);
    const moveResult = result.results[0].moves[0];
    // Ghost vs Normal = 0x
    expect(moveResult.type_effectiveness).toBe(0);
    expect(moveResult.damage.min).toBe(0);
    expect(moveResult.damage.max).toBe(0);
  });

  it("Pixilate: ノーマル技がフェアリーに変換され、ゴーストにダメージが出る", () => {
    const req: DamageRequest = {
      attacker: {
        pokemon_key: "sylveon",
        stats: { hp: 202, atk: 85, def: 85, spa: 162, spd: 182, spe: 80 },
        ability_key: "pixilate",
      },
      defenders: [
        {
          pokemon_key: "gengar",
          stats: { hp: 135, atk: 85, def: 80, spa: 170, spd: 95, spe: 142 },
          ability_key: "cursedbody",
        },
      ],
      moves: [{ move_key: "hypervoice" }],
    };

    const result = calculateDamage(req);
    const moveResult = result.results[0].moves[0];
    // Fairy vs Ghost/Poison = 1 × 0.5 = 0.5x（無効ではない）
    expect(moveResult.type_effectiveness).toBe(0.5);
    expect(moveResult.damage.min).toBeGreaterThan(0);
  });

  it("Pixilate: ノーマル技のタイプ相性がフェアリー基準で表示される", () => {
    const req: DamageRequest = {
      attacker: {
        pokemon_key: "sylveon",
        stats: { hp: 202, atk: 85, def: 85, spa: 162, spd: 182, spe: 80 },
        ability_key: "pixilate",
      },
      defenders: [
        {
          pokemon_key: "dragonite",
          stats: { hp: 197, atk: 186, def: 115, spa: 120, spd: 120, spe: 100 },
          ability_key: "multiscale",
        },
      ],
      moves: [{ move_key: "hypervoice" }],
    };

    const result = calculateDamage(req);
    const moveResult = result.results[0].moves[0];
    // Fairy vs Dragon/Flying = 2x
    expect(moveResult.type_effectiveness).toBe(2);
    expect(moveResult.damage.min).toBeGreaterThan(0);
  });

  it("タイプ変換特性なし: ノーマル技 vs ゴーストは無効のまま", () => {
    const req: DamageRequest = {
      attacker: {
        pokemon_key: "snorlax",
        stats: { hp: 267, atk: 142, def: 85, spa: 85, spd: 142, spe: 50 },
        ability_key: "thickfat",
      },
      defenders: [
        {
          pokemon_key: "gengar",
          stats: { hp: 135, atk: 85, def: 80, spa: 170, spd: 95, spe: 142 },
          ability_key: "cursedbody",
        },
      ],
      moves: [{ move_key: "bodyslam" }],
    };

    const result = calculateDamage(req);
    const moveResult = result.results[0].moves[0];
    // Normal vs Ghost/Poison = 0x
    expect(moveResult.type_effectiveness).toBe(0);
    expect(moveResult.damage.min).toBe(0);
    expect(moveResult.damage.max).toBe(0);
  });
});
