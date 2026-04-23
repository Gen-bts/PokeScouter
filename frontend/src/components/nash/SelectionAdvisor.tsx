import { useMyPartyStore } from "../../stores/useMyPartyStore";
import { useOpponentTeamStore, getEffectivePokemonKey } from "../../stores/useOpponentTeamStore";
import { PokemonSprite } from "../PokemonSprite";
import type { NashStrategyEntry } from "../../stores/useNashStore";

interface Props {
  recommendedPick: number[];
  strategyA: NashStrategyEntry[];
  strategyB: NashStrategyEntry[];
  value: number;
}

function formatWinRate(value: number): string {
  // value ∈ [-1, +1] を勝率 % に: win% = 50 + 50 * value
  const winPct = 50 + 50 * value;
  return `${winPct.toFixed(1)}%`;
}

/**
 * 選出提案: 自分チームの推奨 3 匹 + 期待勝率 + 相手選出戦略上位.
 */
export function SelectionAdvisor({
  recommendedPick,
  strategyA,
  strategyB,
  value,
}: Props) {
  const mySlots = useMyPartyStore((s) => s.slots);
  const opSlots = useOpponentTeamStore((s) => s.slots);

  const mySpecies = mySlots.map((s) => s.pokemonId);
  const opSpecies = opSlots.map((s) => getEffectivePokemonKey(s));

  const topOpponentStrategies = [...strategyB]
    .sort((a, b) => b.p - a.p)
    .slice(0, 5)
    .filter((s) => s.p > 0.01);

  const topSelfStrategies = [...strategyA]
    .sort((a, b) => b.p - a.p)
    .slice(0, 3)
    .filter((s) => s.p > 0.01);

  return (
    <div className="nash-advisor">
      <div className="nash-advisor__headline">
        <span className="nash-advisor__label">推奨選出</span>
        <div className="nash-advisor__picks">
          {recommendedPick.map((idx) => {
            const species = mySpecies[idx];
            return species ? (
              <div key={idx} className="nash-advisor__pick">
                <PokemonSprite pokemonId={species} size={44} />
              </div>
            ) : (
              <div key={idx} className="nash-advisor__pick-empty">?</div>
            );
          })}
        </div>
        <div className="nash-advisor__winrate">
          <span className="nash-advisor__winrate-label">期待勝率</span>
          <span
            className={`nash-advisor__winrate-value ${value > 0.1 ? "favorable" : value < -0.1 ? "unfavorable" : "neutral"}`}
          >
            {formatWinRate(value)}
          </span>
        </div>
      </div>

      {topSelfStrategies.length > 1 && (
        <div className="nash-advisor__section">
          <div className="nash-advisor__section-title">自分の選出混合戦略上位</div>
          <div className="nash-advisor__strategies">
            {topSelfStrategies.map((s, i) => (
              <StrategyRow
                key={i}
                pick={s.pick}
                probability={s.p}
                speciesMap={mySpecies}
              />
            ))}
          </div>
        </div>
      )}

      {topOpponentStrategies.length > 0 && (
        <div className="nash-advisor__section">
          <div className="nash-advisor__section-title">相手の選出予測 (Nash)</div>
          <div className="nash-advisor__strategies">
            {topOpponentStrategies.map((s, i) => (
              <StrategyRow
                key={i}
                pick={s.pick}
                probability={s.p}
                speciesMap={opSpecies}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StrategyRow({
  pick,
  probability,
  speciesMap,
}: {
  pick: number[];
  probability: number;
  speciesMap: (string | null)[];
}) {
  return (
    <div className="nash-advisor__strategy-row">
      <div className="nash-advisor__strategy-sprites">
        {pick.map((idx) => {
          const species = speciesMap[idx];
          return species ? (
            <PokemonSprite key={idx} pokemonId={species} size={22} />
          ) : null;
        })}
      </div>
      <div className="nash-advisor__strategy-bar">
        <div
          className="nash-advisor__strategy-bar-fill"
          style={{ width: `${Math.round(probability * 100)}%` }}
        />
        <span className="nash-advisor__strategy-pct">
          {(probability * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
