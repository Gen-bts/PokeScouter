import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTooltipClamp } from "../hooks/useTooltipClamp";
import {
  getEffectivePokemonKey,
  useOpponentTeamStore,
  type OpponentSlot,
} from "../stores/useOpponentTeamStore";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import { useMyPartyStore } from "../stores/useMyPartyStore";
import { useFieldStateStore } from "../stores/useFieldStateStore";
import { buildSpeedComparison, fieldToInt, fieldToKey } from "../utils/speed";
import { usePokemonNames } from "../hooks/usePokemonNames";
import { usePokemonDetail, type PokemonDetail } from "../hooks/usePokemonDetail";
import { PokemonSprite } from "./PokemonSprite";
import { ItemSprite } from "./ItemSprite";
import { MoveInfoChip } from "./MoveInfoChip";
import { TypeConsistencyPanel } from "./TypeConsistencyPanel";
import { TypeBadge } from "./TypeBadge";
import { TypeEffectivenessSection, formatMultiplier } from "./TypeEffectivenessSection";
import type { MegaFormDetail, PokemonCandidate, TypeConsistencyEntry } from "../types";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useMatchLogStore } from "../stores/useMatchLogStore";

const STAT_LABELS: Record<string, string> = {
  hp: "HP", atk: "こうげき", def: "ぼうぎょ",
  spa: "とくこう", spd: "とくぼう", spe: "すばやさ",
};

const STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"] as const;

function getEffClass(eff: number): string {
  if (eff === 0) return "immune";
  if (eff < 1) return "resist";
  if (eff === 1) return "neutral";
  if (eff >= 4) return "super4";
  return "super2";
}

function AbilityWithTooltip({ name, effect, effectEn, isHidden }: { name: string; effect?: string; effectEn?: string; isHidden?: boolean }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; arrowLeft: number; placement: "top" | "bottom" } | null>(null);

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    setPos(null);
  }, []);

  useLayoutEffect(() => {
    if (!hovered || !triggerRef.current || !tooltipRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const tip = tooltipRef.current;
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    const padding = 8;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const anchorCenterX = anchor.left + anchor.width / 2;

    let placement: "top" | "bottom" = "top";
    let top = anchor.top - gap - tipH;
    if (top < padding) {
      const belowTop = anchor.bottom + gap;
      if (belowTop + tipH <= vh - padding) {
        placement = "bottom";
        top = belowTop;
      } else {
        top = Math.max(padding, Math.min(top, vh - tipH - padding));
      }
    }

    let left = anchorCenterX - tipW / 2;
    left = Math.max(padding, Math.min(left, vw - tipW - padding));

    const arrowLeft = Math.max(8, Math.min(tipW - 8, anchorCenterX - left));

    setPos({ top, left, arrowLeft, placement });
  }, [hovered, name, effect, effectEn]);

  const showEnLine = effectEn && effectEn !== effect;

  return (
    <span
      ref={triggerRef}
      className={`opponent-tooltip-ability${isHidden ? " opponent-tooltip-ability-hidden" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {name}
      {isHidden && <span className="opponent-tooltip-hidden-tag">夢</span>}
      {effect && hovered && createPortal(
        <span
          ref={tooltipRef}
          className="ability-desc-tooltip ability-desc-tooltip-visible"
          data-placement={pos?.placement ?? "top"}
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? "visible" : "hidden",
            ["--arrow-left" as string]: pos ? `${pos.arrowLeft}px` : "50%",
          } as CSSProperties}
        >
          {effect}
          {showEnLine && <span className="ability-desc-tooltip-en">{effectEn}</span>}
          <span className="ability-desc-tooltip-arrow" />
        </span>,
        document.body
      )}
    </span>
  );
}

function OpponentMegaSection({ megaForm }: { megaForm: MegaFormDetail }) {
  return (
    <div className="tooltip-section mega-section">
      <div className="mega-header">
        <span className="mega-name">{megaForm.mega_name}</span>
        <span className="mega-types">
          {megaForm.types.map((t) => (
            <TypeBadge key={t} type={t} size="sm" />
          ))}
        </span>
      </div>
      {megaForm.ability.name && (
        <div className="opponent-tooltip-abilities">
          <AbilityWithTooltip name={megaForm.ability.name} effect={megaForm.ability.effect} effectEn={megaForm.ability.effect_en} />
        </div>
      )}
      <div className="mega-stats-grid">
        {STAT_ORDER.map((key) => {
          const val = megaForm.base_stats[key];
          const delta = megaForm.stat_deltas?.[key];
          return (
            <span key={key} className="tooltip-stat-label">
              {STAT_LABELS[key]}
              <span className="tooltip-stat-value">{val ?? "?"}</span>
              <span
                className={`mega-stat-delta${
                  delta != null && delta > 0
                    ? " stat-delta-up"
                    : delta != null && delta < 0
                      ? " stat-delta-down"
                      : ""
                }`}
              >
                {delta != null && delta !== 0
                  ? delta > 0
                    ? `+${delta}`
                    : `${delta}`
                  : ""}
              </span>
            </span>
          );
        })}
      </div>
      {megaForm.type_effectiveness && (
        <TypeEffectivenessSection typeEffectiveness={megaForm.type_effectiveness} />
      )}
    </div>
  );
}

function OpponentTooltipContent({
  detail,
  speedBattleTooltipLine,
}: {
  detail: PokemonDetail;
  speedBattleTooltipLine?: string | null;
}) {
  return (
    <>
      {/* タイプ */}
      <div className="opponent-tooltip-types">
        {detail.types.map((t) => (
          <TypeBadge key={t} type={t} />
        ))}
      </div>

      {/* とくせい */}
      <div className="tooltip-section">
        <div className="tooltip-section-label">とくせい</div>
        <div className="opponent-tooltip-abilities">
          {detail.abilities.normal.map((a) => (
            <AbilityWithTooltip key={a.name} name={a.name} effect={a.effect} effectEn={a.effect_en} />
          ))}
          {detail.abilities.hidden && (
            <AbilityWithTooltip
              name={detail.abilities.hidden.name}
              effect={detail.abilities.hidden.effect}
              effectEn={detail.abilities.hidden.effect_en}
              isHidden
            />
          )}
        </div>
      </div>

      {/* 種族値 */}
      <div className="tooltip-section">
        <div className="tooltip-section-label">種族値</div>
        <div className="tooltip-stats-grid">
          {STAT_ORDER.map((key) => {
            const val = detail.base_stats[key];
            return (
              <span key={key} className="tooltip-stat-label">
                {STAT_LABELS[key]}
                <span className="tooltip-stat-value">{val}</span>
              </span>
            );
          })}
        </div>
      </div>

      {speedBattleTooltipLine ? (
        <div className="tooltip-section">
          <div className="tooltip-section-label">すばやさ（行動順推定）</div>
          <div className="opponent-tooltip-speed-inferred">{speedBattleTooltipLine}</div>
        </div>
      ) : null}

      {/* タイプ相性 */}
      <TypeEffectivenessSection typeEffectiveness={detail.type_effectiveness} />
      {/* メガシンカ */}
      {detail.mega_forms?.map((mf) => (
        <OpponentMegaSection key={mf.item_key} megaForm={mf} />
      ))}
    </>
  );
}

function PokemonAutocomplete({
  position,
  onClose,
}: {
  position: number;
  onClose: () => void;
}) {
  const { names } = usePokemonNames({ championsOnly: true });
  const manualSet = useOpponentTeamStore((s) => s.manualSet);
  const sendSetOpponentPokemon = useConnectionStore((s) => s.sendSetOpponentPokemon);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const candidates = useMemo(() => {
    if (query.length < 2) return [];
    // ひらがな→カタカナ変換（ポケモン名はカタカナ）
    const katakana = query.replace(/[\u3041-\u3096]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60),
    );
    const q = katakana.toLowerCase();
    const results: Array<{ name: string; id: string }> = [];
    for (const [name, id] of Object.entries(names)) {
      if (name.toLowerCase().includes(q)) {
        results.push({ name, id });
        if (results.length >= 10) break;
      }
    }
    return results;
  }, [query, names]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [candidates.length]);

  const select = useCallback(
    (name: string, id: string) => {
      const oldSlot = useOpponentTeamStore.getState().slots[position - 1];
      useMatchLogStore.getState().addPokemonCorrection(
        position,
        oldSlot?.pokemonId ?? null,
        oldSlot?.name ?? null,
        oldSlot ? oldSlot.confidence : null,
        id,
        name,
        "manual_input",
      );
      manualSet(position, id, name);
      sendSetOpponentPokemon(position, id, name);
      onClose();
    },
    [position, manualSet, sendSetOpponentPokemon, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && candidates.length > 0) {
      e.preventDefault();
      const c2 = candidates[selectedIdx];
      if (c2) select(c2.name, c2.id);
    }
  };

  // 選択中のアイテムが見えるようにスクロール
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  return (
    <div
      className="opponent-autocomplete"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        className="opponent-autocomplete-input"
        placeholder="ポケモン名を入力..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          // ドロップダウン内クリック時は閉じない
          if (e.relatedTarget?.closest(".opponent-autocomplete-list")) return;
          setTimeout(onClose, 150);
        }}
      />
      {candidates.length > 0 && (
        <ul className="opponent-autocomplete-list" ref={listRef}>
          {candidates.map((c, i) => (
            <li
              key={c.id}
              className={i === selectedIdx ? "selected" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(c.name, c.id)}
            >
              <img
                className="opponent-autocomplete-thumb"
                src={`/sprites/${c.id}.png`}
                alt=""
                width={32}
                height={32}
              />
              <span>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateSelector({
  position,
  candidates,
  onClose,
  onManualInput,
}: {
  position: number;
  candidates: PokemonCandidate[];
  onClose: () => void;
  onManualInput: () => void;
}) {
  const manualSet = useOpponentTeamStore((s) => s.manualSet);
  const sendSetOpponentPokemon = useConnectionStore((s) => s.sendSetOpponentPokemon);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 手動入力は candidates.length 番目のインデックス
  const totalItems = candidates.length + 1;

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const select = useCallback(
    (c: PokemonCandidate) => {
      const oldSlot = useOpponentTeamStore.getState().slots[position - 1];
      useMatchLogStore.getState().addPokemonCorrection(
        position,
        oldSlot?.pokemonId ?? null,
        oldSlot?.name ?? null,
        oldSlot ? oldSlot.confidence : null,
        c.pokemon_id,
        c.name,
        "candidate",
      );
      manualSet(position, c.pokemon_id, c.name);
      sendSetOpponentPokemon(position, c.pokemon_id, c.name);
      onClose();
    },
    [position, manualSet, sendSetOpponentPokemon, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIdx < candidates.length) {
        const c = candidates[selectedIdx];
        if (c) select(c);
      } else {
        onManualInput();
      }
    }
  };

  return (
    <div
      className="opponent-candidates"
      ref={listRef}
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        if (e.relatedTarget?.closest(".opponent-candidates")) return;
        setTimeout(onClose, 150);
      }}
    >
      {candidates.map((c, i) => (
        <div
          key={c.pokemon_id}
          className={`opponent-candidate-row${i === selectedIdx ? " selected" : ""}`}
          onMouseEnter={() => setSelectedIdx(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => select(c)}
        >
          <img
            className="opponent-autocomplete-thumb"
            src={`/sprites/${c.pokemon_id}.png`}
            alt=""
            width={32}
            height={32}
          />
          <span className="opponent-candidate-name">{c.name}</span>
          <span className="opponent-candidate-confidence">
            {(c.confidence * 100).toFixed(0)}%
          </span>
        </div>
      ))}
      <div className="opponent-candidate-divider" />
      <div
        className={`opponent-candidate-row opponent-candidate-manual-btn${selectedIdx === candidates.length ? " selected" : ""}`}
        onMouseEnter={() => setSelectedIdx(candidates.length)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onManualInput}
      >
        <span>手動入力...</span>
      </div>
    </div>
  );
}

const SlotRow = memo(function SlotRow({
  slot,
  isTooltipActive,
  setActiveTooltip,
  closeTimerRef,
  hoveredTypeEntry,
  isDisplaySelected,
  onSelectDisplayTarget,
}: {
  slot: OpponentSlot;
  isTooltipActive: boolean;
  setActiveTooltip: (position: number | null) => void;
  closeTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  hoveredTypeEntry: TypeConsistencyEntry | null;
  isDisplaySelected: boolean;
  onSelectDisplayTarget: (position: number) => void;
}) {
  const [editing, setEditing] = useState<false | "candidates" | "manual">(
    false,
  );
  const slotRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; right: number } | null>(null);
  const attackerPos = useDamageCalcStore((s) => s.selectedAttackerPosition);
  const partySlots = useMyPartyStore((s) => s.slots);
  const mySlot = attackerPos != null ? partySlots[attackerPos - 1] ?? null : null;
  const weather = useFieldStateStore((s) => s.weather);
  const terrain = useFieldStateStore((s) => s.terrain);
  const trickRoom = useFieldStateStore((s) => s.trickRoom);
  const playerTailwind = useFieldStateStore((s) => s.playerSide.tailwind);
  const opponentTailwind = useFieldStateStore((s) => s.opponentSide.tailwind);

  const effectiveKey = getEffectivePokemonKey(slot);
  const { detail } = usePokemonDetail(effectiveKey);
  const setSlotMegaForms = useOpponentTeamStore((s) => s.setSlotMegaForms);

  const speedBattleTooltipLine = useMemo(() => {
    if (!detail || slot.pokemonId == null || slot.inferredSpeedBounds == null) {
      return null;
    }
    const mySpeed = fieldToInt(mySlot?.fields["すばやさ実数値"]);
    const mySpeedStatPoints = fieldToInt(mySlot?.fields["すばやさ努力値"]);
    const playerBaseSpeed =
      mySlot?.megaForm?.base_stats.spe != null
        ? mySlot.megaForm.base_stats.spe - (mySlot.megaForm.stat_deltas?.spe ?? 0)
        : null;
    const playerContext = mySlot
      ? {
          pokemonKey: mySlot.pokemonId,
          name: mySlot.name,
          actualSpeed: mySpeed,
          speedStatPoints: mySpeedStatPoints,
          baseSpeed: playerBaseSpeed,
          speBoost: mySlot.boosts.spe ?? 0,
          abilityId: fieldToKey(mySlot.fields["特性"]),
          itemId: fieldToKey(mySlot.fields["もちもの"]),
          itemIdentifier:
            mySlot.fields["もちもの"]?.matched_identifier ??
            fieldToKey(mySlot.fields["もちもの"]),
          tailwind: playerTailwind,
          isMegaEvolved: mySlot.isMegaEvolved,
          megaPokemonKey: mySlot.megaForm?.pokemon_key ?? null,
          megaBaseSpeed: mySlot.megaForm?.base_stats.spe ?? null,
        }
      : null;

    const opponentContext = {
      pokemonKey: getEffectivePokemonKey(slot),
      name: slot.name,
      actualSpeed: null,
      speedStatPoints: null,
      baseSpeed: null,
      speBoost: slot.boosts.spe ?? 0,
      abilityId: slot.abilityId,
      itemId: slot.itemId,
      itemIdentifier: slot.itemIdentifier ?? slot.itemId,
      tailwind: opponentTailwind,
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

    const result = buildSpeedComparison(
      playerContext,
      detail.base_stats.spe,
      opponentContext,
      {
        weather,
        terrain,
        trickRoom,
        playerTailwind,
        opponentTailwind,
      },
      slot.inferredSpeedBounds,
    );
    if (!result?.narrowed) return null;
    if (result.minSpeed === result.maxSpeed) {
      return `戦闘中 ≈${result.minSpeed}`;
    }
    return `戦闘中 ${result.minSpeed}〜${result.maxSpeed}`;
  }, [
    detail,
    slot,
    mySlot,
    weather,
    terrain,
    trickRoom,
    playerTailwind,
    opponentTailwind,
  ]);
  const cycleMegaForm = useOpponentTeamStore((s) => s.cycleMegaForm);

  // detail のメガフォーム情報をストアにキャッシュ
  const megaFormsRef = useRef(detail?.mega_forms);
  useEffect(() => {
    const forms = detail?.mega_forms ?? [];
    if (forms !== megaFormsRef.current) {
      megaFormsRef.current = forms;
      if (forms.length > 0) {
        setSlotMegaForms(slot.position, forms);
      }
    }
  }, [detail?.mega_forms, slot.position, setSlotMegaForms]);

  const activeMega =
    slot.activeMegaIndex != null ? slot.megaForms[slot.activeMegaIndex] ?? null : null;
  const displayPokemonId = activeMega
    ? activeMega.pokemon_key
    : (slot.basePokemonKey ?? slot.pokemonId);
  const hasMegaForms = slot.megaForms.length > 0;

  // メガトグルボタンのラベル
  const megaLabel = (() => {
    if (!activeMega) return "M";
    if (slot.megaForms.length <= 1) return "M";
    // X/Y の場合: forme suffix から判定
    const key = activeMega.pokemon_key;
    if (key.endsWith("megax")) return "Mx";
    if (key.endsWith("megay")) return "My";
    return "M";
  })();

  const effectivenessInfo = useMemo(() => {
    if (!hoveredTypeEntry || slot.pokemonId === null) return null;
    return hoveredTypeEntry.per_pokemon.find(
      (p) => (p.pokemon_key ?? p.pokemon_id) === slot.pokemonId,
    ) ?? null;
  }, [hoveredTypeEntry, slot.pokemonId]);

  const displayAbility = useMemo(() => {
    if (slot.ability) return slot.ability;
    if (!slot.wasSentOut || !detail) return null;
    if (detail.abilities.normal.length === 1 && !detail.abilities.hidden) {
      return detail.abilities.normal[0]?.name ?? null;
    }
    return "？？？";
  }, [slot.ability, slot.wasSentOut, detail]);

  const openEdit = useCallback(() => {
    if (slot.candidates.length > 0) {
      setEditing("candidates");
    } else {
      setEditing("manual");
    }
  }, [slot.candidates.length]);

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!detail || editing) return;
    const rect = slotRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({
        top: rect.top + rect.height / 2,
        right: window.innerWidth - rect.left + 8,
      });
    }
    setActiveTooltip(slot.position);
  };

  const handleMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => setActiveTooltip(null), 150);
  };

  const handleTooltipMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleTooltipMouseLeave = () => {
    setActiveTooltip(null);
  };

  const showTooltip = isTooltipActive && tooltipPos && detail && !editing;
  const { tooltipRef, clampedTop } = useTooltipClamp(
    tooltipPos?.top ?? null,
    !!showTooltip,
  );

  return (
    <div
      ref={slotRef}
      className={`opponent-slot${slot.pokemonId === null ? " opponent-slot-empty" : " opponent-slot-clickable"}${slot.wasSentOut ? " opponent-slot-sent-out" : ""}${slot.isSelected && !slot.isAlive ? " opponent-slot-fainted" : ""}${isDisplaySelected ? " opponent-slot-display-selected" : ""}`}
      style={editing ? { zIndex: 50 } : undefined}
      onClick={() => slot.pokemonId !== null && onSelectDisplayTarget(slot.position)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="opponent-slot-sprite-wrap">
        <PokemonSprite
          pokemonId={displayPokemonId}
          size={52}
          className="opponent-slot-img"
          placeholderClass="opponent-slot-placeholder"
        />
        {slot.itemIdentifier && (
          <ItemSprite
            identifier={slot.itemIdentifier}
            size={28}
            className="opponent-slot-item-overlay"
          />
        )}
        {hasMegaForms && (
          <button
            className={`mega-toggle-btn${activeMega ? " active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              cycleMegaForm(slot.position);
            }}
            title={activeMega ? "メガシンカ解除" : "メガシンカ"}
          >
            {megaLabel}
          </button>
        )}
      </div>
      <div className="opponent-slot-info">
        {editing === "candidates" ? (
          <CandidateSelector
            position={slot.position}
            candidates={slot.candidates}
            onClose={() => setEditing(false)}
            onManualInput={() => setEditing("manual")}
          />
        ) : editing === "manual" ? (
          <PokemonAutocomplete
            position={slot.position}
            onClose={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="opponent-slot-name-row">
              <span className="opponent-slot-name">
                {slot.name ?? "???"}
              </span>
              {isDisplaySelected && (
                <span className="opponent-slot-display-badge">表示中</span>
              )}
            </div>
            {(displayAbility || slot.item) && (
              <div className="opponent-slot-trait-row">
                {displayAbility && (
                  <span className={`opponent-slot-trait opponent-slot-trait-ability${displayAbility === "？？？" ? " opponent-slot-trait-unknown" : ""}`}>
                    {displayAbility}
                  </span>
                )}
                {slot.item && (
                  <span className="opponent-slot-trait opponent-slot-trait-item">
                    {slot.item}
                  </span>
                )}
              </div>
            )}
            {slot.isSelected ? (
              <div className="opponent-slot-hp-row">
                <div className="opponent-slot-hp-bar">
                  <div
                    className={`opponent-slot-hp-fill${!slot.isAlive ? " opponent-slot-hp-fainted" : ""}`}
                    style={{
                      width: slot.hpPercent != null
                        ? `${slot.hpPercent}%`
                        : (slot.isAlive ? "100%" : "0%"),
                    }}
                  />
                </div>
                {slot.hpPercent != null && slot.isAlive && (
                  <span className="opponent-slot-hp-text">{slot.hpPercent}%</span>
                )}
              </div>
            ) : null}
            {slot.wasSentOut && (
              <div className="opponent-slot-moves">
                {Array.from({ length: 4 }, (_, i) => {
                  const move = slot.knownMoves[i];
                  return move ? (
                    <MoveInfoChip
                      key={i}
                      moveKey={move.id}
                      moveName={move.name}
                      className="opponent-slot-move move-chip-hoverable"
                    />
                  ) : (
                    <span
                      key={i}
                      className="opponent-slot-move opponent-slot-move-unknown"
                    >
                      ？？？
                    </span>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      {!editing && (
        <button
          className="btn-icon opponent-slot-edit"
          onClick={(event) => {
            event.stopPropagation();
            openEdit();
          }}
          title="手動で設定"
        >
          &#9998;
        </button>
      )}
      {showTooltip && (
        <div
          ref={tooltipRef}
          className="opponent-slot-tooltip"
          style={{
            top: clampedTop ?? tooltipPos.top,
            right: tooltipPos.right,
            transform: clampedTop != null ? "none" : "translateY(-50%)",
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <div className="opponent-slot-tooltip-inner">
            <OpponentTooltipContent
              detail={detail}
              speedBattleTooltipLine={speedBattleTooltipLine}
            />
          </div>
        </div>
      )}
      {effectivenessInfo && (
        <div
          className={`slot-eff-overlay slot-eff-${getEffClass(effectivenessInfo.effectiveness)}`}
        >
          {formatMultiplier(effectivenessInfo.effectiveness)}
        </div>
      )}
    </div>
  );
});

export const OpponentPanel = memo(function OpponentPanel() {
  const slots = useOpponentTeamStore((s) => s.slots);
  const displaySelectedPosition = useOpponentTeamStore((s) => s.displaySelectedPosition);
  const displaySelectionMode = useOpponentTeamStore((s) => s.displaySelectionMode);
  const selectDisplayTarget = useOpponentTeamStore((s) => s.selectDisplayTarget);
  const clear = useOpponentTeamStore((s) => s.clear);

  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredType, setHoveredType] = useState<TypeConsistencyEntry | null>(null);

  const hasAny = slots.some((s) => s.pokemonId !== null);

  return (
    <div className="panel-section opponent-panel">
      <div className="opponent-panel-header">
        <h2>相手のパーティ</h2>
        {hasAny && (
          <button className="btn-small btn-clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <div className="opponent-panel-slots">
        {slots.map((slot) => (
          <SlotRow
            key={slot.position}
            slot={slot}
            isTooltipActive={activeTooltip === slot.position}
            setActiveTooltip={setActiveTooltip}
            closeTimerRef={closeTimerRef}
            hoveredTypeEntry={hoveredType}
            isDisplaySelected={displaySelectedPosition === slot.position}
            onSelectDisplayTarget={(position) =>
              selectDisplayTarget(
                displaySelectionMode === "manual" &&
                displaySelectedPosition === position
                  ? null
                  : position,
              )
            }
          />
        ))}
      </div>
      <TypeConsistencyPanel onTypeHover={setHoveredType} />
    </div>
  );
});
