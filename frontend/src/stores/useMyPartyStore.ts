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
  isMegaEvolved: boolean;
  isActive: boolean;
  boosts: Record<string, number>;
  currentHp: number | null;
  maxHp: number | null;
  hpPercent: number | null;
}

function emptySlots(): MyPartySlot[] {
  return Array.from({ length: 6 }, (_, i) => ({
    position: i + 1,
    pokemonId: null,
    name: null,
    fields: {},
    megaForm: null,
    isMegaEvolved: false,
    isActive: false,
    boosts: {},
    currentHp: null,
    maxHp: null,
    hpPercent: null,
  }));
}

function serializeSlots(slots: MyPartySlot[]) {
  return slots.map(({ position, pokemonId, name, fields, megaForm }) => ({
    position,
    pokemonId,
    name,
    fields,
    megaForm,
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
  updatePlayerActive: (speciesId: string, currentHp: number | null, maxHp: number | null, hpPercent: number | null) => void;
  applyStatChange: (speciesId: string, stat: string, stages: number) => void;
  applyMegaEvolution: (basePokemonKey: string, megaPokemonKey: string) => void;
  setSlotMegaForm: (position: number, megaForm: MegaFormDetail | null) => void;
  toggleMegaEvolution: (position: number) => void;
  setPartyName: (name: string) => void;
  setError: (message: string) => void;
  clearBattleState: () => void;
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
              isMegaEvolved: next[idx]?.isMegaEvolved ?? false,
              isActive: next[idx]?.isActive ?? false,
              boosts: next[idx]?.boosts ?? {},
              currentHp: next[idx]?.currentHp ?? null,
              maxHp: next[idx]?.maxHp ?? null,
              hpPercent: next[idx]?.hpPercent ?? null,
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
              isMegaEvolved: false,
              isActive: false,
              boosts: {},
              currentHp: null,
              maxHp: null,
              hpPercent: null,
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
            boosts:
              slot.isActive && slot.pokemonId !== speciesId
                ? {}
                : slot.boosts,
          })),
        })),

      markFainted: (speciesId) =>
        set((prev) => {
          const idx = prev.slots.findIndex((s) => s.pokemonId === speciesId);
          if (idx === -1) return prev;
          const next = [...prev.slots];
          const existing = next[idx];
          if (!existing) return prev;
          next[idx] = { ...existing, isActive: false, boosts: {}, currentHp: 0, hpPercent: 0 };
          return { slots: next };
        }),

      updatePlayerActive: (speciesId, currentHp, maxHp, hpPercent) =>
        set((prev) => {
          const idx = prev.slots.findIndex((s) => s.pokemonId === speciesId);
          if (idx === -1) return prev;
          const existing = prev.slots[idx];
          if (!existing) return prev;
          if (
            existing.currentHp === currentHp &&
            existing.maxHp === maxHp &&
            existing.hpPercent === hpPercent
          ) {
            return prev;
          }
          const next = [...prev.slots];
          next[idx] = { ...existing, isActive: true, currentHp, maxHp, hpPercent };
          return { slots: next };
        }),

      applyStatChange: (speciesId, stat, stages) =>
        set((prev) => {
          const idx = prev.slots.findIndex((s) => s.pokemonId === speciesId);
          if (idx === -1) return prev;
          const next = [...prev.slots];
          const existing = next[idx];
          if (!existing) return prev;
          const current = existing.boosts[stat] ?? 0;
          const clamped = Math.max(-6, Math.min(6, current + stages));
          const boosts = { ...existing.boosts, [stat]: clamped };
          if (clamped === 0) {
            delete boosts[stat];
          }
          next[idx] = { ...existing, boosts };
          return { slots: next };
        }),

      applyMegaEvolution: (basePokemonKey, megaPokemonKey) =>
        set((prev) => {
          const idx = prev.slots.findIndex((s) => s.pokemonId === basePokemonKey);
          if (idx === -1) return prev;
          const existing = prev.slots[idx];
          if (!existing || existing.pokemonId === megaPokemonKey) return prev;
          const next = [...prev.slots];
          next[idx] = { ...existing, pokemonId: megaPokemonKey };
          return { slots: next };
        }),

      setSlotMegaForm: (position, megaForm) =>
        set((prev) => {
          const idx = position - 1;
          if (idx < 0 || idx >= 6) return prev;
          const existing = prev.slots[idx];
          if (!existing) return prev;
          const next = [...prev.slots];
          next[idx] = {
            ...existing,
            megaForm,
            // メガフォームがセットされたら初期状態はメガ、クリアされたらリセット
            isMegaEvolved: megaForm != null,
          };
          return { slots: next };
        }),

      toggleMegaEvolution: (position) =>
        set((prev) => {
          const idx = position - 1;
          if (idx < 0 || idx >= 6) return prev;
          const existing = prev.slots[idx];
          if (!existing?.megaForm) return prev;
          const next = [...prev.slots];
          next[idx] = { ...existing, isMegaEvolved: !existing.isMegaEvolved };
          return { slots: next };
        }),

      setPartyName: (name) => set({ partyName: name }),

      setError: (message) =>
        set({ registrationState: "idle", error: message }),

      clearBattleState: () =>
        set((prev) => ({
          slots: prev.slots.map((slot) => ({
            ...slot,
            isActive: false,
            boosts: {},
            currentHp: null,
            maxHp: null,
            hpPercent: null,
          })),
        })),

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
              body: JSON.stringify({ name, slots: serializeSlots(slots) }),
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
              isMegaEvolved: slot.megaForm != null,
              isActive: false,
              boosts: {},
              currentHp: null,
              maxHp: null,
              hpPercent: null,
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
              body: JSON.stringify({
                name: partyName,
                slots: serializeSlots(slots),
              }),
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
      name: "my-party-store-v3",
      version: 4,
      partialize: (state): Pick<MyPartyState, "slots" | "partyName" | "activePartyId"> => ({
        slots: state.slots.map((slot) => ({
          ...slot,
          isActive: false,
          boosts: {},
          currentHp: null,
          maxHp: null,
          hpPercent: null,
        })),
        partyName: state.partyName,
        activePartyId: state.activePartyId,
      }),
      migrate: (persisted: unknown, version: number) => {
        if (version === 0 || version === undefined) {
          const old = persisted as Record<string, unknown>;
          return {
            slots: Array.isArray(old.slots)
              ? old.slots.map((s: Record<string, unknown>) => ({
                  ...s,
                  isMegaEvolved: Boolean(s.isMegaEvolved),
                  isActive: false,
                  boosts: {},
                  currentHp: null,
                  maxHp: null,
                  hpPercent: null,
                }))
              : emptySlots(),
            partyName: typeof old.partyName === "string" ? old.partyName : null,
            activePartyId:
              typeof old.activePartyId === "string" ? old.activePartyId : null,
          };
        }
        if (version === 1) {
          const old = persisted as Record<string, unknown>;
          const slots = Array.isArray(old.slots)
            ? old.slots.map((s: Record<string, unknown>) => ({
                ...s,
                isMegaEvolved: false,
                isActive: false,
                boosts: {},
                currentHp: null,
                maxHp: null,
                hpPercent: null,
              }))
            : emptySlots();
          return {
            ...old,
            slots,
            partyName: typeof old.partyName === "string" ? old.partyName : null,
            activePartyId:
              typeof old.activePartyId === "string" ? old.activePartyId : null,
          };
        }
        if (version === 2) {
          const old = persisted as Record<string, unknown>;
          const slots = Array.isArray(old.slots)
            ? old.slots.map((s: Record<string, unknown>) => ({
                ...s,
                isActive: false,
                boosts: {},
                currentHp: null,
                maxHp: null,
                hpPercent: null,
              }))
            : emptySlots();
          return {
            ...old,
            slots,
            partyName: typeof old.partyName === "string" ? old.partyName : null,
            activePartyId:
              typeof old.activePartyId === "string" ? old.activePartyId : null,
          };
        }
        if (version === 3) {
          const old = persisted as Record<string, unknown>;
          const slots = Array.isArray(old.slots)
            ? old.slots.map((s: Record<string, unknown>) => ({
                ...s,
                isActive: false,
                boosts: {},
                currentHp: null,
                maxHp: null,
                hpPercent: null,
              }))
            : emptySlots();
          return {
            ...old,
            slots,
            partyName: typeof old.partyName === "string" ? old.partyName : null,
            activePartyId:
              typeof old.activePartyId === "string" ? old.activePartyId : null,
          };
        }
        const current = persisted as Record<string, unknown>;
        return {
          ...current,
          slots: Array.isArray(current.slots)
            ? current.slots.map((s: Record<string, unknown>) => ({
                ...s,
                isActive: false,
                boosts: {},
                currentHp: null,
                maxHp: null,
                hpPercent: null,
              }))
            : emptySlots(),
          partyName:
            typeof current.partyName === "string" ? current.partyName : null,
          activePartyId:
            typeof current.activePartyId === "string"
              ? current.activePartyId
              : null,
        };
      },
    },
  ),
);
