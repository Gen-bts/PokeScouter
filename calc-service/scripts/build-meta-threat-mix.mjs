/**
 * Pikalytics championspreview.json と Showdown moves.json から、
 * Champions メタ環境の物理/特殊脅威比 (phys/spec) を集計する。
 *
 * 出力: data/derived/meta_threat_mix.json
 *   {
 *     "_meta": { ... },
 *     "phys": 0.xx,
 *     "spec": 0.xx,
 *     "total_usage_pts": number,
 *     "contributions": { physical: N, special: M, status: K }
 *   }
 *
 * 集計方法:
 *   各ポケモンは均等扱い (championspreview はポケモンレベルの使用率を持たないため)。
 *   各技の usage_percent を phys/spec バケットに加算 (damage_class 参照)。
 *   合計 phys / (phys + spec) が重み p。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const PIKALYTICS_PATH = resolve(REPO_ROOT, "data", "pikalytics", "championspreview.json");
const MOVES_PATH = resolve(REPO_ROOT, "data", "showdown", "champions-bss-reg-ma", "moves.json");
const OUTPUT_DIR = resolve(REPO_ROOT, "data", "derived");
const OUTPUT_PATH = resolve(OUTPUT_DIR, "meta_threat_mix.json");

function main() {
  const pika = JSON.parse(readFileSync(PIKALYTICS_PATH, "utf8"));
  const moves = JSON.parse(readFileSync(MOVES_PATH, "utf8"));

  let totalPhys = 0;
  let totalSpec = 0;
  let totalStatus = 0;
  let totalUsagePts = 0;
  const unmatchedMoves = new Set();

  const pokemonMap = pika.pokemon || {};
  let pokemonCount = 0;

  for (const [pokemonKey, data] of Object.entries(pokemonMap)) {
    pokemonCount++;
    const usageMoves = data.moves || [];
    for (const mv of usageMoves) {
      const moveEntry = moves[mv.move_key];
      if (!moveEntry) {
        unmatchedMoves.add(mv.move_key);
        continue;
      }
      const usage = mv.usage_percent ?? 0;
      totalUsagePts += usage;
      if (moveEntry.damage_class === "physical") {
        totalPhys += usage;
      } else if (moveEntry.damage_class === "special") {
        totalSpec += usage;
      } else {
        totalStatus += usage;
      }
    }
  }

  const damagingTotal = totalPhys + totalSpec;
  const phys = damagingTotal > 0 ? totalPhys / damagingTotal : 0.5;
  const spec = damagingTotal > 0 ? totalSpec / damagingTotal : 0.5;

  const output = {
    _meta: {
      source: "aggregated from pikalytics championspreview + showdown moves",
      pokemon_count: pokemonCount,
      unmatched_move_count: unmatchedMoves.size,
      unmatched_move_keys: Array.from(unmatchedMoves).slice(0, 20),
      generated_at: new Date().toISOString(),
    },
    phys,
    spec,
    total_usage_pts: totalUsagePts,
    contributions: {
      physical: totalPhys,
      special: totalSpec,
      status: totalStatus,
    },
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");

  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  pokemon: ${pokemonCount}`);
  console.log(`  total usage pts: ${totalUsagePts.toFixed(2)}`);
  console.log(`  phys: ${phys.toFixed(4)} (${totalPhys.toFixed(2)} pts)`);
  console.log(`  spec: ${spec.toFixed(4)} (${totalSpec.toFixed(2)} pts)`);
  console.log(`  status (ignored): ${totalStatus.toFixed(2)} pts`);
  if (unmatchedMoves.size > 0) {
    console.warn(`  WARNING: ${unmatchedMoves.size} unmatched move keys (sample: ${Array.from(unmatchedMoves).slice(0, 5).join(", ")})`);
  }
}

main();
