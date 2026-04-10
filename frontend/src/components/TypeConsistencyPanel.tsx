import { useMemo } from "react";
import { useTypeConsistency } from "../hooks/useTypeConsistency";
import { TYPE_LABELS } from "../utils/typeLabels";
import { TypeBadge } from "./TypeBadge";
import type { TypeConsistencyEntry } from "../types";

interface CoverageGroup {
  count: number;
  entries: TypeConsistencyEntry[];
}

function getCoverageCount(entry: TypeConsistencyEntry): number {
  return entry.per_pokemon.filter((p) => p.effectiveness >= 1.0).length;
}

function formatEffectiveness(value: number): string {
  if (value === 0) return "x0";
  if (value % 1 === 0) return `x${value}`;
  return `x${value.toFixed(1)}`;
}

export function TypeConsistencyPanel({
  onTypeHover,
}: {
  onTypeHover?: (entry: TypeConsistencyEntry | null) => void;
}) {
  const { result } = useTypeConsistency();

  const groups = useMemo<CoverageGroup[]>(() => {
    if (!result || result.pokemon_count === 0) return [];

    const withCoverage = result.results
      .map((e) => ({ entry: e, count: getCoverageCount(e) }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count || b.entry.min_effectiveness - a.entry.min_effectiveness);

    const grouped = new Map<number, TypeConsistencyEntry[]>();
    for (const { entry, count } of withCoverage) {
      const list = grouped.get(count);
      if (list) list.push(entry);
      else grouped.set(count, [entry]);
    }

    return Array.from(grouped, ([count, entries]) => ({ count, entries }));
  }, [result]);

  if (!result || groups.length === 0) return null;

  const total = groups.reduce((s, g) => s + g.entries.length, 0);

  return (
    <div className="type-consistency">
      <h3>タイプ一貫 ({total})</h3>
      <div className="tc-groups">
        {groups.map((g) => (
          <div key={g.count} className="tc-group">
            <div className="tc-group-header">
              <span className="tc-group-fraction">
                {g.count}/{result.pokemon_count}
              </span>
              {g.count === result.pokemon_count && (
                <span className="tc-group-label">全一貫</span>
              )}
            </div>
            <div className="tc-group-types">
              {g.entries.map((entry) => (
                <TypeBadge
                  key={entry.type}
                  type={entry.type}
                  className="tc-type-row"
                  title={`${TYPE_LABELS[entry.type] ?? entry.name}: ${g.count}/${result.pokemon_count} 最小倍率 ${formatEffectiveness(entry.min_effectiveness)}`}
                  onMouseEnter={onTypeHover ? () => onTypeHover(entry) : undefined}
                  onMouseLeave={onTypeHover ? () => onTypeHover(null) : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
