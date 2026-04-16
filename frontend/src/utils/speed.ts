import type {
  FieldSnapshot,
  InferredSpeedBounds,
  SpeedContext,
  SpeedObservation,
  ValidatedField,
} from "../types";
import { calcChampionsStat } from "./statCalc";

export const BATTLE_TURN_SCENES = new Set([
  "battle",
  "battle_Neutral",
  "move_select",
  "pokemon_summary",
]);

const WEATHER_SPEED_ABILITIES: Record<string, string> = {
  chlorophyll: "sun",
  swiftswim: "rain",
  sandrush: "sand",
  slushrush: "snow",
};

const TERRAIN_SPEED_ABILITIES: Record<string, string> = {
  surgesurfer: "electric",
};

const NATURE_MODIFIERS = [0.9, 1.0, 1.1] as const;

export interface SpeedComparisonResult {
  mySpeed: number;
  minSpeed: number;
  maxSpeed: number;
  narrowed: boolean;
  verdict: "faster" | "slower" | "uncertain";
}

export function isBattleTurnScene(scene: string): boolean {
  return BATTLE_TURN_SCENES.has(scene);
}

export function isNeutralBattleScene(scene: string): boolean {
  return scene === "battle_Neutral";
}

export function emptyBounds(): InferredSpeedBounds {
  return { minSpeed: null, maxSpeed: null };
}

export function fieldToInt(field: ValidatedField | undefined): number | null {
  if (!field) return null;
  const value = field.validated ?? field.raw;
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function fieldToKey(field: ValidatedField | undefined): string | null {
  return field?.matched_key ?? field?.matched_id ?? null;
}

export function boostMultiplier(stages: number): number {
  if (stages >= 0) return (2 + stages) / 2;
  return 2 / (2 - stages);
}

function normalizeTerrain(terrain: string | null): string | null {
  if (terrain == null) return null;
  return terrain.toLowerCase().replace(/[_\s-]/g, "");
}

function inferNatureMod(actualSpeed: number, baseSpeed: number, statPoints: number): number {
  for (const mod of NATURE_MODIFIERS) {
    if (calcChampionsStat(baseSpeed, statPoints, mod) === actualSpeed) {
      return mod;
    }
  }

  let best = 1.0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const mod of NATURE_MODIFIERS) {
    const candidate = calcChampionsStat(baseSpeed, statPoints, mod);
    const diff = Math.abs(candidate - actualSpeed);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = mod;
    }
  }
  return best;
}

export function resolveMegaAdjustedActualSpeed(context: SpeedContext): number | null {
  if (!context.isMegaEvolved || context.megaBaseSpeed == null) {
    return context.actualSpeed;
  }
  if (
    context.actualSpeed == null ||
    context.speedStatPoints == null ||
    context.baseSpeed == null
  ) {
    return context.actualSpeed;
  }
  const natureMod = inferNatureMod(
    context.actualSpeed,
    context.baseSpeed,
    context.speedStatPoints,
  );
  return calcChampionsStat(
    context.megaBaseSpeed,
    context.speedStatPoints,
    natureMod,
  );
}

export function getBaseActualSpeed(context: SpeedContext): number | null {
  return resolveMegaAdjustedActualSpeed(context);
}

export function getSpeedModifierMultiplier(
  context: SpeedContext,
  field: FieldSnapshot,
): number {
  let mult = boostMultiplier(context.speBoost);

  if (context.tailwind) {
    mult *= 2;
  }
  if (context.itemId === "choicescarf") {
    mult *= 1.5;
  }

  if (context.abilityId) {
    const requiredWeather = WEATHER_SPEED_ABILITIES[context.abilityId];
    if (requiredWeather && requiredWeather === field.weather) {
      mult *= 2;
    }

    const requiredTerrain = TERRAIN_SPEED_ABILITIES[context.abilityId];
    if (
      requiredTerrain &&
      requiredTerrain === normalizeTerrain(field.terrain)
    ) {
      mult *= 2;
    }
  }

  return mult;
}

export function getEffectiveSpeed(
  context: SpeedContext,
  field: FieldSnapshot,
): number | null {
  const actualSpeed = getBaseActualSpeed(context);
  if (actualSpeed == null) return null;
  return Math.floor(actualSpeed * getSpeedModifierMultiplier(context, field));
}

export function inferBoundsFromObservation(
  observation: SpeedObservation,
  resolvedOpponentContext?: SpeedContext,
): InferredSpeedBounds | null {
  const playerContext = {
    ...observation.playerSpeedContext,
    actualSpeed: observation.playerBaseSpeed,
  };
  const opponentContext = resolvedOpponentContext ?? observation.opponentSpeedContext;
  const playerEffectiveSpeed = getEffectiveSpeed(
    playerContext,
    observation.fieldSnapshotAtTurnStart,
  );
  const opponentMultiplier = getSpeedModifierMultiplier(
    opponentContext,
    observation.fieldSnapshotAtTurnStart,
  );

  if (playerEffectiveSpeed == null || opponentMultiplier <= 0) {
    return null;
  }

  const fasterGoesFirst = !observation.fieldSnapshotAtTurnStart.trickRoom;
  const playerMovedFirst = observation.firstMover === "player";

  if (playerMovedFirst === fasterGoesFirst) {
    return {
      minSpeed: null,
      maxSpeed: Math.ceil(playerEffectiveSpeed / opponentMultiplier) - 1,
    };
  }

  return {
    minSpeed: Math.floor(playerEffectiveSpeed / opponentMultiplier) + 1,
    maxSpeed: null,
  };
}

export function mergeBounds(
  current: InferredSpeedBounds,
  next: InferredSpeedBounds,
): InferredSpeedBounds {
  return {
    minSpeed:
      current.minSpeed != null && next.minSpeed != null
        ? Math.max(current.minSpeed, next.minSpeed)
        : (next.minSpeed ?? current.minSpeed),
    maxSpeed:
      current.maxSpeed != null && next.maxSpeed != null
        ? Math.min(current.maxSpeed, next.maxSpeed)
        : (next.maxSpeed ?? current.maxSpeed),
  };
}

export function buildSpeedComparison(
  playerContext: SpeedContext | null,
  opponentBaseSpeed: number | undefined,
  opponentContext: SpeedContext | null,
  field: FieldSnapshot | null,
  inferredBounds: InferredSpeedBounds | null,
): SpeedComparisonResult | null {
  if (!playerContext || !opponentContext || field == null || opponentBaseSpeed == null) {
    return null;
  }

  const mySpeed = getEffectiveSpeed(playerContext, field);
  if (mySpeed == null) {
    return null;
  }

  let minSpeed = calcChampionsStat(opponentBaseSpeed, 0, 1.0);
  let maxSpeed = calcChampionsStat(opponentBaseSpeed, 32, 1.1);
  let narrowed = false;

  if (inferredBounds) {
    if (inferredBounds.minSpeed != null && inferredBounds.minSpeed > minSpeed) {
      minSpeed = inferredBounds.minSpeed;
      narrowed = true;
    }
    if (inferredBounds.maxSpeed != null && inferredBounds.maxSpeed < maxSpeed) {
      maxSpeed = inferredBounds.maxSpeed;
      narrowed = true;
    }
  }

  const opponentMultiplier = getSpeedModifierMultiplier(opponentContext, field);
  minSpeed = Math.floor(minSpeed * opponentMultiplier);
  maxSpeed = Math.floor(maxSpeed * opponentMultiplier);

  let verdict: SpeedComparisonResult["verdict"] = "uncertain";
  if (mySpeed > maxSpeed) {
    verdict = "faster";
  } else if (mySpeed < minSpeed) {
    verdict = "slower";
  }

  return {
    mySpeed,
    minSpeed,
    maxSpeed,
    narrowed,
    verdict,
  };
}
