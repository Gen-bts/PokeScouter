import { describe, it, expect } from "vitest";
import { solveNashFP, blendPrior } from "../src/game/nash.js";

describe("solveNashFP", () => {
  it("1×1 行列 → 自明解", () => {
    const res = solveNashFP([[3]]);
    expect(res.rowStrategy).toEqual([1]);
    expect(res.colStrategy).toEqual([1]);
    expect(res.value).toBe(3);
    expect(res.status).toBe("trivial");
  });

  it("空行列 → 0", () => {
    const res = solveNashFP([]);
    expect(res.value).toBe(0);
    expect(res.rowStrategy).toEqual([]);
  });

  it("じゃんけん (RPS) → 均等 (1/3, 1/3, 1/3) かつ value=0", () => {
    // Rock(0) / Paper(1) / Scissors(2)
    // A[i][j] = row プレイヤーの payoff
    const A = [
      [0, -1, 1],   // Rock: loses to Paper, beats Scissors
      [1, 0, -1],   // Paper: beats Rock, loses to Scissors
      [-1, 1, 0],   // Scissors: loses to Rock, beats Paper
    ];
    const res = solveNashFP(A, { maxIterations: 5000, tolerance: 1e-4 });
    expect(Math.abs(res.value)).toBeLessThan(0.05);
    for (const p of res.rowStrategy) {
      expect(p).toBeCloseTo(1 / 3, 1);
    }
    for (const q of res.colStrategy) {
      expect(q).toBeCloseTo(1 / 3, 1);
    }
  });

  it("対称ゲーム (鏡映) → value ≈ 0", () => {
    const A = [
      [0, 2, -1],
      [-2, 0, 3],
      [1, -3, 0],
    ];
    const res = solveNashFP(A, { maxIterations: 5000 });
    expect(Math.abs(res.value)).toBeLessThan(0.1);
  });

  it("行支配 (row 1 が全て有利) → value は max row", () => {
    // Row 0 が全ての col に対して Row 1 より高い → Nash は row 0 を pure に
    const A = [
      [5, 3],   // 強い行
      [1, 2],
    ];
    const res = solveNashFP(A, { maxIterations: 2000 });
    // row player は row 0 を選ぶ → col player は min(5, 3) を選ぶ → col 1 (値 3)
    expect(res.value).toBeCloseTo(3, 1);
    expect(res.rowStrategy[0]).toBeGreaterThan(0.9);
  });

  it("鞍点ゲーム → value = 鞍点値", () => {
    // Saddle point at (row 0, col 0) = 4: 行最小の中で最大、列最大の中で最小
    const A = [
      [4, 5, 6],
      [3, 2, 7],
      [1, 0, 8],
    ];
    // minimax for row: min of each row = [4, 2, 0] → max = 4 (row 0)
    // minimax for col: max of each col = [4, 5, 8] → min = 4 (col 0)
    // saddle at (0, 0) with value 4
    const res = solveNashFP(A, { maxIterations: 2000 });
    expect(res.value).toBeCloseTo(4, 1);
  });

  it("exploitability はしきい値以下で converged", () => {
    const A = [
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ];
    const res = solveNashFP(A, { maxIterations: 5000, tolerance: 1e-3 });
    if (res.status === "converged") {
      expect(res.exploitability).toBeLessThan(1e-3);
    }
  });

  it("マトリクス反転でゲーム値は符号反転", () => {
    const A = [[0, -1, 1], [1, 0, -1], [-1, 1, 0]];
    const B = A.map((row) => row.map((v) => -v));
    const resA = solveNashFP(A, { maxIterations: 3000 });
    const resB = solveNashFP(B, { maxIterations: 3000 });
    // 両方とも value ≈ 0
    expect(Math.abs(resA.value + resB.value)).toBeLessThan(0.1);
  });

  it("混合戦略は合計 1", () => {
    const A = [
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ];
    const res = solveNashFP(A, { maxIterations: 1000 });
    const rowSum = res.rowStrategy.reduce((a, b) => a + b, 0);
    const colSum = res.colStrategy.reduce((a, b) => a + b, 0);
    expect(rowSum).toBeCloseTo(1, 6);
    expect(colSum).toBeCloseTo(1, 6);
  });
});

describe("blendPrior", () => {
  it("alpha=0 → 戦略そのまま", () => {
    const res = blendPrior([0.5, 0.3, 0.2], [1, 0, 0], 0);
    expect(res).toEqual([0.5, 0.3, 0.2]);
  });

  it("alpha=1 → 事前分布のみ", () => {
    const res = blendPrior([0.5, 0.3, 0.2], [0.6, 0.4, 0], 1);
    expect(res[0]).toBeCloseTo(0.6, 5);
    expect(res[1]).toBeCloseTo(0.4, 5);
    expect(res[2]).toBeCloseTo(0, 5);
  });

  it("alpha=0.5 → 中間", () => {
    const res = blendPrior([1, 0, 0], [0, 1, 0], 0.5);
    expect(res[0]).toBeCloseTo(0.5, 5);
    expect(res[1]).toBeCloseTo(0.5, 5);
  });

  it("出力は合計 1", () => {
    const res = blendPrior([0.5, 0.3, 0.2], [0.1, 0.6, 0.3], 0.4);
    const sum = res.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("サイズ不一致 → 戦略そのまま", () => {
    const res = blendPrior([0.5, 0.5], [1, 0, 0], 0.5);
    expect(res).toEqual([0.5, 0.5]);
  });
});
