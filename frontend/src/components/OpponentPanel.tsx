import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useOpponentTeamStore,
  type OpponentSlot,
} from "../stores/useOpponentTeamStore";
import { usePokemonNames } from "../hooks/usePokemonNames";
import type { PokemonCandidate } from "../types";

function SpriteImg({
  pokemonId,
  size = 48,
}: {
  pokemonId: number | null;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);

  // pokemonId が変わったらエラー状態をリセット
  useEffect(() => {
    setErrored(false);
  }, [pokemonId]);

  if (pokemonId === null || errored) {
    return (
      <div
        className="opponent-slot-placeholder"
        style={{ width: size, height: size }}
      >
        ?
      </div>
    );
  }

  return (
    <img
      className="opponent-slot-img"
      src={`/sprites/${pokemonId}.png`}
      alt={`#${pokemonId}`}
      width={size}
      height={size}
      onError={() => setErrored(true)}
    />
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

function SlotRow({ slot }: { slot: OpponentSlot }) {
  const [editing, setEditing] = useState<false | "candidates" | "manual">(
    false,
  );

  const openEdit = useCallback(() => {
    if (slot.candidates.length > 0) {
      setEditing("candidates");
    } else {
      setEditing("manual");
    }
  }, [slot.candidates.length]);

  return (
    <div
      className={`opponent-slot${slot.isManual ? " opponent-slot-manual" : ""}${slot.pokemonId === null ? " opponent-slot-empty" : ""}`}
      style={editing ? { zIndex: 50 } : undefined}
    >
      <span className="opponent-slot-pos">#{slot.position}</span>
      <SpriteImg pokemonId={slot.pokemonId} />
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
    </div>
  );
}

export function OpponentPanel() {
  const slots = useOpponentTeamStore((s) => s.slots);
  const clear = useOpponentTeamStore((s) => s.clear);

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
          <SlotRow key={slot.position} slot={slot} />
        ))}
      </div>
    </div>
  );
}
