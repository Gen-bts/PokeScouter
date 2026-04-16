import { create } from "zustand";
import type {
  InferredSpeedBounds,
  ResolvedTurnSummary,
  SpeedContext,
  SpeedObservation,
} from "../types";
import {
  emptyBounds,
  inferBoundsFromObservation,
  mergeBounds,
} from "../utils/speed";
import { useOpponentTeamStore } from "./useOpponentTeamStore";

function syncInferredBoundsToOpponentSlots(
  inferredBounds: Record<string, InferredSpeedBounds>,
): void {
  useOpponentTeamStore.getState().applyInferredSpeedMap(inferredBounds);
}

interface ConsumeTurnResult {
  applied: boolean;
  note: string | null;
}

interface SpeedInferenceState {
  inferredBounds: Record<string, InferredSpeedBounds>;
  observations: Record<string, SpeedObservation[]>;
  consumeResolvedTurn: (turn: ResolvedTurnSummary) => ConsumeTurnResult;
  refreshInferences: () => void;
  reset: () => void;
}

function resolveOpponentContext(observation: SpeedObservation): SpeedContext {
  const slot = useOpponentTeamStore
    .getState()
    .slots.find((entry) => entry.pokemonId === observation.opponentPokemonKey);

  return {
    ...observation.opponentSpeedContext,
    abilityId: slot?.abilityId ?? observation.opponentSpeedContext.abilityId,
    itemId: slot?.itemId ?? observation.opponentSpeedContext.itemId,
    itemIdentifier:
      slot?.itemIdentifier ?? observation.opponentSpeedContext.itemIdentifier,
    megaPokemonKey:
      slot?.activeMegaIndex != null
        ? (slot.megaForms[slot.activeMegaIndex]?.pokemon_key ??
          observation.opponentSpeedContext.megaPokemonKey)
        : observation.opponentSpeedContext.megaPokemonKey,
    megaBaseSpeed:
      slot?.activeMegaIndex != null
        ? (slot.megaForms[slot.activeMegaIndex]?.base_stats.spe ??
          observation.opponentSpeedContext.megaBaseSpeed)
        : observation.opponentSpeedContext.megaBaseSpeed,
  };
}

function rebuildBounds(
  observations: Record<string, SpeedObservation[]>,
): Record<string, InferredSpeedBounds> {
  const inferredBounds: Record<string, InferredSpeedBounds> = {};

  for (const [pokemonKey, pokemonObservations] of Object.entries(observations)) {
    let combinedBounds = emptyBounds();
    let hasBounds = false;

    for (const observation of pokemonObservations) {
      const nextBounds = inferBoundsFromObservation(
        observation,
        resolveOpponentContext(observation),
      );
      if (!nextBounds) {
        continue;
      }
      combinedBounds = hasBounds
        ? mergeBounds(combinedBounds, nextBounds)
        : nextBounds;
      hasBounds = true;
    }

    if (hasBounds) {
      inferredBounds[pokemonKey] = combinedBounds;
    }
  }

  return inferredBounds;
}

function buildObservation(turn: ResolvedTurnSummary): SpeedObservation | null {
  if (
    turn.status !== "resolved" ||
    !turn.playerAction ||
    !turn.opponentAction ||
    !turn.firstMover
  ) {
    return null;
  }

  const playerBaseSpeed = turn.startSnapshot.player.actualSpeed;
  if (playerBaseSpeed == null) {
    return null;
  }

  return {
    turnId: turn.turnId,
    opponentPokemonKey: turn.opponentAction.pokemonKey,
    firstMover: turn.firstMover,
    playerBaseSpeed,
    playerSpeedContext: {
      ...turn.startSnapshot.player,
      pokemonKey: turn.playerAction.pokemonKey,
      name: turn.playerAction.pokemonName ?? turn.startSnapshot.player.name,
    },
    opponentSpeedContext: {
      ...turn.startSnapshot.opponent,
      pokemonKey: turn.opponentAction.pokemonKey,
      name: turn.opponentAction.pokemonName ?? turn.startSnapshot.opponent.name,
    },
    fieldSnapshotAtTurnStart: turn.startSnapshot.field,
  };
}

export const useSpeedInferenceStore = create<SpeedInferenceState>((set, get) => ({
  inferredBounds: {},
  observations: {},

  consumeResolvedTurn: (turn) => {
    const observation = buildObservation(turn);
    if (!observation) {
      return {
        applied: false,
        note:
          turn.status === "resolved"
            ? "player_speed_unknown"
            : turn.status,
      };
    }

    const nextObservations = {
      ...get().observations,
      [observation.opponentPokemonKey]: [
        ...(get().observations[observation.opponentPokemonKey] ?? []),
        observation,
      ],
    };

    const inferredBounds = rebuildBounds(nextObservations);
    set({
      observations: nextObservations,
      inferredBounds,
    });
    syncInferredBoundsToOpponentSlots(inferredBounds);

    return { applied: true, note: null };
  },

  refreshInferences: () => {
    const state = get();
    const inferredBounds = rebuildBounds(state.observations);
    syncInferredBoundsToOpponentSlots(inferredBounds);
    set({ inferredBounds });
  },

  reset: () => {
    syncInferredBoundsToOpponentSlots({});
    set({
      inferredBounds: {},
      observations: {},
    });
  },
}));
