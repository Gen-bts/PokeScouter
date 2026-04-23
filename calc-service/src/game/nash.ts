/**
 * ゼロ和 2 人ゲームのナッシュ均衡ソルバ (Fictitious Play).
 *
 * Robinson (1951) により、ゼロ和ゲームでは FP の時間平均戦略がナッシュ均衡に収束する。
 * 収束速度は O(1/√T) と遅めだが、20×20 以下の小さい行列では 1000 イテレーションで
 * 十分な精度が得られる (exploitability < 1e-6)。
 *
 * pkdx の `nash/references/theory.md` に準じる (FP は Simplex の degenerate fallback と
 * しても位置付けられている)。本実装は MVP として FP のみを用いる。
 */

export interface NashResult {
  /** 行プレイヤー (row) の混合戦略, sums to 1 */
  rowStrategy: number[];
  /** 列プレイヤー (col) の混合戦略, sums to 1 */
  colStrategy: number[];
  /** 行プレイヤー視点の期待ペイオフ (ゲーム値) */
  value: number;
  /** 反復数 */
  iterations: number;
  /** 収束フラグ: "converged" = 許容内, "iteration_limit" = 上限到達 */
  status: "converged" | "iteration_limit" | "trivial";
  /** 終盤の exploitability (ε-Nash の ε) */
  exploitability: number;
}

export interface NashOptions {
  /** 最大反復数 (既定 1000) */
  maxIterations?: number;
  /** 収束許容値 (exploitability の閾値, 既定 1e-6) */
  tolerance?: number;
  /** 収束判定の間隔 (反復数, 既定 10) */
  checkInterval?: number;
}

/**
 * Fictitious Play でゼロ和ゲームを解く.
 *
 * payoffMatrix[i][j] は行プレイヤー i が列プレイヤー j と対した際のペイオフ。
 * 行プレイヤーは最大化、列プレイヤーは最小化を目指す (ゼロ和)。
 *
 * @param payoffMatrix m×n 行列
 * @param options 反復数・収束閾値
 * @returns 混合戦略とゲーム値
 */
export function solveNashFP(
  payoffMatrix: number[][],
  options: NashOptions = {},
): NashResult {
  const m = payoffMatrix.length;
  const n = m > 0 ? payoffMatrix[0]!.length : 0;

  if (m === 0 || n === 0) {
    return {
      rowStrategy: [],
      colStrategy: [],
      value: 0,
      iterations: 0,
      status: "trivial",
      exploitability: 0,
    };
  }

  // 自明ケース: 1×1 → 唯一の混合戦略は (1), (1)
  if (m === 1 && n === 1) {
    return {
      rowStrategy: [1],
      colStrategy: [1],
      value: payoffMatrix[0]![0]!,
      iterations: 0,
      status: "trivial",
      exploitability: 0,
    };
  }

  const maxIter = options.maxIterations ?? 1000;
  const tolerance = options.tolerance ?? 1e-6;
  const checkInterval = Math.max(1, options.checkInterval ?? 10);

  // 反復回数カウント (初期 1 で対称に)
  const rowCounts = new Array<number>(m).fill(1);
  const colCounts = new Array<number>(n).fill(1);

  // 累積効用: rowUtility[i] = Σ_j A[i][j] * colCounts[j]
  //           colUtility[j] = Σ_i A[i][j] * rowCounts[i]
  const rowUtility = new Array<number>(m).fill(0);
  const colUtility = new Array<number>(n).fill(0);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const v = payoffMatrix[i]![j]!;
      rowUtility[i]! += v;
      colUtility[j]! += v;
    }
  }

  let iter = 0;
  let converged = false;
  let exploitability = Infinity;

  for (iter = 1; iter <= maxIter; iter++) {
    // 行プレイヤーの最適応答: argmax_i rowUtility[i]
    let rowBR = 0;
    let maxU = rowUtility[0]!;
    for (let i = 1; i < m; i++) {
      if (rowUtility[i]! > maxU) {
        maxU = rowUtility[i]!;
        rowBR = i;
      }
    }

    // 列プレイヤーの最適応答: argmin_j colUtility[j]
    let colBR = 0;
    let minU = colUtility[0]!;
    for (let j = 1; j < n; j++) {
      if (colUtility[j]! < minU) {
        minU = colUtility[j]!;
        colBR = j;
      }
    }

    // 経験分布の更新
    rowCounts[rowBR]!++;
    colCounts[colBR]!++;

    // 累積効用の差分更新
    for (let i = 0; i < m; i++) rowUtility[i]! += payoffMatrix[i]![colBR]!;
    for (let j = 0; j < n; j++) colUtility[j]! += payoffMatrix[rowBR]![j]!;

    if (iter % checkInterval === 0) {
      const rowTotal = rowCounts.reduce((a, b) => a + b, 0);
      const colTotal = colCounts.reduce((a, b) => a + b, 0);

      // 現在の混合戦略
      const p = new Array<number>(m);
      const q = new Array<number>(n);
      for (let i = 0; i < m; i++) p[i] = rowCounts[i]! / rowTotal;
      for (let j = 0; j < n; j++) q[j] = colCounts[j]! / colTotal;

      // 上界 = max_i p_i の最適応答値 = max_i (Σ_j A[i][j] * q[j])
      // 下界 = min_j q_j の最適応答値 = min_j (Σ_i A[i][j] * p[i])
      let maxUB = -Infinity;
      for (let i = 0; i < m; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += payoffMatrix[i]![j]! * q[j]!;
        if (s > maxUB) maxUB = s;
      }
      let minUB = Infinity;
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += payoffMatrix[i]![j]! * p[i]!;
        if (s < minUB) minUB = s;
      }

      exploitability = maxUB - minUB;
      if (exploitability < tolerance) {
        converged = true;
        break;
      }
    }
  }

  // 最終戦略とゲーム値
  const rowTotal = rowCounts.reduce((a, b) => a + b, 0);
  const colTotal = colCounts.reduce((a, b) => a + b, 0);
  const p = rowCounts.map((c) => c / rowTotal);
  const q = colCounts.map((c) => c / colTotal);

  let v = 0;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      v += p[i]! * payoffMatrix[i]![j]! * q[j]!;
    }
  }

  return {
    rowStrategy: p,
    colStrategy: q,
    value: v,
    iterations: iter,
    status: converged ? "converged" : "iteration_limit",
    exploitability,
  };
}

/**
 * 事前分布で混合戦略を補正する (Bayesian 合成).
 *
 * @param strategy Nash 解の混合戦略
 * @param prior 事前分布 (サイズ一致、合計 1 に正規化される)
 * @param alpha 事前分布の重み (0 = Nash 解そのまま, 1 = 事前分布のみ)
 */
export function blendPrior(
  strategy: number[],
  prior: number[],
  alpha: number,
): number[] {
  if (prior.length !== strategy.length || alpha <= 0) return [...strategy];
  const sumPrior = prior.reduce((a, b) => a + b, 0);
  if (sumPrior <= 0) return [...strategy];
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const norm = prior.map((x) => x / sumPrior);
  const blended = strategy.map((s, i) => (1 - clampedAlpha) * s + clampedAlpha * norm[i]!);
  // 正規化 (念のため)
  const sum = blended.reduce((a, b) => a + b, 0);
  return sum > 0 ? blended.map((x) => x / sum) : [...strategy];
}
