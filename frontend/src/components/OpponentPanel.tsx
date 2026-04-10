import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useOpponentTeamStore,
  type OpponentSlot,
} from "../stores/useOpponentTeamStore";
import { usePokemonNames } from "../hooks/usePokemonNames";
import { usePokemonDetail, type PokemonDetail } from "../hooks/usePokemonDetail";
import { PokemonSprite } from "./PokemonSprite";
import { TypeConsistencyPanel } from "./TypeConsistencyPanel";
import { TypeBadge } from "./TypeBadge";
import type { PokemonCandidate, TypeConsistencyEntry } from "../types";

const STAT_LABELS: Record<string, string> = {
  hp: "HP", atk: "こうげき", def: "ぼうぎょ",
  spa: "とくこう", spd: "とくぼう", spe: "すばやさ",
};

const STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"] as const;

function formatMultiplier(m: number): string {
  if (m === 0) return "x0";
  if (m === 0.25) return "x1/4";
  if (m === 0.5) return "x1/2";
  if (m === 2) return "x2";
  if (m === 4) return "x4";
  return `x${m}`;
}

function getEffClass(eff: number): string {
  if (eff === 0) return "immune";
  if (eff < 1) return "resist";
  if (eff === 1) return "neutral";
  if (eff >= 4) return "super4";
  return "super2";
}

function OpponentTooltipContent({ detail }: { detail: PokemonDetail }) {
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
            <span key={a.name} className="opponent-tooltip-ability">
              {a.name}
              {a.effect && (
                <span className="ability-desc-tooltip">{a.effect}</span>
              )}
            </span>
          ))}
          {detail.abilities.hidden && (
            <span className="opponent-tooltip-ability opponent-tooltip-ability-hidden">
              {detail.abilities.hidden.name}
              <span className="opponent-tooltip-hidden-tag">夢</span>
              {detail.abilities.hidden.effect && (
                <span className="ability-desc-tooltip">{detail.abilities.hidden.effect}</span>
              )}
            </span>
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

      {/* タイプ相性 */}
      {detail.type_effectiveness.weak.length > 0 && (
        <div className="tooltip-section">
          <div className="tooltip-section-label">弱点</div>
          <div className="opponent-tooltip-eff-list">
            {detail.type_effectiveness.weak.map((e) => (
              <span key={e.type} className="opponent-tooltip-eff-item opponent-tooltip-eff-weak">
                <TypeBadge type={e.type} size="sm" />
                <span className="opponent-tooltip-eff-mult">{formatMultiplier(e.multiplier)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {detail.type_effectiveness.resist.length > 0 && (
        <div className="tooltip-section">
          <div className="tooltip-section-label">耐性</div>
          <div className="opponent-tooltip-eff-list">
            {detail.type_effectiveness.resist.map((e) => (
              <span key={e.type} className="opponent-tooltip-eff-item opponent-tooltip-eff-resist">
                <TypeBadge type={e.type} size="sm" />
                <span className="opponent-tooltip-eff-mult">{formatMultiplier(e.multiplier)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {detail.type_effectiveness.immune.length > 0 && (
        <div className="tooltip-section">
          <div className="tooltip-section-label">無効</div>
          <div className="opponent-tooltip-eff-list">
            {detail.type_effectiveness.immune.map((e) => (
              <span key={e.type} className="opponent-tooltip-eff-item opponent-tooltip-eff-immune">
                <TypeBadge type={e.type} size="sm" />
                <span className="opponent-tooltip-eff-mult">{formatMultiplier(e.multiplier)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
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
  const { names } = usePokemonNames();
  const manualSet = useOpponentTeamStore((s) => s.manualSet);
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
    const results: Array<{ name: string; id: number }> = [];
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
    (name: string, id: number) => {
      manualSet(position, id, name);
      onClose();
    },
    [position, manualSet, onClose],
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
      const c = candidates[selectedIdx];
      if (c) select(c.name, c.id);
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
    <div className="opponent-autocomplete">
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
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 手動入力は candidates.length 番目のインデックス
  const totalItems = candidates.length + 1;

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const select = useCallback(
    (c: PokemonCandidate) => {
      manualSet(position, c.pokemon_id, c.name);
      onClose();
    },
    [position, manualSet, onClose],
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
        select(candidates[selectedIdx]);
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

function SlotRow({
  slot,
  isTooltipActive,
  setActiveTooltip,
  closeTimerRef,
  hoveredTypeEntry,
}: {
  slot: OpponentSlot;
  isTooltipActive: boolean;
  setActiveTooltip: (position: number | null) => void;
  closeTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  hoveredTypeEntry: TypeConsistencyEntry | null;
}) {
  const [editing, setEditing] = useState<false | "candidates" | "manual">(
    false,
  );
  const slotRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; right: number } | null>(null);
  const { detail } = usePokemonDetail(slot.pokemonId);

  const effectivenessInfo = useMemo(() => {
    if (!hoveredTypeEntry || slot.pokemonId === null) return null;
    return hoveredTypeEntry.per_pokemon.find(
      (p) => p.pokemon_id === slot.pokemonId,
    ) ?? null;
  }, [hoveredTypeEntry, slot.pokemonId]);

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

  return (
    <div
      ref={slotRef}
      className={`opponent-slot${slot.isManual ? " opponent-slot-manual" : ""}${slot.pokemonId === null ? " opponent-slot-empty" : ""}`}
      style={editing ? { zIndex: 50 } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <PokemonSprite
        pokemonId={slot.pokemonId}
        size={52}
        className="opponent-slot-img"
        placeholderClass="opponent-slot-placeholder"
      />
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
            <span className="opponent-slot-name">
              {slot.name ?? "???"}
            </span>
            {!slot.isManual && slot.pokemonId !== null && (
              <span className="opponent-slot-confidence">
                {(slot.confidence * 100).toFixed(0)}%
              </span>
            )}
            {slot.isManual && (
              <span className="opponent-slot-badge">手動</span>
            )}
          </>
        )}
      </div>
      {!editing && (
        <button
          className="btn-icon opponent-slot-edit"
          onClick={openEdit}
          title="手動で設定"
        >
          &#9998;
        </button>
      )}
      {showTooltip && (
        <div
          className="opponent-slot-tooltip"
          style={{
            top: tooltipPos.top,
            right: tooltipPos.right,
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <OpponentTooltipContent detail={detail} />
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
}

export function OpponentPanel() {
  const slots = useOpponentTeamStore((s) => s.slots);
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
          />
        ))}
      </div>
      <TypeConsistencyPanel onTypeHover={setHoveredType} />
    </div>
  );
}
