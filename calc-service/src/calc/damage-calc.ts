/**
 * 後方互換 re-export.
 *
 * SmogonDamageEngine に移行済み。テストなど旧インポートのために残す。
 */

import { SmogonDamageEngine } from "./smogon-engine.js";
import type { DamageRequest, DamageResponse } from "../types.js";

const engine = new SmogonDamageEngine();

export function calculateDamage(req: DamageRequest): DamageResponse {
  return engine.calculateDamage(req);
}
