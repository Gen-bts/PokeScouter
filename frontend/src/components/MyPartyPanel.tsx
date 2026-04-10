import { Fragment, useEffect, useRef, useState } from "react";
import { useMyPartyStore, type MyPartySlot } from "../stores/useMyPartyStore";
import { useConnectionStore } from "../stores/useConnectionStore";
import { useDamageCalcStore } from "../stores/useDamageCalcStore";
import type { MegaFormDetail, ValidatedField } from "../types";
import { useMegaForm } from "../hooks/useMegaForm";
import { PokemonSprite } from "./PokemonSprite";
import { ItemSprite } from "./ItemSprite";
import { TypeBadge } from "./TypeBadge";

const PHASE_LABELS: Record<string, string> = {
  detecting_screen1: "画面1を検出中...",
  reading_screen1: "画面1を読み取り中...",
  detecting_screen2: "画面2を検出中...",
  reading_screen2: "画面2を読み取り中...",
};

const DAMAGE_CLASS_LABELS: Record<string, string> = {
  physical: "物理", special: "特殊", status: "変化",
};

const STAT_ORDER = ["HP", "こうげき", "ぼうぎょ", "とくこう", "とくぼう", "すばやさ"];

/** API レスポンスの種族値キー → 表示ラベル */
const STAT_KEY_TO_LABEL: Record<string, string> = {
  hp: "HP", atk: "こうげき", def: "ぼうぎょ",
  spa: "とくこう", spd: "とくぼう", spe: "すばやさ",
};
const MEGA_STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"];

interface MergedStat {
  base: string;
  actual: string | null;
  ev: string | null;
  mod: string | null;
}

/** フィールド表示テキスト: validated があればそちら、なければ raw */
function fieldText(f: { raw: string; validated: string | null }): string {
  return f.validated ?? f.raw;
}

/** フィールドをグループ分けして返す */
function groupFields(fields: Record<string, ValidatedField>) {
  const identity: [string, string][] = [];
  const moves: [string, string, ValidatedField][] = [];
  const modifiers: Record<string, string | null> = {};
  const statMap: Record<string, { actual?: string; ev?: string }> = {};

  for (const [key, f] of Object.entries(fields)) {
    if (key.includes("性格補正")) {
      modifiers[key] = f.validated;
      continue;
    }
    const text = fieldText(f);
    if (!text) continue;
    if (key === "名前" || key === "特性" || key === "もちもの") {
      identity.push([key, text]);
    } else if (key.startsWith("わざ")) {
      moves.push([key, text, f]);
    } else if (key.includes("実数値") || key.includes("努力値")) {
      const statBase = key.replace(/[実努].*$/, "");
      if (!statMap[statBase]) statMap[statBase] = {};
      if (key.includes("実数値")) {
        statMap[statBase].actual = text;
      } else {
        statMap[statBase].ev = text;
      }
    }
  }

  const mergedStats: MergedStat[] = STAT_ORDER
    .filter((base) => statMap[base])
    .map((base) => ({
      base,
      actual: statMap[base].actual ?? null,
      ev: statMap[base].ev ?? null,
      mod: modifiers[`${base}性格補正`] ?? null,
    }));

  return { identity, moves, mergedStats, modifiers };
}

function MegaEvolutionSection({ megaForm }: { megaForm: MegaFormDetail }) {
  return (
    <div className="tooltip-section mega-section">
      <div className="tooltip-section-label">メガシンカ</div>
      <div className="mega-header">
        <span className="mega-name">{megaForm.mega_name}</span>
        <span className="mega-types">
          {megaForm.types.map((t) => (
            <TypeBadge key={t} type={t} size="sm" />
          ))}
        </span>
      </div>
      {megaForm.ability.name && (
        <div className="tooltip-row">
          <span className="tooltip-label">特性</span>
          <span className="tooltip-value">{megaForm.ability.name}</span>
        </div>
      )}
      <div className="mega-stats-grid">
        {MEGA_STAT_ORDER.map((key) => {
          const val = megaForm.base_stats[key];
          const delta = megaForm.stat_deltas?.[key];
          return (
            <Fragment key={key}>
              <span className="tooltip-stat-label">
                {STAT_KEY_TO_LABEL[key] ?? key}
              </span>
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
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function SlotTooltipContent({
  identity,
  moves,
  mergedStats,
  megaForm,
}: {
  identity: [string, string][];
  moves: [string, string, ValidatedField][];
  mergedStats: MergedStat[];
  megaForm: MegaFormDetail | null;
}) {
  const filteredIdentity = identity.filter(([k]) => k !== "名前");

  return (
    <>
      {filteredIdentity.map(([key, val]) => (
        <div key={key} className="tooltip-row">
          <span className="tooltip-label">{key}</span>
          <span className="tooltip-value">{val}</span>
        </div>
      ))}
      {moves.length > 0 && (
        <div className="tooltip-section">
          <div className="tooltip-section-label">わざ</div>
          <div className="tooltip-moves">
            {moves.map(([key, val, field]) => (
              <span key={key} className="tooltip-move">
                {val}
                {field.move_meta && (
                  <span className="move-detail-popup">
                    <TypeBadge type={field.move_meta.type ?? ""} size="sm" />
                    {field.move_meta.damage_class && (
                      <span className="move-detail-class">
                        {DAMAGE_CLASS_LABELS[field.move_meta.damage_class] ?? field.move_meta.damage_class}
                      </span>
                    )}
                    {field.move_meta.power != null && (
                      <span className="move-detail-stat">威力 {field.move_meta.power}</span>
                    )}
                    {field.move_meta.accuracy != null && (
                      <span className="move-detail-stat">命中 {field.move_meta.accuracy}</span>
                    )}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      {mergedStats.length > 0 && (
        <div className="tooltip-section">
          <div className="tooltip-section-label">ステータス</div>
          <div className="tooltip-stats-grid">
            {mergedStats.map((stat) => (
              <Fragment key={stat.base}>
                <span className="tooltip-stat-label">
                  {stat.base}
                  {stat.mod === "up" && <span className="nature-up" title="上昇補正">▲</span>}
                  {stat.mod === "down" && <span className="nature-down" title="下降補正">▼</span>}
                </span>
                <span className="tooltip-stat-value">
                  {stat.actual ?? "?"}
                </span>
                <span className="tooltip-stat-ev">
                  {stat.ev && stat.ev !== "0" ? `(${stat.ev})` : ""}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      {megaForm && <MegaEvolutionSection megaForm={megaForm} />}
    </>
  );
}

function SlotRow({
  slot,
  isTooltipActive,
  setActiveTooltip,
  closeTimerRef,
  isSelectedAttacker,
  onSelectAttacker,
}: {
  slot: MyPartySlot;
  isTooltipActive: boolean;
  setActiveTooltip: (position: number | null) => void;
  closeTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  isSelectedAttacker: boolean;
  onSelectAttacker: (position: number) => void;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const { identity, moves, mergedStats } = groupFields(slot.fields);
  const hasDetails = identity.length > 0 || moves.length > 0 || mergedStats.length > 0;

  const itemField = slot.fields["もちもの"];
  const itemIdentifier = itemField?.matched_identifier ?? null;
  const isMegaStone = itemField?.is_mega_stone ?? false;
  const { megaForm } = useMegaForm(
    isMegaStone ? (itemField?.matched_id ?? null) : null,
    slot.pokemonId,
    slot.position,
  );

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!hasDetails) return;
    const rect = slotRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
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

  const showTooltip = isTooltipActive && tooltipPos && hasDetails;

  return (
    <div
      ref={slotRef}
      className={[
        "my-party-slot",
        slot.pokemonId === null ? "my-party-slot-empty" : "my-party-slot-selectable",
        isSelectedAttacker ? "my-party-slot-selected" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => slot.pokemonId !== null && onSelectAttacker(slot.position)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="my-party-slot-sprite-wrap">
        <PokemonSprite
          pokemonId={slot.pokemonId}
          size={44}
          className="my-party-slot-img"
          placeholderClass="my-party-slot-placeholder"
        />
        <ItemSprite
          identifier={itemIdentifier}
          size={30}
          className="my-party-slot-item-overlay"
        />
      </div>
      <span className="my-party-slot-name">
        {slot.name ?? "???"}
      </span>

      {showTooltip && (
        <div
          className="my-party-slot-tooltip"
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <SlotTooltipContent
            identity={identity}
            moves={moves}
            mergedStats={mergedStats}
            megaForm={megaForm}
          />
        </div>
      )}
    </div>
  );
}

export function MyPartyPanel() {
  const slots = useMyPartyStore((s) => s.slots);
  const partyName = useMyPartyStore((s) => s.partyName);
  const activePartyId = useMyPartyStore((s) => s.activePartyId);
  const savedParties = useMyPartyStore((s) => s.savedParties);
  const registrationState = useMyPartyStore((s) => s.registrationState);
  const error = useMyPartyStore((s) => s.error);
  const clear = useMyPartyStore((s) => s.clear);
  const setPartyName = useMyPartyStore((s) => s.setPartyName);
  const saveCurrentParty = useMyPartyStore((s) => s.saveCurrentParty);
  const loadParty = useMyPartyStore((s) => s.loadParty);
  const overwriteParty = useMyPartyStore((s) => s.overwriteParty);
  const deleteParty = useMyPartyStore((s) => s.deleteParty);
  const fetchSavedParties = useMyPartyStore((s) => s.fetchSavedParties);

  const isConnected = useConnectionStore((s) => s.isConnected);
  const sendStart = useConnectionStore((s) => s.sendPartyRegisterStart);
  const sendCancel = useConnectionStore((s) => s.sendPartyRegisterCancel);

  const selectedAttackerPos = useDamageCalcStore((s) => s.selectedAttackerPosition);
  const selectAttacker = useDamageCalcStore((s) => s.selectAttacker);

  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  useEffect(() => {
    fetchSavedParties();
  }, [fetchSavedParties]);

  useEffect(() => {
    setEditingName(partyName ?? "");
  }, [partyName]);

  const isRegistering =
    registrationState !== "idle" && registrationState !== "done";
  const hasParty = slots.some((s) => s.pokemonId !== null);
  const showSlots = hasParty || registrationState === "done";

  const handleSave = async () => {
    const name = editingName.trim() || partyName || "パーティ";
    if (name !== partyName) setPartyName(name);

    const existing = savedParties.find(
      (p) => p.name === name && p.id !== activePartyId,
    );
    if (existing) {
      if (window.confirm(`「${existing.name}」は既に保存されています。上書きしますか？`)) {
        await overwriteParty(existing.id);
      }
    } else if (activePartyId) {
      await overwriteParty(activePartyId);
    } else {
      await saveCurrentParty();
    }
  };

  const handleLoad = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id) loadParty(id);
  };

  const handleDelete = async (id: string) => {
    const party = savedParties.find((p) => p.id === id);
    if (party && window.confirm(`「${party.name}」を削除しますか？`)) {
      await deleteParty(id);
    }
  };

  return (
    <div className="panel-section my-party-panel">
      <div className="my-party-panel-header">
        <h2>自分のパーティ</h2>
        {showSlots && !isRegistering && (
          <button className="btn-small btn-clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>

      {showSlots && !isRegistering && (
        <div className="my-party-name-row">
          <input
            className="my-party-name-input"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={() => {
              const trimmed = editingName.trim();
              if (trimmed && trimmed !== partyName) setPartyName(trimmed);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = editingName.trim();
                if (trimmed && trimmed !== partyName) setPartyName(trimmed);
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="パーティ名"
          />
        </div>
      )}

      {isRegistering && (
        <div className="my-party-progress">
          <span className="my-party-progress-label">
            {PHASE_LABELS[registrationState] ?? registrationState}
          </span>
          <button
            className="btn-small btn-cancel"
            onClick={() => {
              sendCancel();
              useMyPartyStore.getState().setRegistrationState("idle");
            }}
          >
            キャンセル
          </button>
        </div>
      )}

      {error && (
        <div className="my-party-error">
          {error}
        </div>
      )}

      {showSlots && (
        <div className="my-party-slots">
          {slots.map((slot) => (
            <SlotRow
              key={slot.position}
              slot={slot}
              isTooltipActive={activeTooltip === slot.position}
              setActiveTooltip={setActiveTooltip}
              closeTimerRef={closeTimerRef}
              isSelectedAttacker={selectedAttackerPos === slot.position}
              onSelectAttacker={(pos) =>
                selectAttacker(selectedAttackerPos === pos ? null : pos)
              }
            />
          ))}
        </div>
      )}

      {!isRegistering && !showSlots && (
        <div className="my-party-actions">
          <button
            className="btn-primary"
            disabled={!isConnected}
            onClick={sendStart}
            title={isConnected ? "パーティ登録を開始" : "サーバーに接続してください"}
          >
            パーティ登録
          </button>
        </div>
      )}

      {showSlots && !isRegistering && (
        <div className="my-party-actions">
          <button className="btn-small" onClick={handleSave}>
            {activePartyId ? "上書き保存" : "保存"}
          </button>
          <button
            className="btn-small"
            disabled={!isConnected}
            onClick={sendStart}
          >
            再登録
          </button>
        </div>
      )}

      {savedParties.length > 0 && !isRegistering && (
        <div className="my-party-library">
          <select
            className="my-party-library-select"
            value={activePartyId ?? ""}
            onChange={handleLoad}
          >
            <option value="" disabled>
              保存済みパーティ ({savedParties.length})
            </option>
            {savedParties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {activePartyId && (
            <button
              className="btn-small btn-danger"
              onClick={() => handleDelete(activePartyId)}
              title="削除"
            >
              削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}
