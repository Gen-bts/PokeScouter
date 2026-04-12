import { useMemo } from "react";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore } from "../stores/useOpponentTeamStore";
import { useMatchLogStore } from "../stores/useMatchLogStore";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";

/** 相手ポケモンごとに使用した技を集約する */
function useOpponentMoves(): Map<string, string[]> {
  const entries = useMatchLogStore((s) => s.entries);
  return useMemo(() => {
    const moveMap = new Map<string, string[]>();
    for (const e of entries) {
      if (
        e.kind !== "battle_event" ||
        e.eventType !== "move_used" ||
        e.side !== "opponent" ||
        e.speciesId == null ||
        !e.moveName
      )
        continue;
      const list = moveMap.get(e.speciesId) ?? [];
      if (!list.includes(e.moveName)) {
        list.push(e.moveName);
      }
      moveMap.set(e.speciesId, list);
    }
    return moveMap;
  }, [entries]);
}

const STAT_NAMES: Record<string, string> = {
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
  accuracy: "命中",
  evasion: "回避",
};

function formatBoosts(boosts: Record<string, number>): string {
  const parts: string[] = [];
  for (const [stat, stages] of Object.entries(boosts)) {
    if (stages === 0) continue;
    const label = STAT_NAMES[stat] ?? stat;
    parts.push(`${label}${stages > 0 ? "+" : ""}${stages}`);
  }
  return parts.join(" ");
}

export function BattleStateOverlay() {
  const attackerPos = useDamageCalcStore((s) => s.selectedAttackerPosition);
  const myActiveName = useMyPartyStore(
    (s) => attackerPos != null ? s.slots[attackerPos - 1]?.name ?? null : null,
  );
  const activeOpponent = useOpponentTeamStore(
    (s) => s.slots.find((sl) => sl.isSelected && sl.pokemonId !== null) ?? null,
  );
  const opponentMoves = useOpponentMoves();

  const movesForActive =
    activeOpponent?.pokemonId != null
      ? opponentMoves.get(activeOpponent.pokemonId)
      : undefined;

  return (
    <div className="battle-state-overlay">
      {/* 自分 */}
      <div className="battle-state-overlay__row">
        <span className="battle-state-overlay__label">自分:</span>
        <span className="battle-state-overlay__value">
          {myActiveName ?? "---"}
        </span>
      </div>

      {/* 相手 */}
      <div className="battle-state-overlay__row">
        <span className="battle-state-overlay__label">相手:</span>
        <span className="battle-state-overlay__value">
          {activeOpponent?.name ?? "---"}
        </span>
        {activeOpponent?.hpPercent != null && (
          <span className="battle-state-overlay__hp">
            HP {activeOpponent.hpPercent}%
          </span>
        )}
      </div>

      {/* 技 */}
      {movesForActive && movesForActive.length > 0 && (
        <div className="battle-state-overlay__row">
          <span className="battle-state-overlay__label">技:</span>
          <span className="battle-state-overlay__value">
            {movesForActive.join(" / ")}
          </span>
        </div>
      )}

      {/* 特性・持ち物 */}
      {(activeOpponent?.ability || activeOpponent?.item) && (
        <div className="battle-state-overlay__row">
          {activeOpponent.ability && (
            <>
              <span className="battle-state-overlay__label">特性:</span>
              <span className="battle-state-overlay__value">
                {activeOpponent.ability}
              </span>
            </>
          )}
          {activeOpponent.item && (
            <>
              <span className="battle-state-overlay__label battle-state-overlay__label--item">
                持物:
              </span>
              <span className="battle-state-overlay__value">
                {activeOpponent.item}
              </span>
            </>
          )}
        </div>
      )}

      {/* ランク補正 */}
      {activeOpponent &&
        Object.keys(activeOpponent.boosts).length > 0 && (
          <div className="battle-state-overlay__row">
            <span className="battle-state-overlay__label">ランク:</span>
            <span className="battle-state-overlay__value battle-state-overlay__boosts">
              {formatBoosts(activeOpponent.boosts)}
            </span>
          </div>
        )}
    </div>
  );
}
