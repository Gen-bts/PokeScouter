import { describe, it, expect } from "vitest";
import { calculateDamage } from "../src/calc/damage-calc.js";
import type { DamageRequest } from "../src/types.js";

describe("ダメージ計算", () => {
  const baseRequest: DamageRequest = {
    attacker: {
      species_id: 6,
      name: "Charizard",
      types: ["fire", "flying"],
      stats: { hp: 153, atk: 104, def: 98, spa: 161, spd: 105, spe: 152 },
      ability: "Blaze",
      item: null,
    },
    defenders: [
      {
        species_id: 149,
        name: "Dragonite",
        types: ["dragon", "flying"],
        stats: { hp: 197, atk: 186, def: 115, spa: 120, spd: 120, spe: 100 },
        ability: "Multiscale",
        item: null,
      },
    ],
    moves: [
      {
        move_id: 53,
        name: "Flamethrower",
        type: "fire",
        power: 90,
        damage_class: "special",
      },
    ],
  };

  it("基本的なダメージ計算が正しく動作する", () => {
    const result = calculateDamage(baseRequest);

    expect(result.results).toHaveLength(1);
    const defResult = result.results[0];
    expect(defResult.defender_species_id).toBe(149);
    expect(defResult.defender_hp).toBe(197);
    expect(defResult.moves).toHaveLength(1);

    const moveResult = defResult.moves[0];
    expect(moveResult.move_id).toBe(53);
    expect(moveResult.move_name).toBe("Flamethrower");
    expect(moveResult.damage.min).toBeGreaterThan(0);
    expect(moveResult.damage.max).toBeGreaterThanOrEqual(moveResult.damage.min);
    expect(moveResult.min_percent).toBeGreaterThan(0);
    expect(moveResult.max_percent).toBeGreaterThanOrEqual(moveResult.min_percent);
    expect(moveResult.guaranteed_ko).toBeGreaterThanOrEqual(0);
    // Fire vs Dragon/Flying = 0.5
    expect(moveResult.type_effectiveness).toBe(0.5);
    expect(moveResult.description).toContain("%");
  });

  it("複数の技 × 複数の防御側を一括計算できる", () => {
    const req: DamageRequest = {
      ...baseRequest,
      defenders: [
        {
          species_id: 149,
          name: "Dragonite",
          types: ["dragon", "flying"],
          stats: { hp: 197, atk: 186, def: 115, spa: 120, spd: 120, spe: 100 },
          ability: "Multiscale",
          item: null,
        },
        {
          species_id: 248,
          name: "Tyranitar",
          types: ["rock", "dark"],
          stats: { hp: 207, atk: 186, def: 130, spa: 115, spd: 120, spe: 81 },
          ability: "Sand Stream",
          item: null,
        },
      ],
      moves: [
        {
          move_id: 53,
          name: "Flamethrower",
          type: "fire",
          power: 90,
          damage_class: "special",
        },
        {
          move_id: 58,
          name: "Ice Beam",
          type: "ice",
          power: 90,
          damage_class: "special",
        },
      ],
    };

    const result = calculateDamage(req);

    // 2 defenders
    expect(result.results).toHaveLength(2);

    // 各 defender に対して 2 技分の結果
    for (const defResult of result.results) {
      expect(defResult.moves).toHaveLength(2);
    }

    // Ice Beam vs Dragonite (Dragon/Flying) = 4x
    const iceDragonite = result.results[0].moves.find(
      (m) => m.move_name === "Ice Beam",
    );
    expect(iceDragonite).toBeDefined();
    expect(iceDragonite!.type_effectiveness).toBe(4);
  });

  it("Status 技はスキップされる", () => {
    const req: DamageRequest = {
      ...baseRequest,
      moves: [
        {
          move_id: 73,
          name: "Toxic",
          type: "poison",
          power: null,
          damage_class: "status",
        },
      ],
    };

    const result = calculateDamage(req);
    expect(result.results[0].moves).toHaveLength(0);
  });

  it("タイプ相性: 無効 (0x) が正しく計算される", () => {
    const req: DamageRequest = {
      attacker: {
        species_id: 94,
        name: "Gengar",
        types: ["ghost", "poison"],
        stats: { hp: 135, atk: 85, def: 80, spa: 170, spd: 95, spe: 142 },
        ability: "Cursed Body",
        item: null,
      },
      defenders: [
        {
          species_id: 143,
          name: "Snorlax",
          types: ["normal"],
          stats: { hp: 267, atk: 142, def: 85, spa: 85, spd: 142, spe: 50 },
          ability: "Thick Fat",
          item: null,
        },
      ],
      moves: [
        {
          move_id: 247,
          name: "Shadow Ball",
          type: "ghost",
          power: 80,
          damage_class: "special",
        },
      ],
    };

    const result = calculateDamage(req);
    const moveResult = result.results[0].moves[0];
    // Ghost vs Normal = 0x
    expect(moveResult.type_effectiveness).toBe(0);
    expect(moveResult.damage.min).toBe(0);
    expect(moveResult.damage.max).toBe(0);
  });
});
