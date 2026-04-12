import { memo } from "react";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore } from "../stores/useOpponentTeamStore";
import { PokemonSprite } from "./PokemonSprite";
import { getKoClass, getKoLabel } from "../utils/damageFormat";
import type { DefenderDamageResult, MoveDamageResult } from "../types";

function DamageMoveLine({ move }: { move: MoveDamageResult }) {
  const barWidth = Math.min(move.max_percent, 100);

  return (
    <div className="damage-move-line">
      <span className="damage-move-name" title={move.move_name}>
        {move.move_name}
      </span>
      <div className="damage-bar-container">
        <div
          className={`damage-bar-fill ${getKoClass(move.guaranteed_ko)}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <span className={`damage-ko-label ${getKoClass(move.guaranteed_ko)}`}>
        {move.type_effectiveness === 0
          ? "0% 無効"
          : `${move.min_percent.toFixed(1)}-${move.max_percent.toFixed(1)}%`}
      </span>
      <span className={`damage-ko-badge ${getKoClass(move.guaranteed_ko)}`}>
        {getKoLabel(move.guaranteed_ko, move.type_effectiveness)}
      </span>
    </div>
  );
}

function DamageDefenderSection({ result }: { result: DefenderDamageResult }) {
  const name = useOpponentTeamStore(
    (s) => s.slots.find((sl) => sl.pokemonId === result.defender_species_id)?.name,
  ) ?? `#${result.defender_species_id}`;

  return (
    <div className="damage-defender">
      <div className="damage-defender-header">
        <PokemonSprite pokemonId={result.defender_species_id} size={24} />
        <span className="damage-defender-name">{name}</span>
        <span className="damage-defender-hp">HP {result.defender_hp}</span>
      </div>
      {result.moves.length === 0 ? (
        <div className="damage-empty">計算可能な技がありません</div>
      ) : (
        result.moves.map((move) => (
          <DamageMoveLine key={move.move_id} move={move} />
        ))
      )}
    </div>
  );
}

export const DamagePanel = memo(function DamagePanel() {
  const selectedPos = useDamageCalcStore((s) => s.selectedAttackerPosition);
  const results = useDamageCalcStore((s) => s.results);
  const loading = useDamageCalcStore((s) => s.loading);
  const error = useDamageCalcStore((s) => s.error);
  const attackerName = useMyPartyStore(
    (s) => selectedPos != null ? s.slots[selectedPos - 1]?.name : null,
  );

  if (!selectedPos) {
    return (
      <div className="panel-section damage-panel damage-panel-empty">
        <h2>ダメージ計算</h2>
        <p className="damage-hint">自分のポケモンをクリックして選択</p>
      </div>
    );
  }

  return (
    <div className="panel-section damage-panel">
      <div className="damage-panel-header">
        <h2>ダメージ計算</h2>
        <span className="damage-attacker-name">
          {attackerName ?? "???"}
        </span>
      </div>

      {loading && <div className="damage-loading">計算中...</div>}

      {error && <div className="damage-error">{error}</div>}

      {!loading && !error && results.length === 0 && (
        <div className="damage-empty">相手が検出されていません</div>
      )}

      {!loading &&
        results.map((dr) => (
          <DamageDefenderSection
            key={dr.defender_species_id}
            result={dr}
          />
        ))}
    </div>
  );
});
