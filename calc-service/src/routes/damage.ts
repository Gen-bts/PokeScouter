import { Router } from "express";
import type { DamageRequest } from "../types.js";
import { calculateDamage } from "../calc/damage-calc.js";

const router = Router();

router.post("/calc/damage", (req, res) => {
  const body = req.body as DamageRequest;

  // 基本バリデーション
  if (!body.attacker || !body.defenders || !body.moves) {
    res.status(400).json({
      error: "Missing required fields: attacker, defenders, moves",
    });
    return;
  }

  if (!Array.isArray(body.defenders) || body.defenders.length === 0) {
    res.status(400).json({ error: "defenders must be a non-empty array" });
    return;
  }

  if (!Array.isArray(body.moves) || body.moves.length === 0) {
    res.status(400).json({ error: "moves must be a non-empty array" });
    return;
  }

  try {
    const result = calculateDamage(body);
    res.json(result);
  } catch (err) {
    console.error("Damage calculation error:", err);
    res.status(500).json({
      error: "Internal calculation error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
