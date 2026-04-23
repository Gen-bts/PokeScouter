import {
  useDamageTestStore,
  STAT_KEYS,
  type DamageTestMoveResult,
} from "../../stores/useDamageTestStore";
import { PokemonSprite } from "../PokemonSprite";

const STAT_LABELS: Record<string, string> = {
  hp: "H",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};

function koClass(ko: number, typeEff: number): string {
  if (typeEff === 0) return "dt-res-immune";
  if (ko === 1) return "dt-res-ohko";
  if (ko === 2) return "dt-res-2hko";
  if (ko === 3) return "dt-res-3hko";
  return "dt-res-weak";
}

function koLabel(ko: number, typeEff: number): string {
  if (typeEff === 0) return "無効";
  if (ko <= 0) return "—";
  return `確${ko}`;
}

function MoveLine({ move, hp }: { move: DamageTestMoveResult; hp: number }) {
  const cls = koClass(move.guaranteed_ko, move.type_effectiveness);
  const barWidth = Math.min(move.max_percent, 100);
  return (
    <div className="dt-res-move">
      <span className="dt-res-move-name" title={move.move_name}>
        {move.move_name}
      </span>
      <div className="dt-res-bar">
        <div className={`dt-res-bar-fill ${cls}`} style={{ width: `${barWidth}%` }} />
      </div>
      <span className="dt-res-percent">
        {move.min_percent.toFixed(1)}-{move.max_percent.toFixed(1)}%
      </span>
      <span className="dt-res-damage">
        ({move.damage.min}-{move.damage.max} / {hp})
      </span>
      <span className={`dt-res-ko ${cls}`}>
        {koLabel(move.guaranteed_ko, move.type_effectiveness)}
      </span>
    </div>
  );
}

export function DamageTestResultPanel() {
  const results = useDamageTestStore((s) => s.results);
  const loading = useDamageTestStore((s) => s.loading);
  const error = useDamageTestStore((s) => s.error);

  return (
    <div className="dt-result-panel">
      <h3>計算結果</h3>
      {loading && <div className="dt-res-loading">計算中...</div>}
      {error && <div className="dt-res-error">{error}</div>}
      {!loading && !error && !results && (
        <div className="dt-res-empty">
          攻撃側・防御側・技を選択すると計算が実行されます
        </div>
      )}
      {results && (
        <div className="dt-res-body">
          <div className="dt-res-stats-row">
            <div className="dt-res-side">
              <div className="dt-res-side-head">
                <PokemonSprite pokemonId={results.attacker_pokemon_key} size={32} />
                <span>攻撃側 実数値</span>
              </div>
              <div className="dt-res-stats">
                {STAT_KEYS.map((s) => (
                  <div key={s} className="dt-res-stat">
                    <span className="dt-res-stat-label">{STAT_LABELS[s]}</span>
                    <span className="dt-res-stat-value">{results.attacker_stats[s]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="dt-res-side">
              <div className="dt-res-side-head">
                <PokemonSprite pokemonId={results.defender_pokemon_key} size={32} />
                <span>防御側 実数値</span>
              </div>
              <div className="dt-res-stats">
                {STAT_KEYS.map((s) => (
                  <div key={s} className="dt-res-stat">
                    <span className="dt-res-stat-label">{STAT_LABELS[s]}</span>
                    <span className="dt-res-stat-value">{results.defender_stats[s]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {results.results.length === 0 ? (
            <div className="dt-res-empty">計算可能な技がありません</div>
          ) : (
            results.results.map((r) => (
              <div key={r.defender_pokemon_key} className="dt-res-defender">
                {r.moves.length === 0 ? (
                  <div className="dt-res-empty">計算可能な技がありません</div>
                ) : (
                  r.moves.map((m) => (
                    <MoveLine key={m.move_key} move={m} hp={r.defender_hp} />
                  ))
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
