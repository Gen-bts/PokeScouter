import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  // デバイス
  selectedDeviceId: string;
  setDeviceId: (id: string) => void;
  selectedAudioDeviceId: string;
  setAudioDeviceId: (id: string) => void;
  // 音声
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
  toggleMute: () => void;
  // 映像・キャプチャ
  jpegQuality: number;
  setJpegQuality: (q: number) => void;
  autoPauseMinutes: number;
  setAutoPauseMinutes: (m: number) => void;
  // 表示
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
      jpegQuality: 0.8,
      setJpegQuality: (q) => set({ jpegQuality: q }),
      autoPauseMinutes: 5,
      setAutoPauseMinutes: (m) => set({ autoPauseMinutes: m }),
      debugOverlay: false,
      toggleDebugOverlay: () => set((s) => ({ debugOverlay: !s.debugOverlay })),
      debugCrops: false,
      toggleDebugCrops: () => set((s) => ({ debugCrops: !s.debugCrops })),
    }),
    {
      name: "pokescouter:settings",
      version: 1,
      partialize: (state) => ({
        selectedDeviceId: state.selectedDeviceId,
        selectedAudioDeviceId: state.selectedAudioDeviceId,
        volume: state.volume,
        muted: state.muted,
        jpegQuality: state.jpegQuality,
        autoPauseMinutes: state.autoPauseMinutes,
        debugOverlay: state.debugOverlay,
        debugCrops: state.debugCrops,
      }),
      migrate: (persisted: unknown, version: number) => {
        if (version === 0 || version === undefined) {
          const old = persisted as Record<string, unknown>;
          return {
            selectedDeviceId:
              typeof old.selectedDeviceId === "string"
                ? old.selectedDeviceId
                : "",
            selectedAudioDeviceId:
              typeof old.selectedAudioDeviceId === "string"
                ? old.selectedAudioDeviceId
                : "",
            volume: typeof old.volume === "number" ? old.volume : 0.5,
            muted: typeof old.muted === "boolean" ? old.muted : false,
            jpegQuality:
              typeof old.jpegQuality === "number" ? old.jpegQuality : 0.8,
            autoPauseMinutes:
              typeof old.autoPauseMinutes === "number"
                ? old.autoPauseMinutes
                : 5,
            debugOverlay:
              typeof old.debugOverlay === "boolean" ? old.debugOverlay : false,
            debugCrops:
              typeof old.debugCrops === "boolean" ? old.debugCrops : false,
          };
        }
        return persisted as Record<string, unknown>;
      },
    },
  ),
);
