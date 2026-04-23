import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface AutocompleteOption {
  key: string;
  name: string;
  subtitle?: string;
  icon?: ReactNode;
}

interface AutocompleteProps {
  value: string | null;
  displayName: string | null;
  options: AutocompleteOption[];
  placeholder?: string;
  onSelect: (key: string | null, name: string | null) => void;
  onClear?: () => void;
  disabled?: boolean;
  minQueryLength?: number;
  maxResults?: number;
  className?: string;
  emptyLabel?: string;
}

function hiraToKata(input: string): string {
  return input.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  );
}

export function Autocomplete({
  value,
  displayName,
  options,
  placeholder = "入力...",
  onSelect,
  onClear,
  disabled = false,
  minQueryLength = 1,
  maxResults = 15,
  className,
  emptyLabel = "候補なし",
}: AutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 入力値を外部 value に同期
  useEffect(() => {
    if (!open) setQuery("");
  }, [open, value]);

  const candidates = useMemo(() => {
    const raw = query.trim();
    if (raw.length < minQueryLength) return options.slice(0, maxResults);
    const kata = hiraToKata(raw).toLowerCase();
    const results: AutocompleteOption[] = [];
    for (const opt of options) {
      if (
        opt.name.toLowerCase().includes(kata) ||
        opt.key.toLowerCase().includes(kata)
      ) {
        results.push(opt);
        if (results.length >= maxResults) break;
      }
    }
    return results;
  }, [query, options, minQueryLength, maxResults]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [candidates.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = useCallback(
    (opt: AutocompleteOption) => {
      onSelect(opt.key, opt.name);
      setOpen(false);
      setQuery("");
    },
    [onSelect],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && candidates.length > 0) {
      e.preventDefault();
      const c = candidates[selectedIdx];
      if (c) select(c);
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`dt-autocomplete ${className ?? ""}`}
      data-open={open}
    >
      <div className="dt-autocomplete-field">
        {open ? (
          <input
            ref={inputRef}
            type="text"
            className="dt-autocomplete-input"
            placeholder={placeholder}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
          />
        ) : (
          <button
            type="button"
            className="dt-autocomplete-trigger"
            disabled={disabled}
            onClick={() => {
              setOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            <span className={displayName ? "" : "dt-placeholder"}>
              {displayName ?? placeholder}
            </span>
          </button>
        )}
        {value && onClear && !disabled && (
          <button
            type="button"
            className="dt-autocomplete-clear"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            title="クリア"
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <ul className="dt-autocomplete-list" ref={listRef}>
          {candidates.length === 0 ? (
            <li className="dt-autocomplete-empty">{emptyLabel}</li>
          ) : (
            candidates.map((opt, i) => (
              <li
                key={opt.key}
                className={i === selectedIdx ? "selected" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(opt)}
              >
                {opt.icon && <span className="dt-autocomplete-icon">{opt.icon}</span>}
                <span className="dt-autocomplete-name">{opt.name}</span>
                {opt.subtitle && (
                  <span className="dt-autocomplete-subtitle">{opt.subtitle}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
