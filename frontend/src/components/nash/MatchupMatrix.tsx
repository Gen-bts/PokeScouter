import { useMyPartyStore } from "../../stores/useMyPartyStore";
import { useOpponentTeamStore, getEffectivePokemonKey } from "../../stores/useOpponentTeamStore";
import { PokemonSprite } from "../PokemonSprite";

interface Props {
  matrix: number[][]; // 6×6 ペイオフ
}

/** ペイオフ値に応じた色を返す (-1=赤 / 0=灰 / +1=青). */
function payoffColor(v: number): string {
  const clamped = Math.max(-1, Math.min(1, v));
  if (clamped > 0) {
    const intensity = Math.round(clamped * 100);
    return `rgba(80, 180, 255, ${0.15 + clamped * 0.5}) /* +${intensity}% */`;
  } else if (clamped < 0) {
    const intensity = Math.round(-clamped * 100);
    return `rgba(255, 100, 100, ${0.15 + -clamped * 0.5}) /* -${intensity}% */`;
  }
  return "rgba(255, 255, 255, 0.04)";
}

/**
 * 6×6 単体対面勝率ヒートマップ.
 * 行 = 自分 6 匹, 列 = 相手 6 匹.
 */
export function MatchupMatrix({ matrix }: Props) {
  const mySlots = useMyPartyStore((s) => s.slots);
  const opSlots = useOpponentTeamStore((s) => s.slots);

  const mySpecies = mySlots.map((s) => s.pokemonId);
  const opSpecies = opSlots.map((s) => getEffectivePokemonKey(s));

  return (
    <div className="nash-matchup">
      <div className="nash-matchup__title">単体対面ヒートマップ (6 × 6)</div>
      <table className="nash-matchup__table">
        <thead>
          <tr>
            <th className="nash-matchup__corner">自 ↓ / 相 →</th>
            {opSpecies.map((sp, j) => (
              <th key={j} className="nash-matchup__head">
                {sp ? <PokemonSprite pokemonId={sp} size={28} /> : <span>—</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <th className="nash-matchup__head">
                {mySpecies[i] ? (
                  <PokemonSprite pokemonId={mySpecies[i]!} size={28} />
                ) : (
                  <span>—</span>
                )}
              </th>
              {row.map((v, j) => (
                <td
                  key={j}
                  className="nash-matchup__cell"
                  style={{ background: payoffColor(v) }}
                  title={`${v >= 0 ? "+" : ""}${v.toFixed(2)}`}
                >
                  {v >= 0 ? "+" : ""}
                  {v.toFixed(2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="nash-matchup__legend">
        <span className="nash-matchup__legend-item" style={{ background: "rgba(255, 100, 100, 0.5)" }}>
          不利 (-1)
        </span>
        <span className="nash-matchup__legend-item" style={{ background: "rgba(255, 255, 255, 0.05)" }}>
          互角 (0)
        </span>
        <span className="nash-matchup__legend-item" style={{ background: "rgba(80, 180, 255, 0.5)" }}>
          有利 (+1)
        </span>
      </div>
    </div>
  );
}
