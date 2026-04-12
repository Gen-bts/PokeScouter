import { useMemo } from "react";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore } from "../stores/useOpponentTeamStore";
import { usePokemonDetail } from "../hooks/usePokemonDetail";
import type { ValidatedField } from "../types";
import { calcChampionsStat } from "../utils/statCalc";

/** ランク補正の倍率を返す (stages: -6 ~ +6) */
function boostMultiplier(stages: number): number {
  if (stages >= 0) return (2 + stages) / 2;
  return 2 / (2 - stages);
}

function fieldToInt(field: ValidatedField | undefined): number | null {
  if (!field) return null;
  const val = field.validated ?? field.raw;
  if (!val) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

interface Props {
  currentScene: string;
}

export function SpeedComparisonOverlay({ currentScene }: Props) {
  const attackerPos = useDamageCalcStore((s) => s.selectedAttackerPosition);

  // バトルシーン以外は非表示
  const isBattleScene =
    currentScene === "battle" ||
    currentScene === "battle_Neutral" ||
    currentScene === "move_select" ||
    currentScene === "pokemon_summary";

  // 自分のすばやさ実数値（プリミティブを返すセレクターで参照安定）
  const mySpeed = useMyPartyStore((s) => {
    if (!isBattleScene || attackerPos == null) return null;
    const slot = s.slots[attackerPos - 1];
    return slot ? fieldToInt(slot.fields["すばやさ実数値"]) : null;
  });

  // 相手のアクティブポケモンの ID とすばやさブースト
  const opponentPokemonId = useOpponentTeamStore(
    (s) => s.slots.find((sl) => sl.isSelected && sl.pokemonId !== null)?.pokemonId ?? null,
  );
  const opponentSpeBoost = useOpponentTeamStore(
    (s) => s.slots.find((sl) => sl.isSelected && sl.pokemonId !== null)?.boosts?.spe ?? 0,
  );

  if (!isBattleScene) return null;

  if (mySpeed == null || opponentPokemonId == null) return null;

  return (
    <SpeedComparisonInner
      mySpeed={mySpeed}
      opponentPokemonId={opponentPokemonId}
      opponentSpeBoost={opponentSpeBoost}
    />
  );
}

interface InnerProps {
  mySpeed: number;
  opponentPokemonId: string;
  opponentSpeBoost: number;
}

/** usePokemonDetail を条件付きで呼べるよう内部コンポーネントに分離 */
function SpeedComparisonInner({
  mySpeed,
  opponentPokemonId,
  opponentSpeBoost,
}: InnerProps) {
  const { detail } = usePokemonDetail(opponentPokemonId);

  const result = useMemo(() => {
    if (!detail) return null;
    const baseSpe = detail.base_stats.spe;

    // 無振り (statPoints=0, 性格補正なし)
    let minSpeed = calcChampionsStat(baseSpe, 0, 1.0);
    // 最速 (statPoints=32, +性格)
    let maxSpeed = calcChampionsStat(baseSpe, 32, 1.1);

    // ランク補正を適用
    if (opponentSpeBoost !== 0) {
      const mult = boostMultiplier(opponentSpeBoost);
      minSpeed = Math.floor(minSpeed * mult);
      maxSpeed = Math.floor(maxSpeed * mult);
    }

    let verdict: "faster" | "slower" | "uncertain";
    if (mySpeed > maxSpeed) verdict = "faster";
    else if (mySpeed < minSpeed) verdict = "slower";
    else verdict = "uncertain";

    return { baseSpe, minSpeed, maxSpeed, verdict };
  }, [detail, mySpeed, opponentSpeBoost]);

  if (!result) return null;

  const { minSpeed, maxSpeed, verdict } = result;

  const verdictLabel =
    verdict === "faster"
      ? "確定先手"
      : verdict === "slower"
        ? "確定後手"
        : "調整次第";

  const arrowIcon =
    verdict === "faster"
      ? "\u25B8\u25B8"
      : verdict === "slower"
        ? "\u25C2\u25C2"
        : "\u21C4";

  return (
    <div className={`speed-comparison-overlay speed--${verdict}`}>
      <span className="speed-comparison-overlay__val speed-comparison-overlay__my">
        {mySpeed}
      </span>
      <span className="speed-comparison-overlay__arrow">{arrowIcon}</span>
      <span className="speed-comparison-overlay__val speed-comparison-overlay__opp">
        {minSpeed === maxSpeed ? minSpeed : `${minSpeed}~${maxSpeed}`}
        {opponentSpeBoost !== 0 && (
          <span className="speed-comparison-overlay__boost">
            {opponentSpeBoost > 0 ? "+" : ""}{opponentSpeBoost}
          </span>
        )}
      </span>
      <span className="speed-comparison-overlay__verdict">{verdictLabel}</span>
    </div>
  );
}
