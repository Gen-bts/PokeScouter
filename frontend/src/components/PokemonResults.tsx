import type { PokemonIdentifiedResult } from "../types";

interface Props {
  result: PokemonIdentifiedResult | null;
}

export function PokemonResults({ result }: Props) {
  if (!result || result.pokemon.length === 0) return null;

  const identified = result.pokemon.filter((p) => p.pokemon_id !== null);

  return (
    <section className="pokemon-results">
      <h3>
        相手ポケモン ({identified.length}/{result.pokemon.length})
        <span className="elapsed">{result.elapsed_ms.toFixed(0)}ms</span>
      </h3>
      <ul className="pokemon-list">
        {result.pokemon.map((p) => (
          <li key={p.position} className={p.pokemon_id ? "identified" : "unknown"}>
            <span className="position">#{p.position}</span>
            {p.pokemon_id ? (
              <>
                <span className="pokemon-id">No.{p.pokemon_id}</span>
                <span className="confidence">
                  {(p.confidence * 100).toFixed(1)}%
                </span>
              </>
            ) : (
              <span className="pokemon-id unknown-label">不明</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
