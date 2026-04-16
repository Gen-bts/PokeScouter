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
  showBattleInfo: boolean;
  toggleBattleInfo: () => void;
  battleInfoPosition: { x: number; y: number };
  setBattleInfoPosition: (pos: { x: number; y: number }) => void;
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
      showBattleInfo: true,
      toggleBattleInfo: () => set((s) => ({ showBattleInfo: !s.showBattleInfo })),
      battleInfoPosition: { x: 10, y: 8 },
      setBattleInfoPosition: (pos) => set({ battleInfoPosition: pos }),
    }),
    {
      name: "pokescouter:settings",
      version: 3,
      partialize: (state) => ({
        selectedDeviceId: state.selectedDeviceId,
        selectedAudioDeviceId: state.selectedAudioDeviceId,
        volume: state.volume,
        muted: state.muted,
        jpegQuality: state.jpegQuality,
        autoPauseMinutes: state.autoPauseMinutes,
        debugOverlay: state.debugOverlay,
        debugCrops: state.debugCrops,
        showBattleInfo: state.showBattleInfo,
        battleInfoPosition: state.battleInfoPosition,
      }),
      migrate: (persisted: unknown, version: number) => {
        if (version === 2) {
          const old = persisted as Record<string, unknown>;
          const showOverlay = old.showBattleInfoOverlay;
          const posOverlay = old.battleInfoOverlayPosition;
          const show =
            typeof showOverlay === "boolean" ? showOverlay : true;
          const pos =
            posOverlay &&
            typeof posOverlay === "object" &&
            posOverlay !== null &&
            "x" in posOverlay &&
            "y" in posOverlay
              ? (posOverlay as { x: number; y: number })
              : { x: 10, y: 8 };
          const {
            showBattleInfoOverlay: _a,
            battleInfoOverlayPosition: _b,
            ...rest
          } = old;
          return {
            ...rest,
            showBattleInfo: show,
            battleInfoPosition: pos,
          };
        }
        if (version === 1) {
          const old = persisted as Record<string, unknown>;
          return {
            ...old,
            showBattleInfo: true,
            battleInfoPosition: { x: 10, y: 8 },
          };
        }
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
            showBattleInfo: true,
            battleInfoPosition: { x: 10, y: 8 },
          };
        }
        return persisted as Record<string, unknown>;
      },
    },
  ),
);
