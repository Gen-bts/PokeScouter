import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  MegaFormDetail,
  PartyRegistrationPhase,
  PartyRegisterScreenMessage,
  PartySlotData,
  SavedParty,
  ValidatedField,
} from "../types";

export interface MyPartySlot {
  position: number;
  pokemonId: string | null;
  name: string | null;
  fields: Record<string, ValidatedField>;
  megaForm: MegaFormDetail | null;
  isActive: boolean;
}

function emptySlots(): MyPartySlot[] {
  return Array.from({ length: 6 }, (_, i) => ({
    position: i + 1,
    pokemonId: null,
    name: null,
    fields: {},
    megaForm: null,
    isActive: false,
  }));
}

interface MyPartyState {
  slots: MyPartySlot[];
  partyName: string | null;
  activePartyId: string | null;
  savedParties: SavedParty[];
  registrationState: PartyRegistrationPhase;
  error: string | null;

  setRegistrationState: (state: PartyRegistrationPhase) => void;
  updateFromScreen: (msg: PartyRegisterScreenMessage) => void;
  updateFromComplete: (party: PartySlotData[], partyName: string | null) => void;
  markActive: (speciesId: string) => void;
  markFainted: (speciesId: string) => void;
  setSlotMegaForm: (position: number, megaForm: MegaFormDetail | null) => void;
  setPartyName: (name: string) => void;
  setError: (message: string) => void;
  clear: () => void;

  fetchSavedParties: () => Promise<void>;
  saveCurrentParty: () => Promise<string | null>;
  loadParty: (id: string) => void;
  overwriteParty: (id: string) => Promise<void>;
  deleteParty: (id: string) => Promise<void>;
}

const API_BASE = "/api/parties";

export const useMyPartyStore = create<MyPartyState>()(
  persist(
    (set, get) => ({
      slots: emptySlots(),
      partyName: null,
      activePartyId: null,
      savedParties: [],
      registrationState: "idle",
      error: null,

      setRegistrationState: (state) =>
        set({ registrationState: state, error: null }),

      updateFromScreen: (msg) =>
        set((prev) => {
          const next = [...prev.slots];
          for (const p of msg.pokemon) {
            const idx = p.position - 1;
            if (idx < 0 || idx >= 6) continue;
            const slotFields = msg.slots[p.position] ?? {};
            const newFields: Record<string, ValidatedField> = {};
            for (const [k, v] of Object.entries(slotFields)) {
              newFields[k] = { raw: v, validated: null, confidence: 0 };
            }
            next[idx] = {
              position: p.position,
              pokemonId: p.pokemon_key ?? p.pokemon_id,
              name: p.name,
              fields: { ...(next[idx]?.fields), ...newFields },
              megaForm: next[idx]?.megaForm ?? null,
              isActive: next[idx]?.isActive ?? false,
            };
          }
          return { slots: next };
        }),

      updateFromComplete: (party, partyName) =>
        set(() => {
          const next = emptySlots();
          for (const p of party) {
            const idx = p.position - 1;
            if (idx < 0 || idx >= 6) continue;
            next[idx] = {
              position: p.position,
              pokemonId: p.pokemon_key ?? p.pokemon_id,
              name: p.name,
              fields: p.fields,
              megaForm: null,
              isActive: false,
            };
          }
          return {
            slots: next,
            partyName: partyName ?? null,
            activePartyId: null,
            registrationState: "done",
          };
        }),

      markActive: (speciesId) =>
        set((prev) => ({
          slots: prev.slots.map((slot) => ({
            ...slot,
            isActive: slot.pokemonId === speciesId,
          })),
        })),

      markFainted: (speciesId) =>
        set((prev) => {
          const idx = prev.slots.findIndex((s) => s.pokemonId === speciesId);
          if (idx === -1) return prev;
          const next = [...prev.slots];
          const existing = next[idx];
          if (!existing) return prev;
          next[idx] = { ...existing, isActive: false };
          return { slots: next };
        }),

      setSlotMegaForm: (position, megaForm) =>
        set((prev) => {
          const idx = position - 1;
          if (idx < 0 || idx >= 6) return prev;
          const existing = prev.slots[idx];
          if (!existing) return prev;
          const next = [...prev.slots];
          next[idx] = { ...existing, megaForm };
          return { slots: next };
        }),

      setPartyName: (name) => set({ partyName: name }),

      setError: (message) =>
        set({ registrationState: "idle", error: message }),

      clear: () =>
        set({
          slots: emptySlots(),
          partyName: null,
          activePartyId: null,
          registrationState: "idle",
          error: null,
        }),

      fetchSavedParties: async () => {
        try {
          const res = await fetch(API_BASE);
          if (!res.ok) return;
          const parties: SavedParty[] = await res.json();
          set({ savedParties: parties });
        } catch {
          // サーバー未接続時は無視
        }
      },

      saveCurrentParty: async () => {
        const { slots, partyName } = get();
        if (!slots.some((s) => s.pokemonId !== null)) return null;
        const name = partyName || "パーティ";
        try {
          const res = await fetch(API_BASE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, slots }),
          });
          if (!res.ok) return null;
          const entry: SavedParty = await res.json();
          set({ activePartyId: entry.id, partyName: entry.name });
          await get().fetchSavedParties();
          return entry.id;
        } catch {
          return null;
        }
      },

      loadParty: (id) => {
        const { savedParties } = get();
        const saved = savedParties.find((p) => p.id === id);
        if (!saved) return;
        set({
          slots: structuredClone(saved.slots).map((slot) => ({
            ...slot,
            isActive: false,
          })),
          partyName: saved.name,
          activePartyId: saved.id,
          registrationState: "done",
          error: null,
        });
      },

      overwriteParty: async (id) => {
        const { slots, partyName } = get();
        try {
          const res = await fetch(`${API_BASE}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: partyName, slots }),
          });
          if (!res.ok) return;
          set({ activePartyId: id });
          await get().fetchSavedParties();
        } catch {
          // ignore
        }
      },

      deleteParty: async (id) => {
        try {
          const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
          if (!res.ok) return;
          const { activePartyId } = get();
          if (activePartyId === id) {
            set({ activePartyId: null });
          }
          await get().fetchSavedParties();
        } catch {
          // ignore
        }
      },
    }),
    {
      name: "my-party-store-v2",
      version: 1,
      partialize: (state) => ({
        slots: state.slots,
        partyName: state.partyName,
        activePartyId: state.activePartyId,
      }),
      migrate: (persisted: unknown, version: number) => {
        if (version === 0 || version === undefined) {
          const old = persisted as Record<string, unknown>;
          return {
            slots: old.slots ?? emptySlots(),
            partyName: null,
            activePartyId: null,
          };
        }
        return persisted as Record<string, unknown>;
      },
    },
  ),
);
