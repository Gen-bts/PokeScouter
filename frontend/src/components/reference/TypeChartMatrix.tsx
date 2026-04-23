import { useMemo } from "react";
import {
  ALL_TYPES,
  TYPE_CHART,
  effectivenessClass,
  formatMultiplier,
  type TypeName,
} from "../../utils/typeChart";
import { TYPE_LABELS } from "../../utils/typeLabels";

/**
 * 18x18 タイプ相性マトリクス.
 *
 * 行: 攻撃側タイプ, 列: 防御側タイプ.
 * セル: 倍率 (0, 0.5, 1, 2).
 */
export function TypeChartMatrix() {
  const rows = useMemo(() => {
    return ALL_TYPES.map((atk) => {
      const cells = ALL_TYPES.map((def) => {
        const v = (TYPE_CHART[atk] as Partial<Record<TypeName, number>>)[def];
        return v ?? 1;
      });
      return { atk, cells };
    });
  }, []);

  return (
    <div className="ref-type-chart">
      <div className="ref-type-chart__legend">
        <span className="ref-type-chart__legend-item type-eff-quad">×4</span>
        <span className="ref-type-chart__legend-item type-eff-super">×2</span>
        <span className="ref-type-chart__legend-item type-eff-neutral">×1</span>
        <span className="ref-type-chart__legend-item type-eff-resisted">×½</span>
        <span className="ref-type-chart__legend-item type-eff-immune">×0</span>
        <span className="ref-type-chart__legend-hint">
          行: 攻撃 / 列: 防御
        </span>
      </div>
      <div className="ref-type-chart__scroll">
        <table className="ref-type-chart__table">
          <thead>
            <tr>
              <th className="ref-type-chart__corner" />
              {ALL_TYPES.map((def) => (
                <th
                  key={def}
                  className="ref-type-chart__col-head"
                  data-type={def}
                  title={TYPE_LABELS[def]}
                >
                  {TYPE_LABELS[def]?.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.atk}>
                <th
                  className="ref-type-chart__row-head"
                  data-type={row.atk}
                  title={TYPE_LABELS[row.atk]}
                >
                  {TYPE_LABELS[row.atk]?.slice(0, 3)}
                </th>
                {row.cells.map((v, i) => (
                  <td
                    key={i}
                    className={`ref-type-chart__cell ${effectivenessClass(v)}`}
                    title={`${TYPE_LABELS[row.atk]} → ${TYPE_LABELS[ALL_TYPES[i]!]} ${formatMultiplier(v)}`}
                  >
                    {v === 1 ? "" : formatMultiplier(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
