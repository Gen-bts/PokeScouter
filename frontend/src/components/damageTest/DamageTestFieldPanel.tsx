import { useDamageTestStore, type SideFlags } from "../../stores/useDamageTestStore";

const WEATHERS: Array<{ value: string | null; label: string }> = [
  { value: null, label: "なし" },
  { value: "Sun", label: "はれ" },
  { value: "Rain", label: "あめ" },
  { value: "Sand", label: "すなあらし" },
  { value: "Snow", label: "ゆき" },
];

const TERRAINS: Array<{ value: string | null; label: string }> = [
  { value: null, label: "なし" },
  { value: "Electric", label: "エレキフィールド" },
  { value: "Grassy", label: "グラスフィールド" },
  { value: "Psychic", label: "サイコフィールド" },
  { value: "Misty", label: "ミストフィールド" },
];

const SIDE_FLAG_LABELS: Array<{ key: keyof SideFlags; label: string }> = [
  { key: "reflect", label: "リフレクター" },
  { key: "light_screen", label: "ひかりのかべ" },
  { key: "aurora_veil", label: "オーロラベール" },
  { key: "tailwind", label: "おいかぜ" },
];

export function DamageTestFieldPanel() {
  const field = useDamageTestStore((s) => s.field);
  const setField = useDamageTestStore((s) => s.setField);

  return (
    <div className="dt-field-panel">
      <h3>状況</h3>
      <div className="dt-field-row">
        <div className="dt-field-cell">
          <label className="dt-label">天候</label>
          <select
            value={field.weather ?? ""}
            onChange={(e) =>
              setField((p) => ({ ...p, weather: e.target.value || null }))
            }
            className="dt-select"
          >
            {WEATHERS.map((w) => (
              <option key={w.value ?? "none"} value={w.value ?? ""}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
        <div className="dt-field-cell">
          <label className="dt-label">フィールド</label>
          <select
            value={field.terrain ?? ""}
            onChange={(e) =>
              setField((p) => ({ ...p, terrain: e.target.value || null }))
            }
            className="dt-select"
          >
            {TERRAINS.map((t) => (
              <option key={t.value ?? "none"} value={t.value ?? ""}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="dt-field-row dt-field-sides">
        <div className="dt-field-side">
          <h4>攻撃側</h4>
          {SIDE_FLAG_LABELS.map(({ key, label }) => (
            <label key={key} className="dt-field-check">
              <input
                type="checkbox"
                checked={field.attackerSide[key]}
                onChange={(e) =>
                  setField((p) => ({
                    ...p,
                    attackerSide: { ...p.attackerSide, [key]: e.target.checked },
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <div className="dt-field-side">
          <h4>防御側</h4>
          {SIDE_FLAG_LABELS.map(({ key, label }) => (
            <label key={key} className="dt-field-check">
              <input
                type="checkbox"
                checked={field.defenderSide[key]}
                onChange={(e) =>
                  setField((p) => ({
                    ...p,
                    defenderSide: { ...p.defenderSide, [key]: e.target.checked },
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
