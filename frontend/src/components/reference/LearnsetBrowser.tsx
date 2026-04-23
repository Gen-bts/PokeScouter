import { useEffect, useMemo, useState } from "react";
import { usePokemonNames } from "../../hooks/usePokemonNames";
import { PokemonSprite } from "../PokemonSprite";
import { TypeBadge } from "../TypeBadge";
import { TYPE_LABELS } from "../../utils/typeLabels";

interface LearnsetMove {
  move_key: string;
  name: string;
  type: string | null;
  damage_class: string | null;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
}

interface LearnsetResponse {
  pokemon_key: string;
  count: number;
  moves: LearnsetMove[];
}

interface ByMovePokemon {
  pokemon_key: string;
  name: string;
  types: string[];
}

interface ByMoveResponse {
  move_key: string;
  count: number;
  pokemon: ByMovePokemon[];
}

type Mode = "by-pokemon" | "by-move";

export function LearnsetBrowser() {
  const [mode, setMode] = useState<Mode>("by-pokemon");

  return (
    <div className="ref-learnset">
      <div className="ref-learnset__mode-tabs">
        <button
          type="button"
          className={`ref-tab ${mode === "by-pokemon" ? "ref-tab--active" : ""}`}
          onClick={() => setMode("by-pokemon")}
        >
          ポケモン→覚える技
        </button>
        <button
          type="button"
          className={`ref-tab ${mode === "by-move" ? "ref-tab--active" : ""}`}
          onClick={() => setMode("by-move")}
        >
          技→覚えるポケモン
        </button>
      </div>
      {mode === "by-pokemon" ? <ByPokemonView /> : <ByMoveView />}
    </div>
  );
}

function ByPokemonView() {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [data, setData] = useState<LearnsetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const { names: pokemonNames } = usePokemonNames();

  const nameRows = useMemo<MoveNameRow[]>(
    () => Object.entries(pokemonNames).map(([key, name]) => ({ key, name })),
    [pokemonNames],
  );

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return nameRows
      .filter(
        (n) =>
          n.name.toLowerCase().includes(q) || n.key.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, nameRows]);

  useEffect(() => {
    if (!selectedKey) {
      setData(null);
      return;
    }
    setLoading(true);
    let cancelled = false;
    fetch(`/api/pokemon/${selectedKey}/learnset?lang=ja`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d: LearnsetResponse | null) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  return (
    <>
      <div className="ref-learnset__search">
        <input
          type="text"
          className="ref-input"
          placeholder="ポケモン名で検索 (例: ニンフィア)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {suggestions.length > 0 && (
          <div className="ref-learnset__suggestions">
            {suggestions.map((s) => (
              <button
                key={s.key}
                type="button"
                className="ref-learnset__suggestion"
                onClick={() => {
                  setSelectedKey(s.key);
                  setQuery(s.name);
                }}
              >
                <PokemonSprite pokemonId={s.key} size={20} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedKey && (
        <div className="ref-learnset__result">
          <div className="ref-learnset__header">
            <PokemonSprite pokemonId={selectedKey} size={32} />
            <span className="ref-learnset__header-name">
              {pokemonNames[selectedKey] ?? selectedKey}
            </span>
            {data && (
              <span className="ref-learnset__count">{data.count} 技</span>
            )}
          </div>
          {loading ? (
            <div className="ref-placeholder">読み込み中...</div>
          ) : data && data.moves.length > 0 ? (
            <table className="ref-learnset__table">
              <thead>
                <tr>
                  <th>技名</th>
                  <th>タイプ</th>
                  <th>分類</th>
                  <th>威力</th>
                  <th>命中</th>
                  <th>優先</th>
                </tr>
              </thead>
              <tbody>
                {data.moves.map((m) => (
                  <tr key={m.move_key}>
                    <td>{m.name}</td>
                    <td>{m.type && <TypeBadge type={m.type} size="sm" />}</td>
                    <td className="ref-learnset__dmg-class">
                      {m.damage_class === "physical"
                        ? "物"
                        : m.damage_class === "special"
                          ? "特"
                          : m.damage_class === "status"
                            ? "変"
                            : ""}
                    </td>
                    <td>{m.power ?? "—"}</td>
                    <td>{m.accuracy ?? "—"}</td>
                    <td>{m.priority !== 0 ? `${m.priority > 0 ? "+" : ""}${m.priority}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="ref-placeholder">習得技データなし</div>
          )}
        </div>
      )}
    </>
  );
}

interface MoveNameRow {
  key: string;
  name: string;
}

function ByMoveView() {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [data, setData] = useState<ByMoveResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [moveNames, setMoveNames] = useState<MoveNameRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/move/names?lang=ja")
      .then((res) => (res.ok ? res.json() : null))
      .then((d: { moves?: MoveNameRow[] } | null) => {
        if (!cancelled && d?.moves) setMoveNames(d.moves);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return moveNames
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) || m.key.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, moveNames]);

  useEffect(() => {
    if (!selectedKey) {
      setData(null);
      return;
    }
    setLoading(true);
    let cancelled = false;
    fetch(`/api/pokemon/by-move/${selectedKey}?lang=ja`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d: ByMoveResponse | null) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);

  return (
    <>
      <div className="ref-learnset__search">
        <input
          type="text"
          className="ref-input"
          placeholder="技名で検索 (例: あくび, でんじは)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {suggestions.length > 0 && (
          <div className="ref-learnset__suggestions">
            {suggestions.map((s) => (
              <button
                key={s.key}
                type="button"
                className="ref-learnset__suggestion"
                onClick={() => {
                  setSelectedKey(s.key);
                  setQuery(s.name);
                }}
              >
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedKey && (
        <div className="ref-learnset__result">
          <div className="ref-learnset__header">
            <span className="ref-learnset__header-name">
              {moveNames.find((m) => m.key === selectedKey)?.name ?? selectedKey}
            </span>
            {data && (
              <span className="ref-learnset__count">{data.count} 匹</span>
            )}
          </div>
          {loading ? (
            <div className="ref-placeholder">読み込み中...</div>
          ) : data && data.pokemon.length > 0 ? (
            <div className="ref-learnset__pokemon-grid">
              {data.pokemon.map((p) => (
                <div key={p.pokemon_key} className="ref-learnset__pokemon-chip">
                  <PokemonSprite pokemonId={p.pokemon_key} size={28} />
                  <div className="ref-learnset__pokemon-info">
                    <div className="ref-learnset__pokemon-name">{p.name}</div>
                    <div className="ref-learnset__pokemon-types">
                      {p.types.map((t) => (
                        <TypeBadge
                          key={t}
                          type={t}
                          size="sm"
                          title={TYPE_LABELS[t]}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ref-placeholder">習得可能なポケモンなし</div>
          )}
        </div>
      )}
    </>
  );
}
