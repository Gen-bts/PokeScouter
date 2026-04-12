import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useOpponentTeamStore } from "../stores/useOpponentTeamStore";
import { getKoClass, getKoLabel } from "../utils/damageFormat";
import type { DefenderDamageResult } from "../types";

interface Props {
  currentScene: string;
}

export function DamageOverlay({ currentScene }: Props) {
  const isBattleScene =
    currentScene === "battle" ||
    currentScene === "battle_Neutral" ||
    currentScene === "move_select" ||
    currentScene === "pokemon_summary";

  const activeOpponent = useOpponentTeamStore(
    (s) => s.slots.find((sl) => sl.isSelected && sl.pokemonId !== null) ?? null,
  );

  const activeResult = useDamageCalcStore((s) => {
    if (!activeOpponent) return null;
    return (
      s.results.find(
        (r) => r.defender_species_id === activeOpponent.pokemonId,
      ) ?? null
    );
  });

  if (!isBattleScene || !activeOpponent || !activeResult) return null;

  return (
    <DamageOverlayInner
      result={activeResult}
      opponentName={activeOpponent.name ?? `#${activeOpponent.pokemonId}`}
      opponentPokemonId={activeOpponent.pokemonId!}
      hpPercent={activeOpponent.hpPercent}
    />
  );
}

interface InnerProps {
  result: DefenderDamageResult;
  opponentName: string;
  opponentPokemonId: string;
  hpPercent: number | null;
}

function DamageOverlayInner({
  result,
  opponentName,
  opponentPokemonId,
  hpPercent,
}: InnerProps) {
  return (
    <div className="damage-overlay">
      <div className="damage-overlay__header">
        <img
          src={`/sprites/${opponentPokemonId}.png`}
          className="damage-overlay__sprite"
          alt=""
        />
        <span className="damage-overlay__name">{opponentName}</span>
        <span className="damage-overlay__hp">
          HP {result.defender_hp}
          {hpPercent != null && hpPercent < 100 && ` (${hpPercent}%)`}
        </span>
      </div>
      {result.moves.length === 0 ? (
        <div className="damage-overlay__empty">—</div>
      ) : (
        result.moves.map((move) => (
          <div key={move.move_id} className="damage-overlay__move">
            <span className="damage-overlay__move-name" title={move.move_name}>
              {move.move_name}
            </span>
            <span
              className={`damage-overlay__move-pct ${getKoClass(move.guaranteed_ko)}`}
            >
              {move.type_effectiveness === 0
                ? "0% 無効"
                : `${move.min_percent.toFixed(1)}-${move.max_percent.toFixed(1)}%`}
            </span>
            <span
              className={`damage-overlay__ko ${getKoClass(move.guaranteed_ko)}`}
            >
              {getKoLabel(move.guaranteed_ko, move.type_effectiveness)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
