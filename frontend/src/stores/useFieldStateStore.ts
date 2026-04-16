import { create } from "zustand";
import type { FieldStateMessage } from "../types";

interface SideState {
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  tailwind: boolean;
  stealthRock: boolean;
  spikes: number;
  toxicSpikes: number;
}

function emptySide(): SideState {
  return {
    reflect: false,
    lightScreen: false,
    auroraVeil: false,
    tailwind: false,
    stealthRock: false,
    spikes: 0,
    toxicSpikes: 0,
  };
}

interface FieldStateStore {
  weather: string | null;
  terrain: string | null;
  trickRoom: boolean;
  playerSide: SideState;
  opponentSide: SideState;
  updateFromMessage: (msg: FieldStateMessage) => void;
  clear: () => void;
}

function mapSide(side: FieldStateMessage["player_side"]): SideState {
  return {
    reflect: side.reflect,
    lightScreen: side.light_screen,
    auroraVeil: side.aurora_veil,
    tailwind: side.tailwind,
    stealthRock: side.stealth_rock,
    spikes: side.spikes,
    toxicSpikes: side.toxic_spikes,
  };
}

export const useFieldStateStore = create<FieldStateStore>((set) => ({
  weather: null,
  terrain: null,
  trickRoom: false,
  playerSide: emptySide(),
  opponentSide: emptySide(),

  updateFromMessage: (msg) =>
    set({
      weather: msg.weather,
      terrain: msg.terrain,
      trickRoom: msg.trick_room,
      playerSide: mapSide(msg.player_side),
      opponentSide: mapSide(msg.opponent_side),
    }),

  clear: () =>
    set({
      weather: null,
      terrain: null,
      trickRoom: false,
      playerSide: emptySide(),
      opponentSide: emptySide(),
    }),
}));
