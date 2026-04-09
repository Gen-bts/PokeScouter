import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  PartyRegistrationPhase,
  PartyRegisterScreenMessage,
  PartySlotData,
} from "../types";

export interface MyPartySlot {
  position: number;
  pokemonId: number | null;
  name: string | null;
  details: Record<string, string>;
}

function emptySlots(): MyPartySlot[] {
  return Array.from({ length: 6 }, (_, i) => ({
    position: i + 1,
    pokemonId: null,
    name: null,
    details: {},
  }));
}

interface MyPartyState {
  slots: MyPartySlot[];
  registrationState: PartyRegistrationPhase;
  error: string | null;
  setRegistrationState: (state: PartyRegistrationPhase) => void;
  updateFromScreen: (msg: PartyRegisterScreenMessage) => void;
  updateFromComplete: (party: PartySlotData[]) => void;
  setError: (message: string) => void;
  clear: () => void;
}

export const useMyPartyStore = create<MyPartyState>()(
  persist(
    (set) => ({
      slots: emptySlots(),
      registrationState: "idle",
      error: null,

      setRegistrationState: (state) =>
        set({ registrationState: state, error: null }),

      updateFromScreen: (msg) =>
        set((prev) => {
          const next = [...prev.slots];
          // 画面のポケモン情報でスロットを更新
          for (const p of msg.pokemon) {
            const idx = p.position - 1;
            if (idx < 0 || idx >= 6) continue;
            // 画面2のデータは画面1のオフセット分を考慮
            // (バックエンドが position を通し番号で返す前提)
            next[idx] = {
              position: p.position,
              pokemonId: p.pokemon_id,
              name: p.name,
              details: msg.regions,
            };
          }
          return { slots: next };
        }),

      updateFromComplete: (party) =>
        set(() => {
          const next = emptySlots();
          for (const p of party) {
            const idx = p.position - 1;
            if (idx < 0 || idx >= 6) continue;
            next[idx] = {
              position: p.position,
              pokemonId: p.pokemon_id,
              name: p.name,
              details: p.regions,
            };
          }
          return { slots: next, registrationState: "done" };
        }),

      setError: (message) =>
        set({ registrationState: "idle", error: message }),

      clear: () =>
        set({ slots: emptySlots(), registrationState: "idle", error: null }),
    }),
    {
      name: "my-party-store",
      partialize: (state) => ({
        slots: state.slots,
      }),
    },
  ),
);
