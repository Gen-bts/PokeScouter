import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  selectedDeviceId: string;
  setDeviceId: (id: string) => void;
  selectedAudioDeviceId: string;
  setAudioDeviceId: (id: string) => void;
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
  toggleMute: () => void;
  debugOverlay: boolean;
  toggleDebugOverlay: () => void;
  debugCrops: boolean;
  toggleDebugCrops: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      selectedDeviceId: "",
      setDeviceId: (id) => set({ selectedDeviceId: id }),
      selectedAudioDeviceId: "",
      setAudioDeviceId: (id) => set({ selectedAudioDeviceId: id }),
      volume: 0.5,
      setVolume: (v) => set({ volume: v }),
      muted: false,
      setMuted: (m) => set({ muted: m }),
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      debugOverlay: false,
      toggleDebugOverlay: () => set((s) => ({ debugOverlay: !s.debugOverlay })),
      debugCrops: false,
      toggleDebugCrops: () => set((s) => ({ debugCrops: !s.debugCrops })),
    }),
    { name: "pokescouter:settings" },
  ),
);
