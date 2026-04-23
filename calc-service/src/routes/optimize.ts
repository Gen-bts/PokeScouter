import { Router } from "express";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  optimizeHBD,
  findNearestDefensePreset,
  DEFAULT_WEIGHTS,
  type ThreatWeights,
  type StatPointAllocation,
} from "../optimize/hbd.js";
import { loadSnapshot } from "../showdown/snapshot.js";

const router = Router();

let cachedMetaWeights: ThreatWeights | null = null;

/**
 * data/derived/meta_threat_mix.json から Champions メタの phys/spec 比を読み込む。
 * ファイル不在時は DEFAULT_WEIGHTS にフォールバック。
 */
function loadMetaThreatWeights(): ThreatWeights {
  if (cachedMetaWeights) return cachedMetaWeights;
  const p = resolve(process.cwd(), "..", "data", "derived", "meta_threat_mix.json");
  if (!existsSync(p)) {
    cachedMetaWeights = DEFAULT_WEIGHTS;
    return cachedMetaWeights;
  }
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as { phys: number; spec: number };
    if (
      typeof data.phys === "number" &&
      typeof data.spec === "number" &&
      data.phys + data.spec > 0
    ) {
      cachedMetaWeights = { phys: data.phys, spec: data.spec };
      return cachedMetaWeights;
    }
  } catch (err) {
    console.warn("Failed to load meta_threat_mix.json, using defaults:", err);
  }
  cachedMetaWeights = DEFAULT_WEIGHTS;
  return cachedMetaWeights;
}

interface HbdRequest {
  pokemon_key: string;
  nature?: string | null;
  weights?: ThreatWeights;
  fixed_sp?: Partial<StatPointAllocation>;
  budget?: number;
  hp_constraint?: "leftovers" | "sitrus" | "residual" | null;
}

interface HbdResponse {
  sp: StatPointAllocation;
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  score: number;
  hp_constraint_satisfied: boolean;
  weights: ThreatWeights;
  nearest_preset: "none" | "h" | "hb" | "hd" | "custom";
  preset_distance: number;
}

router.post("/optimize/hbd", (req, res) => {
  const body = req.body as HbdRequest;

  if (!body.pokemon_key) {
    res.status(400).json({ error: "Missing required field: pokemon_key" });
    return;
  }

  try {
    const snapshot = loadSnapshot();
    const pokemon = snapshot.pokemon[body.pokemon_key];
    if (!pokemon) {
      res.status(404).json({ error: `Unknown pokemon_key: ${body.pokemon_key}` });
      return;
    }

    const result = optimizeHBD({
      baseStats: pokemon.base_stats,
      nature: body.nature,
      weights: body.weights ?? loadMetaThreatWeights(),
      fixedSp: body.fixed_sp,
      budget: body.budget,
      hpConstraint: body.hp_constraint,
    });

    const nearest = findNearestDefensePreset(result.sp);

    const response: HbdResponse = {
      sp: result.sp,
      stats: result.stats,
      score: result.score,
      hp_constraint_satisfied: result.hpConstraintSatisfied,
      weights: result.weights,
      nearest_preset: nearest.preset,
      preset_distance: nearest.distance,
    };

    res.json(response);
  } catch (err) {
    console.error("HBD optimize error:", err);
    res.status(500).json({
      error: "Internal optimization error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
