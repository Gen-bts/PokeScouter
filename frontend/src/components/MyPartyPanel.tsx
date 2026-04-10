import { Fragment, useRef, useState } from "react";
import { useMyPartyStore, type MyPartySlot } from "../stores/useMyPartyStore";
import { useConnectionStore } from "../stores/useConnectionStore";
import type { ValidatedField } from "../types";
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

function SlotTooltipContent({
  identity,
  moves,
  mergedStats,
}: {
  identity: [string, string][];
  moves: [string, string, ValidatedField][];
  mergedStats: MergedStat[];
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
    </>
  );
}

function SlotRow({
  slot,
  isTooltipActive,
  setActiveTooltip,
  closeTimerRef,
}: {
  slot: MyPartySlot;
  isTooltipActive: boolean;
  setActiveTooltip: (position: number | null) => void;
  closeTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const { identity, moves, mergedStats } = groupFields(slot.fields);
  const hasDetails = identity.length > 0 || moves.length > 0 || mergedStats.length > 0;

  const itemField = slot.fields["もちもの"];
  const itemIdentifier = itemField?.matched_identifier ?? null;

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
      className={`my-party-slot${slot.pokemonId === null ? " my-party-slot-empty" : ""}`}
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
          size={20}
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
          />
        </div>
      )}
    </div>
  );
}

export function MyPartyPanel() {
  const slots = useMyPartyStore((s) => s.slots);
  const registrationState = useMyPartyStore((s) => s.registrationState);
  const error = useMyPartyStore((s) => s.error);
  const clear = useMyPartyStore((s) => s.clear);

  const isConnected = useConnectionStore((s) => s.isConnected);
  const sendStart = useConnectionStore((s) => s.sendPartyRegisterStart);
  const sendCancel = useConnectionStore((s) => s.sendPartyRegisterCancel);

  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRegistering =
    registrationState !== "idle" && registrationState !== "done";
  const hasParty = slots.some((s) => s.pokemonId !== null);
  const showSlots = hasParty || registrationState === "done";

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
          <button
            className="btn-small"
            disabled={!isConnected}
            onClick={sendStart}
          >
            再登録
          </button>
        </div>
      )}
    </div>
  );
}
