import { Router } from "express";
import { createValidator } from "../showdown/runtime.js";
import { loadSnapshot } from "../showdown/snapshot.js";

interface ValidationSetInput {
  pokemon_key: string;
  move_keys: string[];
  ability_key?: string | null;
  item_key?: string | null;
  nature?: string | null;
  evs?: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>;
  level?: number | null;
}

interface ValidationBody {
  sets: ValidationSetInput[];
}

const router = Router();

router.post("/calc/validate", (req, res) => {
  const body = req.body as ValidationBody;
  if (!Array.isArray(body?.sets) || body.sets.length === 0) {
    res.status(400).json({ error: "sets must be a non-empty array" });
    return;
  }

  try {
    const snapshot = loadSnapshot();
    const validator = createValidator(snapshot.format.format_name);
    const showdownSets = body.sets.map((set) => toShowdownSet(snapshot, set));
    const problems = body.sets.length === 1
      ? validator.validateSet(showdownSets[0], {})
      : validator.validateTeam(showdownSets);

    res.json({
      valid: !problems,
      problems: problems ?? [],
    });
  } catch (err) {
    console.error("Validation error:", err);
    res.status(500).json({
      error: "Internal validation error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

function toShowdownSet(snapshot: ReturnType<typeof loadSnapshot>, set: ValidationSetInput) {
  const pokemon = snapshot.pokemon[set.pokemon_key];
  if (!pokemon) {
    throw new Error(`Unknown pokemon_key: ${set.pokemon_key}`);
  }

  const abilityKey = set.ability_key ?? pokemon.abilities.normal[0] ?? pokemon.abilities.hidden;
  const itemKey = set.item_key ?? null;
  const natureKey = set.nature ?? "serious";
  const moveNames = set.move_keys.map((moveKey) => {
    const move = snapshot.moves[moveKey];
    if (!move) throw new Error(`Unknown move_key: ${moveKey}`);
    return move.name;
  });

  return {
    name: pokemon.base_species_name,
    species: pokemon.name,
    item: itemKey ? snapshot.items[itemKey]?.name ?? "" : "",
    ability: abilityKey ? snapshot.abilities[abilityKey]?.name ?? "" : "",
    moves: moveNames,
    nature: snapshot.natures[natureKey]?.name ?? "Serious",
    evs: {
      hp: set.evs?.hp ?? 1,
      atk: set.evs?.atk ?? 0,
      def: set.evs?.def ?? 0,
      spa: set.evs?.spa ?? 0,
      spd: set.evs?.spd ?? 0,
      spe: set.evs?.spe ?? 0,
    },
    level: set.level ?? 50,
  };
}

export default router;
