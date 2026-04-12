import type { ReactNode } from "react";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useOpponentTeamStore } from "../stores/useOpponentTeamStore";
import { usePokemonDetail } from "../hooks/usePokemonDetail";
import { calcChampionsStat } from "../utils/statCalc";
import { getKoClass, getKoLabel } from "../utils/damageFormat";
import { PokemonSprite } from "./PokemonSprite";
import type {
  DefenderDamageResult,
  MoveDamageResult,
  ValidatedField,
} from "../types";

const BATTLE_SCENES = new Set([
  "battle",
  "battle_Neutral",
  "move_select",
  "pokemon_summary",
]);

const STAT_ENTRIES = [
  { key: "hp", label: "HP", myField: "HP実数値" },
  { key: "atk", label: "A", myField: "こうげき実数値" },
  { key: "def", label: "B", myField: "ぼうぎょ実数値" },
  { key: "spa", label: "C", myField: "とくこう実数値" },
  { key: "spd", label: "D", myField: "とくぼう実数値" },
  { key: "spe", label: "S", myField: "すばやさ実数値" },
] as const;

const BOOST_LABELS: Record<string, string> = {
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
  accuracy: "命中",
  evasion: "回避",
};

function fieldToInt(field: ValidatedField | undefined): number | null {
  if (!field) return null;
  const value = field.validated ?? field.raw;
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function fieldToText(field: ValidatedField | undefined): string | null {
  if (!field) return null;
  return field.validated ?? field.raw ?? null;
}

function boostMultiplier(stages: number): number {
  if (stages >= 0) return (2 + stages) / 2;
  return 2 / (2 - stages);
}

function formatBoosts(boosts: Record<string, number>): string | null {
  const parts = Object.entries(boosts)
    .filter(([, stages]) => stages !== 0)
    .map(([stat, stages]) => {
      const label = BOOST_LABELS[stat] ?? stat;
      return `${label}${stages > 0 ? "+" : ""}${stages}`;
    });
  return parts.length > 0 ? parts.join(" ") : null;
}

function buildSpeedComparison(
  mySpeed: number | null,
  opponentBaseSpeed: number | undefined,
  opponentSpeBoost: number,
): {
  mySpeed: number;
  minSpeed: number;
  maxSpeed: number;
  verdict: "faster" | "slower" | "uncertain";
} | null {
  if (mySpeed == null || opponentBaseSpeed == null) {
    return null;
  }

  let minSpeed = calcChampionsStat(opponentBaseSpeed, 0, 1.0);
  let maxSpeed = calcChampionsStat(opponentBaseSpeed, 32, 1.1);

  if (opponentSpeBoost !== 0) {
    const multiplier = boostMultiplier(opponentSpeBoost);
    minSpeed = Math.floor(minSpeed * multiplier);
    maxSpeed = Math.floor(maxSpeed * multiplier);
  }

  let verdict: "faster" | "slower" | "uncertain" = "uncertain";
  if (mySpeed > maxSpeed) {
    verdict = "faster";
  } else if (mySpeed < minSpeed) {
    verdict = "slower";
  }

  return {
    mySpeed,
    minSpeed,
    maxSpeed,
    verdict,
  };
}

function SidePlaceholder({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section className="battle-info-overlay__side battle-info-overlay__side--placeholder">
      <div className="battle-info-overlay__section-label">{title}</div>
      <div className="battle-info-overlay__placeholder">{message}</div>
    </section>
  );
}

function StatGrid({
  stats,
}: {
  stats: Array<{ label: string; value: number | null }>;
}) {
  return (
    <div className="battle-info-overlay__stats">
      {stats.map((stat) => (
        <div key={stat.label} className="battle-info-overlay__stat">
          <span className="battle-info-overlay__stat-label">{stat.label}</span>
          <span className="battle-info-overlay__stat-value">
            {stat.value ?? "?"}
          </span>
        </div>
      ))}
    </div>
  );
}

function DamageMoveRow({ move }: { move: MoveDamageResult }) {
  return (
    <div className="battle-info-overlay__damage-move">
      <span
        className="battle-info-overlay__damage-move-name"
        title={move.move_name}
      >
        {move.move_name}
      </span>
      <span
        className={`battle-info-overlay__damage-move-value ${getKoClass(move.guaranteed_ko)}`}
      >
        {move.type_effectiveness === 0
          ? "0% 無効"
          : `${move.min_percent.toFixed(1)}-${move.max_percent.toFixed(1)}%`}
      </span>
      <span
        className={`battle-info-overlay__damage-move-ko ${getKoClass(move.guaranteed_ko)}`}
      >
        {getKoLabel(move.guaranteed_ko, move.type_effectiveness)}
      </span>
    </div>
  );
}

function DamageSection({
  loading,
  error,
  result,
  mySelected,
  opponentSelected,
}: {
  loading: boolean;
  error: string | null;
  result: DefenderDamageResult | null;
  mySelected: boolean;
  opponentSelected: boolean;
}) {
  let content: ReactNode;

  if (!mySelected) {
    content = (
      <div className="battle-info-overlay__placeholder">
        自分ポケモンを選択
      </div>
    );
  } else if (!opponentSelected) {
    content = (
      <div className="battle-info-overlay__placeholder">
        相手ポケモンを選択
      </div>
    );
  } else if (loading && result == null) {
    content = (
      <div className="battle-info-overlay__placeholder">
        ダメージ計算中...
      </div>
    );
  } else if (error) {
    content = (
      <div className="battle-info-overlay__placeholder battle-info-overlay__placeholder--error">
        {error}
      </div>
    );
  } else if (!result) {
    content = (
      <div className="battle-info-overlay__placeholder">
        ダメージ計算データ不足
      </div>
    );
  } else if (result.moves.length === 0) {
    content = (
      <div className="battle-info-overlay__placeholder">
        有効な技がありません
      </div>
    );
  } else {
    content = (
      <div className="battle-info-overlay__damage-list">
        {result.moves.map((move) => (
          <DamageMoveRow key={move.move_id} move={move} />
        ))}
      </div>
    );
  }

  return (
    <section className="battle-info-overlay__section">
      <div className="battle-info-overlay__section-label">ダメージ計算</div>
      {content}
    </section>
  );
}

interface Props {
  currentScene: string;
}

export function BattleInfoOverlay({ currentScene }: Props) {
  const isBattleScene = BATTLE_SCENES.has(currentScene);

  const attackerPosition = useDamageCalcStore((state) => state.selectedAttackerPosition);
  const damageResults = useDamageCalcStore((state) => state.results);
  const damageLoading = useDamageCalcStore((state) => state.loading);
  const damageError = useDamageCalcStore((state) => state.error);

  const mySlots = useMyPartyStore((state) => state.slots);
  const opponentSlots = useOpponentTeamStore((state) => state.slots);
  const displaySelectedPosition = useOpponentTeamStore(
    (state) => state.displaySelectedPosition,
  );

  const mySlot =
    attackerPosition != null ? mySlots[attackerPosition - 1] ?? null : null;
  const opponentSlot =
    displaySelectedPosition != null
      ? opponentSlots[displaySelectedPosition - 1] ?? null
      : null;

  const { detail: opponentDetail } = usePokemonDetail(opponentSlot?.pokemonId ?? null);

  if (!isBattleScene) {
    return null;
  }

  const myStats = STAT_ENTRIES.map((entry) => ({
    label: entry.label,
    value: fieldToInt(mySlot?.fields[entry.myField]),
  }));
  const mySpeed = myStats.find((stat) => stat.label === "S")?.value ?? null;

  const opponentStats = opponentDetail
    ? STAT_ENTRIES.map((entry) => ({
        label: entry.label,
        value: opponentDetail.base_stats[entry.key],
      }))
    : null;
  const opponentSpeBoost = opponentSlot?.boosts.spe ?? 0;
  const speedInfo = buildSpeedComparison(
    mySpeed,
    opponentDetail?.base_stats.spe,
    opponentSpeBoost,
  );

  const opponentAbility =
    opponentSlot?.ability ??
    (opponentSlot?.wasSentOut &&
    opponentDetail &&
    opponentDetail.abilities.normal.length === 1 &&
    !opponentDetail.abilities.hidden
      ? opponentDetail.abilities.normal[0]?.name ?? null
      : null);
  const opponentBoosts = opponentSlot ? formatBoosts(opponentSlot.boosts) : null;
  const selectedDamageResult =
    opponentSlot?.pokemonId != null
      ? damageResults.find(
          (result) => result.defender_species_id === opponentSlot.pokemonId,
        ) ?? null
      : null;

  const speedVerdictLabel =
    speedInfo == null
      ? null
      : speedInfo.verdict === "faster"
        ? "自分が上"
        : speedInfo.verdict === "slower"
          ? "相手が上"
          : "判定不能";

  return (
    <div className="battle-info-overlay">
      <div className="battle-info-overlay__card">
        <div className="battle-info-overlay__sides">
          {mySlot ? (
            <section className="battle-info-overlay__side">
              <div className="battle-info-overlay__section-label">自分</div>
              <div className="battle-info-overlay__header">
                <PokemonSprite pokemonId={mySlot.pokemonId} size={48} />
                <div className="battle-info-overlay__header-main">
                  <div className="battle-info-overlay__name">
                    {mySlot.name ?? "???"}
                  </div>
                  <div className="battle-info-overlay__meta">
                    {fieldToText(mySlot.fields["特性"]) && (
                      <span className="battle-info-overlay__tag">
                        {fieldToText(mySlot.fields["特性"])}
                      </span>
                    )}
                    {fieldToText(mySlot.fields["もちもの"]) && (
                      <span className="battle-info-overlay__tag battle-info-overlay__tag--item">
                        {fieldToText(mySlot.fields["もちもの"])}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <StatGrid stats={myStats} />
            </section>
          ) : (
            <SidePlaceholder title="自分" message="自分ポケモンを選択" />
          )}

          {opponentSlot ? (
            <section className="battle-info-overlay__side">
              <div className="battle-info-overlay__section-label">相手</div>
              <div className="battle-info-overlay__header">
                <PokemonSprite pokemonId={opponentSlot.pokemonId} size={48} />
                <div className="battle-info-overlay__header-main">
                  <div className="battle-info-overlay__name">
                    {opponentSlot.name ?? "???"}
                  </div>
                  <div className="battle-info-overlay__meta">
                    {opponentSlot.hpPercent != null && (
                      <span className="battle-info-overlay__tag battle-info-overlay__tag--hp">
                        HP {opponentSlot.hpPercent}%
                      </span>
                    )}
                    {opponentAbility && (
                      <span className="battle-info-overlay__tag">
                        {opponentAbility}
                      </span>
                    )}
                    {opponentSlot.item && (
                      <span className="battle-info-overlay__tag battle-info-overlay__tag--item">
                        {opponentSlot.item}
                      </span>
                    )}
                    {opponentBoosts && (
                      <span className="battle-info-overlay__tag battle-info-overlay__tag--boost">
                        {opponentBoosts}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {opponentStats ? (
                <StatGrid stats={opponentStats} />
              ) : (
                <div className="battle-info-overlay__placeholder">
                  比較データ不足
                </div>
              )}
            </section>
          ) : (
            <SidePlaceholder title="相手" message="相手ポケモンを選択" />
          )}
        </div>

        <section className="battle-info-overlay__section">
          <div className="battle-info-overlay__section-label">すばやさ比較</div>
          {speedInfo ? (
            <div
              className={`battle-info-overlay__speed battle-info-overlay__speed--${speedInfo.verdict}`}
            >
              <span className="battle-info-overlay__speed-value">
                自分 {speedInfo.mySpeed}
              </span>
              <span className="battle-info-overlay__speed-arrow">⇔</span>
              <span className="battle-info-overlay__speed-value">
                相手{" "}
                {speedInfo.minSpeed === speedInfo.maxSpeed
                  ? speedInfo.minSpeed
                  : `${speedInfo.minSpeed}-${speedInfo.maxSpeed}`}
                {opponentSpeBoost !== 0 && (
                  <span className="battle-info-overlay__speed-boost">
                    {opponentSpeBoost > 0 ? "+" : ""}
                    {opponentSpeBoost}
                  </span>
                )}
              </span>
              <span className="battle-info-overlay__speed-verdict">
                {speedVerdictLabel}
              </span>
            </div>
          ) : (
            <div className="battle-info-overlay__placeholder">
              比較データ不足
            </div>
          )}
        </section>

        <DamageSection
          loading={damageLoading}
          error={damageError}
          result={selectedDamageResult}
          mySelected={mySlot != null}
          opponentSelected={opponentSlot != null}
        />
      </div>
    </div>
  );
}
