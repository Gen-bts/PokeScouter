import { type ReactNode, useMemo, useRef } from "react";
import Draggable from "react-draggable";
import { useBattleTurnStore } from "../stores/useBattleTurnStore";
import { useMatchLogStore } from "../stores/useMatchLogStore";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useFieldStateStore } from "../stores/useFieldStateStore";
import { useIncomingDamageStore } from "../stores/useIncomingDamageStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import {
  useOpponentTeamStore,
  getEffectivePokemonKey,
  type DefensePreset,
  type OffensePreset,
  type NatureBoostStat,
} from "../stores/useOpponentTeamStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { usePokemonDetail } from "../hooks/usePokemonDetail";
import { getKoClass, getKoLabel } from "../utils/damageFormat";
import { buildSpeedComparison, fieldToInt, fieldToKey } from "../utils/speed";
import { PokemonSprite } from "./PokemonSprite";
import { MoveInfoChip } from "./MoveInfoChip";
import { DebugDamageTooltip } from "./DebugDamageTooltip";
import type { StatusMoveEntry } from "../stores/useIncomingDamageStore";
import type {
  DefenderDamageResult,
  MoveDamageResult,
  SpeedContext,
  ValidatedField,
} from "../types";

/** 相手ポケモンごとに、マッチログ上で使用が判明した技名を集約する */
function useOpponentMovesFromLog(): Map<string, string[]> {
  const entryCount = useMatchLogStore((s) => s.entries.length);
  return useMemo(() => {
    const entries = useMatchLogStore.getState().entries;
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
  }, [entryCount]);
}

const ABILITY_FIELD = "特性";
const ITEM_FIELD = "もちもの";

const STAT_ENTRIES = [
  { key: "hp", label: "HP", myField: "HP実数値", evField: "HP努力値" },
  { key: "atk", label: "A", myField: "こうげき実数値", evField: "こうげき努力値" },
  { key: "def", label: "B", myField: "ぼうぎょ実数値", evField: "ぼうぎょ努力値" },
  { key: "spa", label: "C", myField: "とくこう実数値", evField: "とくこう努力値" },
  { key: "spd", label: "D", myField: "とくぼう実数値", evField: "とくぼう努力値" },
  { key: "spe", label: "S", myField: "すばやさ実数値", evField: "すばやさ努力値" },
] as const;

const BOOST_LABELS: Record<string, string> = {
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
  accuracy: "ACC",
  evasion: "EVA",
};

function readText(field: ValidatedField | undefined): string | null {
  if (!field) return null;
  return field.validated ?? field.raw ?? null;
}

function formatBoosts(boosts: Record<string, number>): string | null {
  const parts = Object.entries(boosts)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${BOOST_LABELS[key] ?? key}${value > 0 ? "+" : ""}${value}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

function buildPlayerContext(
  slot: ReturnType<typeof useMyPartyStore.getState>["slots"][number] | null,
  actualSpeed: number | null,
  speedStatPoints: number | null,
  tailwind: boolean,
): SpeedContext | null {
  if (!slot) return null;

  const baseSpeed =
    slot.megaForm?.base_stats.spe != null
      ? slot.megaForm.base_stats.spe - (slot.megaForm.stat_deltas?.spe ?? 0)
      : null;

  return {
    pokemonKey: slot.pokemonId,
    name: slot.name,
    actualSpeed,
    speedStatPoints,
    baseSpeed,
    speBoost: slot.boosts.spe ?? 0,
    abilityId: fieldToKey(slot.fields[ABILITY_FIELD]),
    itemId: fieldToKey(slot.fields[ITEM_FIELD]),
    itemIdentifier:
      slot.fields[ITEM_FIELD]?.matched_identifier ?? fieldToKey(slot.fields[ITEM_FIELD]),
    tailwind,
    isMegaEvolved: slot.isMegaEvolved,
    megaPokemonKey: slot.megaForm?.pokemon_key ?? null,
    megaBaseSpeed: slot.megaForm?.base_stats.spe ?? null,
  };
}

function buildOpponentContext(
  slot: ReturnType<typeof useOpponentTeamStore.getState>["slots"][number] | null,
  tailwind: boolean,
): SpeedContext | null {
  if (!slot) return null;

  return {
    pokemonKey: slot.pokemonId,
    name: slot.name,
    actualSpeed: null,
    speedStatPoints: null,
    baseSpeed: null,
    speBoost: slot.boosts.spe ?? 0,
    abilityId: slot.abilityId,
    itemId: slot.itemId,
    itemIdentifier: slot.itemIdentifier ?? slot.itemId,
    tailwind,
    isMegaEvolved: slot.activeMegaIndex != null,
    megaPokemonKey:
      slot.activeMegaIndex != null
        ? (slot.megaForms[slot.activeMegaIndex]?.pokemon_key ?? null)
        : null,
    megaBaseSpeed:
      slot.activeMegaIndex != null
        ? (slot.megaForms[slot.activeMegaIndex]?.base_stats.spe ?? null)
        : null,
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
  stats: Array<{
    label: string;
    value: number | null;
    ev: number | null;
    subtitle?: string;
  }>;
}) {
  return (
    <div className="battle-info-overlay__stats">
      {stats.map((stat) => (
        <div key={stat.label} className="battle-info-overlay__stat">
          <span className="battle-info-overlay__stat-label">{stat.label}</span>
          <span className="battle-info-overlay__stat-value">{stat.value ?? "?"}</span>
          {stat.ev != null && stat.ev > 0 && (
            <span className="battle-info-overlay__stat-ev">({stat.ev})</span>
          )}
          {stat.subtitle ? (
            <span className="battle-info-overlay__stat-subtitle" title="行動順から推定した戦闘中のすばやさの範囲">
              {stat.subtitle}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

const DEFENSE_PRESET_OPTIONS: { value: DefensePreset; label: string }[] = [
  { value: "none", label: "無" },
  { value: "h", label: "H" },
  { value: "hb", label: "HB" },
  { value: "hd", label: "HD" },
];

const SP_LABEL_MAP: Record<string, string> = {
  hp: "H",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};

function formatSpString(sp: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }): string {
  const parts: string[] = [];
  for (const k of ["hp", "atk", "def", "spa", "spd", "spe"] as const) {
    if (sp[k] > 0) parts.push(`${SP_LABEL_MAP[k]}${sp[k]}`);
  }
  return parts.length > 0 ? parts.join("/") : "振りなし";
}

const OFFENSE_PRESET_OPTIONS: { value: OffensePreset; label: string }[] = [
  { value: "none", label: "無" },
  { value: "a", label: "A" },
  { value: "c", label: "C" },
];

const NATURE_BOOST_OPTIONS: { value: NatureBoostStat; label: string }[] = [
  { value: null, label: "-" },
  { value: "atk", label: "A" },
  { value: "def", label: "B" },
  { value: "spa", label: "C" },
  { value: "spd", label: "D" },
  { value: "spe", label: "S" },
];

function OpponentPresetSelector({
  position,
  defensePreset,
  offensePreset,
  natureBoostStat,
  hbdRecommendation,
  defensePresetAutoApplied,
}: {
  position: number;
  defensePreset: DefensePreset;
  offensePreset: OffensePreset;
  natureBoostStat: NatureBoostStat;
  hbdRecommendation: import("../stores/useOpponentTeamStore").HbdRecommendation | null;
  defensePresetAutoApplied: boolean;
}) {
  const setDefensePreset = useOpponentTeamStore((s) => s.setDefensePreset);
  const setOffensePreset = useOpponentTeamStore((s) => s.setOffensePreset);
  const setNatureBoostStat = useOpponentTeamStore((s) => s.setNatureBoostStat);

  // HBD 推奨が custom の場合、5 つ目のオプションを動的追加
  const defenseOptions: { value: DefensePreset; label: string }[] = [
    ...DEFENSE_PRESET_OPTIONS,
  ];
  if (hbdRecommendation?.nearestPreset === "custom") {
    defenseOptions.push({ value: "custom", label: "推" });
  }

  const buildHbdTooltip = (): string | null => {
    if (!hbdRecommendation) return null;
    const spStr = formatSpString(hbdRecommendation.sp);
    const stats = hbdRecommendation.stats;
    const statsStr = `H${stats.hp} B${stats.def} D${stats.spd}`;
    const weights = hbdRecommendation.weights;
    const weightStr = `環境重み phys:${(weights.phys * 100).toFixed(0)}% spec:${(weights.spec * 100).toFixed(0)}%`;
    return `推奨配分: ${spStr}\n実数値: ${statsStr}\n${weightStr}`;
  };

  const hbdTooltip = buildHbdTooltip();
  const recommendedValue = hbdRecommendation?.nearestPreset ?? null;

  return (
    <div className="battle-info-overlay__presets">
      <div className="battle-info-overlay__preset-row">
        <span className="battle-info-overlay__preset-label">耐久</span>
        <div className="battle-info-overlay__preset-options">
          {defenseOptions.map((opt) => {
            const isActive = defensePreset === opt.value;
            const isRecommended = recommendedValue === opt.value;
            const showRecommendBadge =
              isRecommended && isActive && defensePresetAutoApplied;
            const title =
              isRecommended && hbdTooltip
                ? `${showRecommendBadge ? "【使用率推定で自動選択】\n" : ""}${hbdTooltip}`
                : undefined;
            return (
              <button
                key={opt.value}
                type="button"
                className={`battle-info-overlay__preset-btn ${isActive ? "battle-info-overlay__preset-btn--active" : ""}${isRecommended ? " battle-info-overlay__preset-btn--recommended" : ""}`}
                onClick={() => setDefensePreset(position, opt.value)}
                title={title}
              >
                {opt.label}
                {showRecommendBadge && (
                  <span
                    className="battle-info-overlay__preset-badge"
                    aria-label="使用率推定で自動選択"
                  >
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="battle-info-overlay__preset-row">
        <span className="battle-info-overlay__preset-label">火力</span>
        <div className="battle-info-overlay__preset-options">
          {OFFENSE_PRESET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`battle-info-overlay__preset-btn ${offensePreset === opt.value ? "battle-info-overlay__preset-btn--active" : ""}`}
              onClick={() => setOffensePreset(position, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="battle-info-overlay__preset-row">
        <span className="battle-info-overlay__preset-label">性格</span>
        <div className="battle-info-overlay__preset-options">
          {NATURE_BOOST_OPTIONS.map((opt) => (
            <button
              key={opt.value ?? "neutral"}
              type="button"
              className={`battle-info-overlay__preset-btn ${natureBoostStat === opt.value ? "battle-info-overlay__preset-btn--active" : ""}`}
              onClick={() => setNatureBoostStat(position, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DamageMoveRow({
  move,
  usagePercent,
  requestBody,
}: {
  move: MoveDamageResult;
  usagePercent?: number;
  requestBody?: Record<string, unknown> | null;
}) {
  return (
    <div className="battle-info-overlay__damage-move">
      <MoveInfoChip
        moveKey={move.move_key}
        moveName={move.move_name}
        className="battle-info-overlay__damage-move-name move-chip-hoverable"
      >
        {move.move_name}
        {usagePercent != null && (
          <span className="battle-info-overlay__damage-usage">
            {usagePercent.toFixed(0)}%
          </span>
        )}
      </MoveInfoChip>
      <DebugDamageTooltip requestBody={requestBody ?? null} moveResult={move}>
        <span
          className={`battle-info-overlay__damage-move-value ${getKoClass(move.guaranteed_ko)}`}
        >
          {move.type_effectiveness === 0
            ? "0% 無効"
            : `${move.min_percent.toFixed(1)}-${move.max_percent.toFixed(1)}%`}
        </span>
      </DebugDamageTooltip>
      <span
        className={`battle-info-overlay__damage-move-ko ${getKoClass(move.guaranteed_ko)}`}
      >
        {getKoLabel(move.guaranteed_ko, move.type_effectiveness)}
      </span>
    </div>
  );
}

function DamageSection({
  label,
  loading,
  error,
  result,
  emptyMessage,
  requestBody,
}: {
  label: string;
  loading: boolean;
  error: string | null;
  result: DefenderDamageResult | null;
  emptyMessage: string;
  requestBody?: Record<string, unknown> | null;
}) {
  let content: ReactNode;

  if (loading && result == null) {
    content = <div className="battle-info-overlay__placeholder">読み込み中...</div>;
  } else if (error) {
    content = (
      <div className="battle-info-overlay__placeholder battle-info-overlay__placeholder--error">
        {error}
      </div>
    );
  } else if (!result) {
    content = <div className="battle-info-overlay__placeholder">{emptyMessage}</div>;
  } else if (result.moves.length === 0) {
    content = <div className="battle-info-overlay__placeholder">技なし</div>;
  } else {
    content = (
      <div className="battle-info-overlay__damage-list">
        {result.moves.map((move) => (
          <DamageMoveRow key={move.move_id} move={move} requestBody={requestBody} />
        ))}
      </div>
    );
  }

  return (
    <section className="battle-info-overlay__section">
      <div className="battle-info-overlay__section-label">{label}</div>
      {content}
    </section>
  );
}

/** 被ダメージ用: ダメージ結果・使用率・確定技・変化技をマージした表示行 */
interface IncomingDisplayRow {
  key: string;
  move_name: string;
  isKnown: boolean;
  usagePercent?: number | null;
  isStatus: boolean;
  damageResult?: MoveDamageResult;
}

function buildIncomingDisplayRows(
  result: DefenderDamageResult | null,
  usagePercentMap: Record<string, number | null>,
  knownMoveKeys: string[],
  statusMoves: StatusMoveEntry[],
): IncomingDisplayRow[] {
  const knownSet = new Set(knownMoveKeys);
  const statusSet = new Set(statusMoves.map((m) => m.move_key));

  // ダメージ結果を move_key でマップ化
  const resultMap = new Map<string, MoveDamageResult>();
  if (result) {
    for (const m of result.moves) {
      resultMap.set(m.move_key, m);
    }
  }

  const rows: IncomingDisplayRow[] = [];
  const seen = new Set<string>();

  // 1. usage 技（変化技含む）を順に処理
  for (const [moveKey, usagePercent] of Object.entries(usagePercentMap)) {
    seen.add(moveKey);
    const isStatus = statusSet.has(moveKey);
    rows.push({
      key: moveKey,
      move_name:
        resultMap.get(moveKey)?.move_name ??
        statusMoves.find((s) => s.move_key === moveKey)?.move_name ??
        moveKey,
      isKnown: knownSet.has(moveKey),
      usagePercent,
      isStatus,
      damageResult: resultMap.get(moveKey),
    });
  }

  // 2. known 技で usage に無いもの
  for (const moveKey of knownMoveKeys) {
    if (seen.has(moveKey)) continue;
    seen.add(moveKey);
    const dmg = resultMap.get(moveKey);
    const isStatus = statusSet.has(moveKey) || (!dmg && !resultMap.has(moveKey));
    rows.push({
      key: moveKey,
      move_name:
        dmg?.move_name ??
        statusMoves.find((s) => s.move_key === moveKey)?.move_name ??
        moveKey,
      isKnown: true,
      isStatus,
      damageResult: dmg,
    });
  }

  // 3. calc 結果にあるが usage にも known にもない技（レアケース）
  for (const [moveKey, dmg] of resultMap) {
    if (seen.has(moveKey)) continue;
    rows.push({
      key: moveKey,
      move_name: dmg.move_name,
      isKnown: false,
      isStatus: false,
      damageResult: dmg,
    });
  }

  // ソート: 確定技を上部 → 残りを usage_percent 降順
  rows.sort((a, b) => {
    if (a.isKnown !== b.isKnown) return a.isKnown ? -1 : 1;
    return (b.usagePercent ?? 0) - (a.usagePercent ?? 0);
  });

  return rows;
}

function IncomingDamageSection({
  loading,
  error,
  result,
  emptyMessage,
  usagePercentMap,
  knownMoveKeys,
  statusMoves,
  requestBody,
}: {
  loading: boolean;
  error: string | null;
  result: DefenderDamageResult | null;
  emptyMessage: string;
  usagePercentMap: Record<string, number>;
  knownMoveKeys: string[];
  statusMoves: StatusMoveEntry[];
  requestBody?: Record<string, unknown> | null;
}) {
  const hasAnyData =
    result != null ||
    Object.keys(usagePercentMap).length > 0 ||
    statusMoves.length > 0;

  let content: ReactNode;

  if (loading && !hasAnyData) {
    content = <div className="battle-info-overlay__placeholder">読み込み中...</div>;
  } else if (error) {
    content = (
      <div className="battle-info-overlay__placeholder battle-info-overlay__placeholder--error">
        {error}
      </div>
    );
  } else if (!hasAnyData) {
    content = <div className="battle-info-overlay__placeholder">{emptyMessage}</div>;
  } else {
    const rows = buildIncomingDisplayRows(
      result,
      usagePercentMap,
      knownMoveKeys,
      statusMoves,
    );
    if (rows.length === 0) {
      content = <div className="battle-info-overlay__placeholder">技なし</div>;
    } else {
      content = (
        <div className="battle-info-overlay__damage-list">
          {rows.map((row) => (
            <div key={row.key} className="battle-info-overlay__damage-move">
              <MoveInfoChip
                moveKey={row.key}
                moveName={row.move_name}
                className="battle-info-overlay__damage-move-name move-chip-hoverable"
              >
                {row.isKnown && (
                  <span className="battle-info-overlay__damage-known-marker">
                    ★
                  </span>
                )}
                {row.move_name}
                {row.usagePercent != null && (
                  <span className="battle-info-overlay__damage-usage">
                    {row.usagePercent.toFixed(0)}%
                  </span>
                )}
              </MoveInfoChip>
              {row.isStatus ? (
                <>
                  <span className="battle-info-overlay__damage-move-value dmg-status">
                    変化技
                  </span>
                  <span className="battle-info-overlay__damage-move-ko dmg-status">
                    —
                  </span>
                </>
              ) : row.damageResult ? (
                <>
                  <DebugDamageTooltip requestBody={requestBody ?? null} moveResult={row.damageResult}>
                    <span
                      className={`battle-info-overlay__damage-move-value ${getKoClass(row.damageResult.guaranteed_ko)}`}
                    >
                      {row.damageResult.type_effectiveness === 0
                        ? "0% 無効"
                        : `${row.damageResult.min_percent.toFixed(1)}-${row.damageResult.max_percent.toFixed(1)}%`}
                    </span>
                  </DebugDamageTooltip>
                  <span
                    className={`battle-info-overlay__damage-move-ko ${getKoClass(row.damageResult.guaranteed_ko)}`}
                  >
                    {getKoLabel(
                      row.damageResult.guaranteed_ko,
                      row.damageResult.type_effectiveness,
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span className="battle-info-overlay__damage-move-value">—</span>
                  <span className="battle-info-overlay__damage-move-ko">—</span>
                </>
              )}
            </div>
          ))}
        </div>
      );
    }
  }

  return (
    <section className="battle-info-overlay__section">
      <div className="battle-info-overlay__section-label">被ダメージ (使用率)</div>
      {content}
    </section>
  );
}

interface Props {
  currentScene: string;
}

export function BattleInfoOverlay({ currentScene }: Props) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const pos = useSettingsStore((s) => s.battleInfoPosition);
  const setPos = useSettingsStore((s) => s.setBattleInfoPosition);

  const attackerPosition = useDamageCalcStore((state) => state.selectedAttackerPosition);
  const damageResults = useDamageCalcStore((state) => state.results);
  const damageLoading = useDamageCalcStore((state) => state.loading);
  const damageError = useDamageCalcStore((state) => state.error);
  const damageRequestBody = useDamageCalcStore((state) => state.lastRequestBody);

  const incomingResults = useIncomingDamageStore((state) => state.results);
  const incomingLoading = useIncomingDamageStore((state) => state.loading);
  const incomingError = useIncomingDamageStore((state) => state.error);
  const incomingUsagePercentMap = useIncomingDamageStore((state) => state.usagePercentMap);
  const incomingKnownMoveKeys = useIncomingDamageStore((state) => state.knownMoveKeys);
  const incomingStatusMoves = useIncomingDamageStore((state) => state.statusMoves);
  const incomingRequestBody = useIncomingDamageStore((state) => state.lastRequestBody);

  const weather = useFieldStateStore((state) => state.weather);
  const terrain = useFieldStateStore((state) => state.terrain);
  const trickRoom = useFieldStateStore((state) => state.trickRoom);
  const playerTailwind = useFieldStateStore((state) => state.playerSide.tailwind);
  const opponentTailwind = useFieldStateStore((state) => state.opponentSide.tailwind);

  const currentTurn = useBattleTurnStore((state) => state.currentTurn);
  const lastResolvedTurn = useBattleTurnStore((state) => state.lastResolvedTurn);

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
  const effectiveOpponentKey = opponentSlot ? getEffectivePokemonKey(opponentSlot) : null;

  const opponentMovesBySpecies = useOpponentMovesFromLog();
  const { detail: opponentDetail } = usePokemonDetail(effectiveOpponentKey);

  const logRevealedOpponentMoves =
    effectiveOpponentKey != null
      ? opponentMovesBySpecies.get(effectiveOpponentKey)
      : undefined;

  const myStats = STAT_ENTRIES.map((entry) => ({
    label: entry.label,
    value: fieldToInt(mySlot?.fields[entry.myField]),
    ev: fieldToInt(mySlot?.fields[entry.evField]),
  }));
  const mySpeed = myStats.find((stat) => stat.label === "S")?.value ?? null;
  const mySpeedStatPoints =
    fieldToInt(mySlot?.fields[STAT_ENTRIES[5].evField]) ?? null;

  const playerContext = buildPlayerContext(
    mySlot,
    mySpeed,
    mySpeedStatPoints,
    playerTailwind,
  );
  const opponentContext = buildOpponentContext(opponentSlot, opponentTailwind);
  const inferredBounds = opponentSlot?.inferredSpeedBounds ?? null;
  const speedInfo = buildSpeedComparison(
    playerContext,
    opponentDetail?.base_stats.spe,
    opponentContext,
    {
      weather,
      terrain,
      trickRoom,
      playerTailwind,
      opponentTailwind,
    },
    inferredBounds,
  );

  const opponentStats = opponentDetail
    ? STAT_ENTRIES.map((entry) => {
        if (entry.key === "spe" && speedInfo?.narrowed) {
          return {
            label: entry.label,
            value: opponentDetail.base_stats[entry.key],
            ev: null,
            subtitle:
              speedInfo.minSpeed === speedInfo.maxSpeed
                ? `実数値≈${speedInfo.minSpeed}`
                : `実数値 ${speedInfo.minSpeed}〜${speedInfo.maxSpeed}`,
          };
        }
        return {
          label: entry.label,
          value: opponentDetail.base_stats[entry.key],
          ev: null,
        };
      })
    : null;

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
    effectiveOpponentKey != null
      ? damageResults.find(
          (result) => result.defender_species_id === effectiveOpponentKey,
        ) ?? null
      : null;

  const selectedIncomingResult =
    mySlot?.pokemonId != null
      ? incomingResults.find(
          (result) => result.defender_species_id === mySlot.pokemonId,
        ) ?? null
      : null;

  const currentTurnSummary = currentTurn
    ? `ターン${currentTurn.turnId} / ${currentTurn.phase} / 行動 ${
        currentTurn.playerAction ? "P" : "-"
      }-${currentTurn.opponentAction ? "O" : "-"}`
    : "ターンなし";
  const lastTurnSummary = lastResolvedTurn
    ? `ターン${lastResolvedTurn.turnId} / ${lastResolvedTurn.status} / ${
        lastResolvedTurn.firstMover ?? "順序不明"
      } / ${
        lastResolvedTurn.inferenceApplied
          ? "推定適用"
          : lastResolvedTurn.inferenceNote ?? "推定なし"
      }`
    : "解決済みターンなし";

  const speedVerdictLabel =
    speedInfo == null
      ? null
      : speedInfo.verdict === "faster"
        ? "自分が先"
        : speedInfo.verdict === "slower"
          ? "相手が先"
          : "同速帯";

  return (
    <Draggable
      nodeRef={nodeRef}
      position={pos}
      positionOffset={{ x: "-50%", y: 0 }}
      onStop={(_event, data) => setPos({ x: data.x, y: data.y })}
    >
      <div ref={nodeRef} className="battle-info-overlay">
        <div className="battle-info-overlay__card">
          <div className="battle-info-overlay__sides">
            {mySlot ? (
              <section className="battle-info-overlay__side">
                <div className="battle-info-overlay__section-label">自分</div>
                <div className="battle-info-overlay__header">
                  <PokemonSprite pokemonId={mySlot.pokemonId} size={48} />
                  <div className="battle-info-overlay__header-main">
                    <div className="battle-info-overlay__name">{mySlot.name ?? "???"}</div>
                    <div className="battle-info-overlay__meta">
                      {readText(mySlot.fields[ABILITY_FIELD]) && (
                        <span className="battle-info-overlay__tag">
                          {readText(mySlot.fields[ABILITY_FIELD])}
                        </span>
                      )}
                      {readText(mySlot.fields[ITEM_FIELD]) && (
                        <span className="battle-info-overlay__tag battle-info-overlay__tag--item">
                          {readText(mySlot.fields[ITEM_FIELD])}
                        </span>
                      )}
                      {formatBoosts(mySlot.boosts) && (
                        <span className="battle-info-overlay__tag battle-info-overlay__tag--boost">
                          {formatBoosts(mySlot.boosts)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <StatGrid stats={myStats} />
              </section>
            ) : (
              <SidePlaceholder title="自分" message="アタッカーを選択" />
            )}

            {opponentSlot ? (
              <section className="battle-info-overlay__side">
                <div className="battle-info-overlay__section-label">相手</div>
                <div className="battle-info-overlay__header">
                  <PokemonSprite pokemonId={effectiveOpponentKey} size={48} />
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
                        <span className="battle-info-overlay__tag">{opponentAbility}</span>
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
                {logRevealedOpponentMoves && logRevealedOpponentMoves.length > 0 && (
                  <div className="battle-info-overlay__revealed-moves">
                    <span className="battle-info-overlay__revealed-moves-label">
                      ログ判明の技
                    </span>
                    <span>{logRevealedOpponentMoves.join(" / ")}</span>
                  </div>
                )}
                {opponentStats ? (
                  <StatGrid stats={opponentStats} />
                ) : (
                  <div className="battle-info-overlay__placeholder">詳細データなし</div>
                )}
                {displaySelectedPosition != null && (
                  <OpponentPresetSelector
                    position={displaySelectedPosition}
                    defensePreset={opponentSlot.defensePreset}
                    offensePreset={opponentSlot.offensePreset}
                    natureBoostStat={opponentSlot.natureBoostStat}
                    hbdRecommendation={opponentSlot.hbdRecommendation}
                    defensePresetAutoApplied={opponentSlot.defensePresetAutoApplied}
                  />
                )}
              </section>
            ) : (
              <SidePlaceholder title="相手" message="相手を選択" />
            )}
          </div>

          <section className="battle-info-overlay__section">
            <div className="battle-info-overlay__section-label">ターン</div>
            <div className="battle-info-overlay__meta">
              <span className="battle-info-overlay__tag">{currentTurnSummary}</span>
              <span className="battle-info-overlay__tag">{lastTurnSummary}</span>
            </div>
          </section>

          <div className="battle-info-overlay__damage-columns">
            <div className="battle-info-overlay__damage-col-left">
              <section className="battle-info-overlay__section">
                <div className="battle-info-overlay__section-label">すばやさ</div>
                {speedInfo ? (
                  <div
                    className={`battle-info-overlay__speed battle-info-overlay__speed--${speedInfo.verdict}`}
                  >
                    <span className="battle-info-overlay__speed-value">
                      自分 {speedInfo.mySpeed}
                    </span>
                    <span className="battle-info-overlay__speed-arrow">vs</span>
                    <span className="battle-info-overlay__speed-value">
                      相手{" "}
                      {speedInfo.minSpeed === speedInfo.maxSpeed
                        ? speedInfo.minSpeed
                        : `${speedInfo.minSpeed}-${speedInfo.maxSpeed}`}
                      {speedInfo.narrowed && (
                        <span
                          className="battle-info-overlay__speed-narrowed"
                          title="観測された行動順による推定"
                        >
                          *
                        </span>
                      )}
                    </span>
                    <span className="battle-info-overlay__speed-verdict">
                      {speedVerdictLabel}
                    </span>
                  </div>
                ) : (
                  <div className="battle-info-overlay__placeholder">すばやさ情報なし</div>
                )}
              </section>

              <DamageSection
                label="与ダメージ"
                loading={damageLoading}
                error={damageError}
                result={selectedDamageResult}
                emptyMessage="自分と相手を選択してください"
                requestBody={damageRequestBody}
              />
            </div>

            <IncomingDamageSection
              loading={incomingLoading}
              error={incomingError}
              result={selectedIncomingResult}
              emptyMessage="自分を選択してください"
              usagePercentMap={incomingUsagePercentMap}
              knownMoveKeys={incomingKnownMoveKeys}
              statusMoves={incomingStatusMoves}
              requestBody={incomingRequestBody}
            />
          </div>
        </div>
      </div>
    </Draggable>
  );
}
