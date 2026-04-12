/**
 * エンジンファクトリ.
 *
 * CalcEngine 文字列から対応する DamageEngine インスタンスを返す。
 */

import type { CalcEngine } from "../types.js";
import type { DamageEngine } from "./engine.js";
import { SmogonDamageEngine } from "./smogon-engine.js";

const smogonEngine = new SmogonDamageEngine();

// PkmnDmgEngine は Phase 2 で追加後にインポートを有効化する
// import { PkmnDmgEngine } from "./pkmn-engine.js";
// const pkmnEngine = new PkmnDmgEngine();

export function getEngine(engine?: CalcEngine): DamageEngine {
  switch (engine) {
    case "pkmn":
      throw new Error("pkmn engine is not yet implemented");
    case "smogon":
    default:
      return smogonEngine;
  }
}
