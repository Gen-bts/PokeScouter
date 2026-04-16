import { create } from "zustand";
import type {
  BattleEventMessage,
  BattleTurnCloseReason,
  OpenTurnState,
  ResolvedTurnStatus,
  ResolvedTurnSummary,
  TurnAction,
  TurnStartSnapshot,
} from "../types";
import { useFieldStateStore } from "./useFieldStateStore";
import { useMyPartyStore } from "./useMyPartyStore";
import { useOpponentTeamStore } from "./useOpponentTeamStore";
import {
  fieldToInt,
  fieldToKey,
  isBattleTurnScene,
  isNeutralBattleScene,
} from "../utils/speed";

const PLAYER_SPEED_FIELD = "すばやさ実数値";
const PLAYER_SPEED_POINTS_FIELD = "すばやさ努力値";
const ABILITY_FIELD = "特性";
const ITEM_FIELD = "もちもの";
const RECENT_TURN_LIMIT = 10;

interface BattleTurnState {
  turnCounter: number;
  currentTurn: OpenTurnState | null;
  lastResolvedTurn: ResolvedTurnSummary | null;
  recentTurns: ResolvedTurnSummary[];
  handleSceneChange: (
    nextScene: string,
    previousScene: string,
  ) => ResolvedTurnSummary | null;
  recordBattleEvent: (msg: BattleEventMessage, currentScene: string) => void;
  abortCurrentTurn: (
    reason: BattleTurnCloseReason,
  ) => ResolvedTurnSummary | null;
  commitResolvedTurn: (summary: ResolvedTurnSummary) => void;
  reset: () => void;
}

function buildTurnSnapshot(): TurnStartSnapshot {
  const fieldState = useFieldStateStore.getState();
  const playerSlot = useMyPartyStore
    .getState()
    .slots.find((slot) => slot.isActive);
  const opponentSlot = useOpponentTeamStore
    .getState()
    .slots.find((slot) => slot.isSelected && slot.pokemonId != null);

  const playerBaseSpeed =
    playerSlot?.megaForm?.base_stats.spe != null
      ? playerSlot.megaForm.base_stats.spe -
        (playerSlot.megaForm.stat_deltas?.spe ?? 0)
      : null;

  return {
    field: {
      weather: fieldState.weather,
      terrain: fieldState.terrain,
      trickRoom: fieldState.trickRoom,
      playerTailwind: fieldState.playerSide.tailwind,
      opponentTailwind: fieldState.opponentSide.tailwind,
    },
    player: {
      pokemonKey: playerSlot?.pokemonId ?? null,
      name: playerSlot?.name ?? null,
      actualSpeed: fieldToInt(playerSlot?.fields[PLAYER_SPEED_FIELD]),
      speedStatPoints: fieldToInt(playerSlot?.fields[PLAYER_SPEED_POINTS_FIELD]),
      baseSpeed: playerBaseSpeed,
      speBoost: playerSlot?.boosts.spe ?? 0,
      abilityId: fieldToKey(playerSlot?.fields[ABILITY_FIELD]),
      itemId: fieldToKey(playerSlot?.fields[ITEM_FIELD]),
      itemIdentifier:
        playerSlot?.fields[ITEM_FIELD]?.matched_identifier ??
        fieldToKey(playerSlot?.fields[ITEM_FIELD]),
      tailwind: fieldState.playerSide.tailwind,
      isMegaEvolved: playerSlot?.isMegaEvolved ?? false,
      megaPokemonKey: playerSlot?.megaForm?.pokemon_key ?? null,
      megaBaseSpeed: playerSlot?.megaForm?.base_stats.spe ?? null,
    },
    opponent: {
      pokemonKey: opponentSlot?.pokemonId ?? null,
      name: opponentSlot?.name ?? null,
      actualSpeed: null,
      speedStatPoints: null,
      baseSpeed: null,
      speBoost: opponentSlot?.boosts.spe ?? 0,
      abilityId: opponentSlot?.abilityId ?? null,
      itemId: opponentSlot?.itemId ?? null,
      itemIdentifier:
        opponentSlot?.itemIdentifier ?? opponentSlot?.itemId ?? null,
      tailwind: fieldState.opponentSide.tailwind,
      isMegaEvolved: opponentSlot?.activeMegaIndex != null,
      megaPokemonKey:
        opponentSlot?.activeMegaIndex != null
          ? (opponentSlot.megaForms[opponentSlot.activeMegaIndex]?.pokemon_key ??
            null)
          : null,
      megaBaseSpeed:
        opponentSlot?.activeMegaIndex != null
          ? (opponentSlot.megaForms[opponentSlot.activeMegaIndex]?.base_stats.spe ??
            null)
          : null,
    },
  };
}

function makeOpenTurn(
  turnId: number,
  startedBy: OpenTurnState["startedBy"],
  phase: string,
): OpenTurnState {
  return {
    turnId,
    startedAt: Date.now(),
    startedBy,
    phase,
    playerAction: null,
    opponentAction: null,
    actionOrder: [],
    startSnapshot: buildTurnSnapshot(),
  };
}

function recordAction(turn: OpenTurnState, msg: BattleEventMessage): OpenTurnState {
  const pokemonKey = msg.pokemon_key ?? msg.species_id;
  if (!pokemonKey) return turn;

  const isExistingSide = turn.actionOrder.includes(msg.side);
  const action: TurnAction = {
    side: msg.side,
    pokemonKey,
    pokemonName: msg.pokemon_name,
    moveKey: msg.move_key ?? msg.move_id ?? null,
    moveName: msg.move_name,
    priority:
      typeof msg.details?.priority === "number" ? msg.details.priority : 0,
    order: isExistingSide ? turn.actionOrder.indexOf(msg.side) + 1 : turn.actionOrder.length + 1,
  };

  const actionOrder = isExistingSide
    ? turn.actionOrder
    : [...turn.actionOrder, msg.side];

  return {
    ...turn,
    playerAction: msg.side === "player" ? action : turn.playerAction,
    opponentAction: msg.side === "opponent" ? action : turn.opponentAction,
    actionOrder,
  };
}

function resolveStatus(
  turn: OpenTurnState,
  closeReason: BattleTurnCloseReason,
): ResolvedTurnStatus {
  if (closeReason !== "returned_to_neutral") {
    return "aborted";
  }
  if (!turn.playerAction || !turn.opponentAction) {
    return "incomplete";
  }
  if (turn.playerAction.priority !== turn.opponentAction.priority) {
    return "priority_mismatch";
  }
  return "resolved";
}

function buildResolvedTurn(
  turn: OpenTurnState,
  closeReason: BattleTurnCloseReason,
): ResolvedTurnSummary {
  return {
    turnId: turn.turnId,
    startedAt: turn.startedAt,
    resolvedAt: Date.now(),
    startedBy: turn.startedBy,
    closeReason,
    status: resolveStatus(turn, closeReason),
    phase: turn.phase,
    firstMover: turn.actionOrder[0] ?? null,
    playerAction: turn.playerAction,
    opponentAction: turn.opponentAction,
    startSnapshot: turn.startSnapshot,
    inferenceApplied: false,
    inferenceNote: null,
  };
}

export const useBattleTurnStore = create<BattleTurnState>((set, get) => ({
  turnCounter: 0,
  currentTurn: null,
  lastResolvedTurn: null,
  recentTurns: [],

  handleSceneChange: (nextScene, previousScene) => {
    const { currentTurn, turnCounter } = get();

    if (nextScene === "battle_end") {
      if (!currentTurn) return null;
      const resolved = buildResolvedTurn(currentTurn, "battle_end");
      set({ currentTurn: null });
      return resolved;
    }

    if (currentTurn) {
      if (isNeutralBattleScene(nextScene)) {
        const resolved = buildResolvedTurn(currentTurn, "returned_to_neutral");
        set({ currentTurn: null });
        return resolved;
      }
      if (isBattleTurnScene(nextScene)) {
        set({ currentTurn: { ...currentTurn, phase: nextScene } });
      }
      return null;
    }

    if (
      isNeutralBattleScene(previousScene) &&
      isBattleTurnScene(nextScene) &&
      !isNeutralBattleScene(nextScene)
    ) {
      set({
        turnCounter: turnCounter + 1,
        currentTurn: makeOpenTurn(
          turnCounter + 1,
          "scene_transition",
          nextScene,
        ),
      });
    }

    return null;
  },

  recordBattleEvent: (msg, currentScene) => {
    if (msg.event_type !== "move_used") {
      return;
    }

    let turn = get().currentTurn;
    if (!turn) {
      if (!isBattleTurnScene(currentScene)) {
        return;
      }
      const nextTurnId = get().turnCounter + 1;
      turn = makeOpenTurn(nextTurnId, "event_fallback", currentScene);
      set({ turnCounter: nextTurnId, currentTurn: turn });
    }

    set({
      currentTurn: recordAction(turn, msg),
    });
  },

  abortCurrentTurn: (reason) => {
    const { currentTurn } = get();
    if (!currentTurn) return null;
    const resolved = buildResolvedTurn(currentTurn, reason);
    set({ currentTurn: null });
    return resolved;
  },

  commitResolvedTurn: (summary) =>
    set((state) => {
      const nextRecent = [...state.recentTurns];
      const existingIndex = nextRecent.findIndex(
        (turn) => turn.turnId === summary.turnId,
      );
      if (existingIndex >= 0) {
        nextRecent[existingIndex] = summary;
      } else {
        nextRecent.push(summary);
      }
      return {
        lastResolvedTurn: summary,
        recentTurns:
          nextRecent.length > RECENT_TURN_LIMIT
            ? nextRecent.slice(-RECENT_TURN_LIMIT)
            : nextRecent,
      };
    }),

  reset: () =>
    set({
      turnCounter: 0,
      currentTurn: null,
      lastResolvedTurn: null,
      recentTurns: [],
    }),
}));
