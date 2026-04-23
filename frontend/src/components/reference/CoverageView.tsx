import { useMemo, useState } from "react";
import {
  ALL_TYPES,
  analyzeCoverage,
  type TypeName,
} from "../../utils/coverage";
import { effectivenessClass, formatMultiplier } from "../../utils/typeChart";
import { TYPE_LABELS } from "../../utils/typeLabels";
import { TypeBadge } from "../TypeBadge";
import { useOpponentTeamStore } from "../../stores/useOpponentTeamStore";

const MAX_MOVES = 4;

/**
 * 技範囲 (coverage) 分析ビュー.
 *
 * 技タイプを最大 4 つ選択し、全 18 単タイプ + 153 ペアに対する最高倍率を
 * 一覧表示する。不通過タイプと完全無効タイプをハイライト。
 *
 * 「対面の既知技から読込」ボタンで、現在選択中の相手スロットの判明技を取り込む。
 */
export function CoverageView() {
  const [selected, setSelected] = useState<TypeName[]>([]);

  const displaySelectedPosition = useOpponentTeamStore(
    (s) => s.displaySelectedPosition,
  );
  const opponentSlots = useOpponentTeamStore((s) => s.slots);

  const currentOpponentSlot =
    displaySelectedPosition != null
      ? opponentSlots[displaySelectedPosition - 1]
      : null;

  const analysis = useMemo(() => analyzeCoverage(selected), [selected]);

  const toggleType = (t: TypeName) => {
    setSelected((prev) => {
      if (prev.includes(t)) return prev.filter((p) => p !== t);
      if (prev.length >= MAX_MOVES) return prev;
      return [...prev, t];
    });
  };

  const [loadingOpponent, setLoadingOpponent] = useState(false);

  const loadFromOpponentKnown = async () => {
    if (!currentOpponentSlot?.pokemonId) return;
    const moveIds = currentOpponentSlot.knownMoves.map((m) => m.id);
    if (moveIds.length === 0) return;

    setLoadingOpponent(true);
    try {
      // 各 move_key から type を個別に解決 (/api/move/:key)
      const results = await Promise.all(
        moveIds.map((id) =>
          fetch(`/api/move/${id}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { type?: string } | null) => d?.type ?? null)
            .catch(() => null),
        ),
      );
      const moveTypes = new Set<TypeName>();
      for (const t of results) {
        if (t && (ALL_TYPES as readonly string[]).includes(t.toLowerCase())) {
          moveTypes.add(t.toLowerCase() as TypeName);
        }
      }
      setSelected(Array.from(moveTypes).slice(0, MAX_MOVES));
    } finally {
      setLoadingOpponent(false);
    }
  };

  const clear = () => setSelected([]);

  return (
    <div className="ref-coverage">
      <div className="ref-coverage__controls">
        <div className="ref-coverage__instruction">
          技タイプを最大 {MAX_MOVES} つ選択 ({selected.length} / {MAX_MOVES})
        </div>
        <div className="ref-coverage__actions">
          <button
            type="button"
            className="ref-btn"
            disabled={
              !currentOpponentSlot?.pokemonId ||
              currentOpponentSlot.knownMoves.length === 0 ||
              loadingOpponent
            }
            onClick={loadFromOpponentKnown}
            title="選択中の相手の既知技から自動で読み込む"
          >
            {loadingOpponent ? "読込中…" : "相手の既知技から"}
          </button>
          <button
            type="button"
            className="ref-btn"
            disabled={selected.length === 0}
            onClick={clear}
          >
            クリア
          </button>
        </div>
      </div>

      <div className="ref-coverage__type-picker">
        {ALL_TYPES.map((t) => {
          const isActive = selected.includes(t);
          const disabled = !isActive && selected.length >= MAX_MOVES;
          return (
            <button
              key={t}
              type="button"
              className={`ref-coverage__type-btn ${isActive ? "ref-coverage__type-btn--active" : ""}`}
              disabled={disabled}
              onClick={() => toggleType(t)}
            >
              <TypeBadge type={t} size="sm" />
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <>
          <div className="ref-coverage__summary">
            <div className="ref-coverage__count type-eff-quad">
              4x: {analysis.counts.quadruple}
            </div>
            <div className="ref-coverage__count type-eff-super">
              2x: {analysis.counts.super}
            </div>
            <div className="ref-coverage__count type-eff-neutral">
              等倍: {analysis.counts.neutral}
            </div>
            <div className="ref-coverage__count type-eff-resisted">
              半減: {analysis.counts.resisted}
            </div>
            <div className="ref-coverage__count type-eff-immune">
              無効: {analysis.counts.immune}
            </div>
            <div className="ref-coverage__total">合計 171 型組合せ</div>
          </div>

          <div className="ref-coverage__grid-wrapper">
            <div className="ref-coverage__grid-title">単タイプ (18 件)</div>
            <div className="ref-coverage__grid ref-coverage__grid--single">
              {analysis.entries
                .filter((e) => e.defenderTypes.length === 1)
                .map((entry, i) => (
                  <CoverageCell key={i} entry={entry} />
                ))}
            </div>
            {analysis.notEffective.length > 0 && (
              <>
                <div className="ref-coverage__grid-title">
                  通りにくい型組合せ ({analysis.notEffective.length} 件、半減以下しか入らない)
                </div>
                <div className="ref-coverage__grid">
                  {analysis.notEffective.slice(0, 60).map((entry, i) => (
                    <CoverageCell key={i} entry={entry} />
                  ))}
                </div>
              </>
            )}
            {analysis.immune.length > 0 && (
              <>
                <div className="ref-coverage__grid-title">
                  完全無効 ({analysis.immune.length} 件)
                </div>
                <div className="ref-coverage__grid">
                  {analysis.immune.map((entry, i) => (
                    <CoverageCell key={i} entry={entry} />
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CoverageCell({
  entry,
}: {
  entry: import("../../utils/coverage").CoverageEntry;
}) {
  const label = entry.defenderTypes
    .map((t) => TYPE_LABELS[t] ?? t)
    .join("/");
  return (
    <div
      className={`ref-coverage__cell ${effectivenessClass(entry.bestMultiplier)}`}
      title={`${label} ${formatMultiplier(entry.bestMultiplier)}${entry.bestMoveType ? ` (${TYPE_LABELS[entry.bestMoveType]})` : ""}`}
    >
      <span className="ref-coverage__cell-types">{label}</span>
      <span className="ref-coverage__cell-mult">
        {formatMultiplier(entry.bestMultiplier)}
      </span>
    </div>
  );
}
