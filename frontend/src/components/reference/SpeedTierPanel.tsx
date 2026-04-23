import { useMemo, useState } from "react";
import { useMyPartyStore } from "../../stores/useMyPartyStore";
import {
  useOpponentTeamStore,
  getEffectivePokemonKey,
} from "../../stores/useOpponentTeamStore";
import { usePokemonDetail } from "../../hooks/usePokemonDetail";
import { calcChampionsStat } from "../../utils/statCalc";
import { PokemonSprite } from "../PokemonSprite";

type ScarfMode = "none" | "scarf";
type FieldMode = "normal" | "trick-room" | "tailwind-self" | "tailwind-opp";

interface SpeedRow {
  side: "self" | "opponent";
  position: number;
  pokemonId: string;
  name: string;
  baseSpe: number | null;
  actualSpe: number | null;     // 実数値 (自分) / null (相手)
  sMin: number;                 // 無振り/逆補正/マイナス補正
  sNeutral: number;             // 無振り/中立
  sMax: number;                 // 252/プラス補正
}

function PartyRow({
  slot,
  opponent,
  scarf,
  field,
  onRowData,
}: {
  slot: {
    position: number;
    pokemonId: string | null;
    name: string | null;
  };
  opponent: boolean;
  scarf: boolean;
  field: FieldMode;
  onRowData: (row: SpeedRow | null) => void;
}) {
  void scarf;
  void field;
  const { detail } = usePokemonDetail(slot.pokemonId);
  const row = useMemo<SpeedRow | null>(() => {
    if (!slot.pokemonId || !slot.name || !detail) return null;
    const base = detail.base_stats.spe;
    const sMin = calcChampionsStat(base, 0, 0.9);
    const sNeutral = calcChampionsStat(base, 0, 1.0);
    const sMax = calcChampionsStat(base, 32, 1.1);
    return {
      side: opponent ? "opponent" : "self",
      position: slot.position,
      pokemonId: slot.pokemonId,
      name: slot.name,
      baseSpe: base,
      actualSpe: null,
      sMin,
      sNeutral,
      sMax,
    };
  }, [slot.pokemonId, slot.name, slot.position, opponent, detail]);

  // 親に通知 (副作用)
  useMemo(() => {
    onRowData(row);
  }, [row, onRowData]);

  return null;
}

/** スカーフ・追い風・トリックルーム等の global toggles を適用して実効速度を返す. */
function applyEffects(
  speed: number,
  side: "self" | "opponent",
  scarf: boolean,
  field: FieldMode,
): number {
  let s = speed;
  if (scarf) s = Math.floor(s * 1.5);
  if (field === "tailwind-self" && side === "self") s *= 2;
  if (field === "tailwind-opp" && side === "opponent") s *= 2;
  return s;
}

export function SpeedTierPanel() {
  const mySlots = useMyPartyStore((s) => s.slots);
  const opSlots = useOpponentTeamStore((s) => s.slots);

  const [scarf, setScarf] = useState<ScarfMode>("none");
  const [field, setField] = useState<FieldMode>("normal");

  // 子 hook のアンサー集約
  const [rows, setRows] = useState<Record<string, SpeedRow | null>>({});
  const upsertRow = (key: string) => (row: SpeedRow | null) => {
    setRows((prev) => {
      const curr = prev[key];
      if (curr === row) return prev;
      if (
        curr?.pokemonId === row?.pokemonId &&
        curr?.sNeutral === row?.sNeutral &&
        curr?.side === row?.side
      ) {
        return prev;
      }
      return { ...prev, [key]: row };
    });
  };

  const allRows = useMemo(() => {
    const arr = Object.values(rows).filter((r): r is SpeedRow => r !== null);
    // 表示用速度を計算してからソート (降順)
    const withDisplay = arr.map((r) => ({
      ...r,
      displaySpeed: applyEffects(r.sNeutral, r.side, scarf === "scarf", field),
      displayMax: applyEffects(r.sMax, r.side, scarf === "scarf", field),
      displayMin: applyEffects(r.sMin, r.side, scarf === "scarf", field),
    }));
    return withDisplay.sort((a, b) =>
      field === "trick-room"
        ? a.displaySpeed - b.displaySpeed
        : b.displaySpeed - a.displaySpeed,
    );
  }, [rows, scarf, field]);

  // 有効スロットからキーを導出
  const validSelfSlots = mySlots.filter((s) => s.pokemonId && s.name);
  const validOpSlots = opSlots.filter((s) => s.pokemonId && s.name);

  return (
    <div className="ref-speed">
      <div className="ref-speed__controls">
        <label className="ref-speed__ctl">
          <input
            type="checkbox"
            checked={scarf === "scarf"}
            onChange={(e) => setScarf(e.target.checked ? "scarf" : "none")}
          />
          全員こだわりスカーフ相当 (×1.5)
        </label>
        <select
          className="ref-speed__select"
          value={field}
          onChange={(e) => setField(e.target.value as FieldMode)}
        >
          <option value="normal">通常場</option>
          <option value="trick-room">トリックルーム</option>
          <option value="tailwind-self">追い風 (自分側)</option>
          <option value="tailwind-opp">追い風 (相手側)</option>
        </select>
      </div>

      {/* 子コンポーネント: base stats を非同期取得して親へ通知 */}
      {validSelfSlots.map((s) => (
        <PartyRow
          key={`self-${s.position}-${s.pokemonId}`}
          slot={{ position: s.position, pokemonId: s.pokemonId, name: s.name }}
          opponent={false}
          scarf={scarf === "scarf"}
          field={field}
          onRowData={upsertRow(`self-${s.position}-${s.pokemonId}`)}
        />
      ))}
      {validOpSlots.map((s) => {
        const effKey = getEffectivePokemonKey(s);
        return (
          <PartyRow
            key={`op-${s.position}-${effKey}`}
            slot={{ position: s.position, pokemonId: effKey, name: s.name }}
            opponent
            scarf={scarf === "scarf"}
            field={field}
            onRowData={upsertRow(`op-${s.position}-${effKey}`)}
          />
        );
      })}

      {allRows.length === 0 ? (
        <div className="ref-speed__placeholder">
          対戦参加ポケモンが判明すると速度帯が表示されます。
        </div>
      ) : (
        <table className="ref-speed__table">
          <thead>
            <tr>
              <th>側</th>
              <th>ポケモン</th>
              <th title="無振り/マイナス補正 (最遅)">S最遅</th>
              <th title="無振り/中性 (基準)">S基準</th>
              <th title="252振り/プラス補正 (最速)">S最速</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((row, i) => (
              <tr
                key={i}
                className={row.side === "self" ? "ref-speed__row-self" : "ref-speed__row-op"}
              >
                <td>{row.side === "self" ? "自" : "相"}</td>
                <td className="ref-speed__row-name">
                  <PokemonSprite pokemonId={row.pokemonId} size={24} />
                  <span>{row.name}</span>
                  {row.baseSpe != null && (
                    <span className="ref-speed__base">(種族 {row.baseSpe})</span>
                  )}
                </td>
                <td>{row.displayMin}</td>
                <td className="ref-speed__neutral">{row.displaySpeed}</td>
                <td>{row.displayMax}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
