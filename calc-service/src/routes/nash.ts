import { Router } from "express";
import { buildSingleMatchupMatrix, type PokemonSpec } from "../game/payoff.js";
import { solveSelectionGame } from "../game/selection.js";
import type { FieldInput } from "../types.js";

const router = Router();

interface NashSolveRequest {
  team_a: PokemonSpec[];
  team_b: PokemonSpec[];
  pick_size?: number;
  field?: FieldInput;
  /** 事前分布 (picksA と同じサイズ) */
  prior_a?: number[];
  prior_alpha_a?: number;
  prior_b?: number[];
  prior_alpha_b?: number;
  /** 反復オプション */
  max_iterations?: number;
  tolerance?: number;
}

interface NashSolveResponse {
  value: number;
  matchup_6x6: number[][];
  matchup_20x20: number[][];
  picks_a: number[][];
  picks_b: number[][];
  strategy_a: Array<{ pick: number[]; p: number }>;
  strategy_b: Array<{ pick: number[]; p: number }>;
  recommended_pick_a: number[];
  status: "converged" | "iteration_limit" | "trivial";
  iterations: number;
  exploitability: number;
}

router.post("/nash/solve", (req, res) => {
  const body = req.body as NashSolveRequest;

  if (!Array.isArray(body.team_a) || !Array.isArray(body.team_b)) {
    res.status(400).json({ error: "team_a and team_b must be arrays" });
    return;
  }
  if (body.team_a.length !== 6 || body.team_b.length !== 6) {
    res.status(400).json({
      error: `Each team must have exactly 6 pokemon; got team_a=${body.team_a.length}, team_b=${body.team_b.length}`,
    });
    return;
  }

  try {
    const t0 = performance.now();

    // 6×6 単体対面行列を構築
    const singleMatrix = buildSingleMatchupMatrix(body.team_a, body.team_b, {
      field: body.field,
    });

    const t1 = performance.now();

    // 20×20 選出ゲームを解く
    const result = solveSelectionGame(singleMatrix, {
      pickSize: body.pick_size ?? 3,
      nashOptions: {
        maxIterations: body.max_iterations ?? 1000,
        tolerance: body.tolerance ?? 1e-6,
      },
      priorA: body.prior_a,
      priorAlphaA: body.prior_alpha_a,
      priorB: body.prior_b,
      priorAlphaB: body.prior_alpha_b,
    });

    const t2 = performance.now();

    const response: NashSolveResponse = {
      value: result.value,
      matchup_6x6: singleMatrix,
      matchup_20x20: result.outerMatrix,
      picks_a: result.picksA,
      picks_b: result.picksB,
      strategy_a: result.picksA.map((pick, i) => ({ pick, p: result.strategyA[i] ?? 0 })),
      strategy_b: result.picksB.map((pick, j) => ({ pick, p: result.strategyB[j] ?? 0 })),
      recommended_pick_a: result.recommendedPickA,
      status: result.status,
      iterations: result.iterations,
      exploitability: result.exploitability,
    };

    res.setHeader("X-Payoff-Time-Ms", (t1 - t0).toFixed(1));
    res.setHeader("X-Nash-Time-Ms", (t2 - t1).toFixed(1));
    res.json(response);
  } catch (err) {
    console.error("Nash solve error:", err);
    res.status(500).json({
      error: "Internal Nash solve error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
