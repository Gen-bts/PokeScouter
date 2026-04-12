import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePokemonNames } from "../../hooks/usePokemonNames";
import type { PokemonCandidate } from "../../types";

interface Props {
  candidates: PokemonCandidate[];
  onSelect: (pokemonId: string, name: string) => void;
  onClose: () => void;
}

export function PokemonIconCandidateSelector({
  candidates,
  onSelect,
  onClose,
}: Props) {
  const [mode, setMode] = useState<"candidates" | "search">(
    candidates.length > 0 ? "candidates" : "search",
  );

  return (
    <div
      className="crop-candidate-selector"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {mode === "candidates" ? (
        <CandidateList
          candidates={candidates}
          onSelect={onSelect}
          onClose={onClose}
          onManualInput={() => setMode("search")}
        />
      ) : (
        <ManualSearch
          onSelect={onSelect}
          onClose={onClose}
          onBack={candidates.length > 0 ? () => setMode("candidates") : undefined}
        />
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  onSelect,
  onClose,
  onManualInput,
}: {
  candidates: PokemonCandidate[];
  onSelect: (pokemonId: string, name: string) => void;
  onClose: () => void;
  onManualInput: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const totalItems = candidates.length + 1;

  useEffect(() => {
    ref.current?.focus();
  }, []);

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
        const c = candidates[selectedIdx]!;
        onSelect(c.pokemon_id, c.name);
      } else {
        onManualInput();
      }
    }
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        if (e.relatedTarget?.closest(".crop-candidate-selector")) return;
        setTimeout(onClose, 150);
      }}
    >
      {candidates.map((c, i) => (
        <div
          key={c.pokemon_id}
          className={`crop-candidate-row${i === selectedIdx ? " selected" : ""}`}
          onMouseEnter={() => setSelectedIdx(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(c.pokemon_id, c.name)}
        >
          <img
            src={`/sprites/${c.pokemon_id}.png`}
            alt=""
            width={28}
            height={28}
            style={{ objectFit: "contain" }}
          />
          <span className="crop-candidate-name">{c.name}</span>
          <span className="crop-candidate-confidence">
            {(c.confidence * 100).toFixed(0)}%
          </span>
        </div>
      ))}
      <div className="crop-candidate-divider" />
      <div
        className={`crop-candidate-row${selectedIdx === candidates.length ? " selected" : ""}`}
        onMouseEnter={() => setSelectedIdx(candidates.length)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onManualInput}
      >
        <span>手動入力...</span>
      </div>
    </div>
  );
}

function ManualSearch({
  onSelect,
  onClose,
  onBack,
}: {
  onSelect: (pokemonId: string, name: string) => void;
  onClose: () => void;
  onBack?: () => void;
}) {
  const { names } = usePokemonNames();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (query.length < 2) return [];
    const katakana = query.replace(/[\u3041-\u3096]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60),
    );
    const q = katakana.toLowerCase();
    const matched: Array<{ name: string; id: string }> = [];
    for (const [name, id] of Object.entries(names)) {
      if (name.toLowerCase().includes(q)) {
        matched.push({ name, id });
        if (matched.length >= 10) break;
      }
    }
    return matched;
  }, [query, names]);

  const select = useCallback(
    (name: string, id: string) => {
      onSelect(id, name);
    },
    [onSelect],
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [results.length]);

  useEffect(() => {
    const item = listRef.current?.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (onBack) onBack();
      else onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      const c = results[selectedIdx];
      if (c) select(c.name, c.id);
    }
  };

  return (
    <div className="crop-candidate-search">
      {onBack && (
        <div
          className="crop-candidate-row crop-candidate-back"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onBack}
        >
          ← 候補に戻る
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        className="crop-candidate-input"
        placeholder="ポケモン名を入力..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          if (e.relatedTarget?.closest(".crop-candidate-selector")) return;
          setTimeout(onClose, 150);
        }}
      />
      {results.length > 0 && (
        <ul className="crop-candidate-list" ref={listRef}>
          {results.map((c, i) => (
            <li
              key={c.id}
              className={i === selectedIdx ? "selected" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(c.name, c.id)}
            >
              <img
                src={`/sprites/${c.id}.png`}
                alt=""
                width={28}
                height={28}
                style={{ objectFit: "contain" }}
              />
              <span>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
