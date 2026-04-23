import { describe, it, expect } from "vitest";
import {
  enumerateCombinations,
  solveSelectionGame,
} from "../src/game/selection.js";

describe("enumerateCombinations", () => {
  it("C(6, 3) = 20 通り", () => {
    const combos = enumerateCombinations(6, 3);
    expect(combos.length).toBe(20);
  });

  it("C(4, 2) = 6 通り", () => {
    const combos = enumerateCombinations(4, 2);
    expect(combos.length).toBe(6);
    expect(combos).toContainEqual([0, 1]);
    expect(combos).toContainEqual([2, 3]);
  });

  it("C(N, 0) = 1 通り (空)", () => {
    const combos = enumerateCombinations(5, 0);
    expect(combos).toEqual([[]]);
  });

  it("全ての組合せは sorted ascending", () => {
    const combos = enumerateCombinations(6, 3);
    for (const c of combos) {
      const sorted = [...c].sort((a, b) => a - b);
      expect(c).toEqual(sorted);
    }
  });
});

describe("solveSelectionGame (6×6 → 20×20)", () => {
  it("6×6 単体対面で 20×20 ゲームを構築し解く", () => {
    // 6×6 ランダム対面行列
    const matrix: number[][] = [
      [0, 0.3, -0.2, 0.5, -0.1, 0.1],
      [-0.3, 0, 0.4, -0.2, 0.3, -0.1],
      [0.2, -0.4, 0, 0.1, -0.3, 0.2],
      [-0.5, 0.2, -0.1, 0, 0.4, -0.2],
      [0.1, -0.3, 0.3, -0.4, 0, 0.3],
      [-0.1, 0.1, -0.2, 0.2, -0.3, 0],
    ];

    const result = solveSelectionGame(matrix, {
      pickSize: 3,
      nashOptions: { maxIterations: 500 },
    });

    expect(result.picksA.length).toBe(20);
    expect(result.picksB.length).toBe(20);
    expect(result.outerMatrix.length).toBe(20);
    expect(result.outerMatrix[0]!.length).toBe(20);

    // 合計は 1
    const sumA = result.strategyA.reduce((a, b) => a + b, 0);
    const sumB = result.strategyB.reduce((a, b) => a + b, 0);
    expect(sumA).toBeCloseTo(1, 2);
    expect(sumB).toBeCloseTo(1, 2);

    // 推奨 pick は 3 匹
    expect(result.recommendedPickA.length).toBe(3);
  });

  it("全て 0 の行列 → value ≈ 0", () => {
    const matrix: number[][] = Array.from({ length: 6 }, () =>
      Array(6).fill(0),
    );
    const result = solveSelectionGame(matrix, {
      nashOptions: { maxIterations: 500 },
    });
    expect(Math.abs(result.value)).toBeLessThan(0.01);
  });

  it("完全優位 (row が全マス +1) → value = +1", () => {
    const matrix: number[][] = Array.from({ length: 6 }, () =>
      Array(6).fill(1),
    );
    const result = solveSelectionGame(matrix, {
      nashOptions: { maxIterations: 500 },
    });
    expect(result.value).toBeCloseTo(1, 1);
  });

  it("完全劣位 (row が全マス -1) → value = -1", () => {
    const matrix: number[][] = Array.from({ length: 6 }, () =>
      Array(6).fill(-1),
    );
    const result = solveSelectionGame(matrix, {
      nashOptions: { maxIterations: 500 },
    });
    expect(result.value).toBeCloseTo(-1, 1);
  });

  it("事前分布 (priorB) が strategyB に影響する", () => {
    const matrix: number[][] = [
      [0, 0.3, -0.2, 0.5, -0.1, 0.1],
      [-0.3, 0, 0.4, -0.2, 0.3, -0.1],
      [0.2, -0.4, 0, 0.1, -0.3, 0.2],
      [-0.5, 0.2, -0.1, 0, 0.4, -0.2],
      [0.1, -0.3, 0.3, -0.4, 0, 0.3],
      [-0.1, 0.1, -0.2, 0.2, -0.3, 0],
    ];
    const priorB = Array(20).fill(0);
    priorB[0] = 1; // 最初の pick に強い事前信念
    const result = solveSelectionGame(matrix, {
      priorB,
      priorAlphaB: 0.9,
      nashOptions: { maxIterations: 500 },
    });
    // strategyB[0] は強く引き寄せられるはず
    expect(result.strategyB[0]).toBeGreaterThan(0.5);
  });

  it("pickSize=2 なら C(6,2) = 15 通り", () => {
    const matrix: number[][] = Array.from({ length: 6 }, () =>
      Array(6).fill(0),
    );
    const result = solveSelectionGame(matrix, {
      pickSize: 2,
      nashOptions: { maxIterations: 300 },
    });
    expect(result.picksA.length).toBe(15);
    expect(result.recommendedPickA.length).toBe(2);
  });
});
