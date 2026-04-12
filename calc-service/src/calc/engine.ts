/**
 * ダメージ計算エンジンの共通インターフェース.
 */

import type { DamageRequest, DamageResponse } from "../types.js";

export interface DamageEngine {
  calculateDamage(req: DamageRequest): DamageResponse;
}
