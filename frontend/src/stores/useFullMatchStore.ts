import { create } from "zustand";
import type {
  BenchmarkResultEvent,
  BenchmarkResultRegion,
  FrameSummaryEvent,
  FullMatchDoneEvent,
  OcrResultEvent,
  PokemonIdentifiedEvent,
  SceneChangeEvent,
  SceneMeta,
} from "../api/devtools";
import { getScenes } from "../api/devtools";
import type { RegionAccumulator } from "../utils/engineStats";

/** OCR結果からcrop_b64を除去した軽量版リージョン */
export interface LightRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  engines: Record<string, { text: string; confidence: number; elapsed_ms: number }>;
}

/** フレーム別OCR結果（crop_b64除去済み） */
export interface FrameOcrDetail {
  frame_index: number;
  timestamp_ms: number;
  scene: string;
  elapsed_ms: number;
  regions: LightRegion[];
}

interface FullMatchState {
  active: boolean;
  sessionId: string;
  totalFrames: number;
  processedFrames: number;
  selectedFrameIndex: number | null;

  sceneTimeline: SceneChangeEvent[];
  frameResults: FrameSummaryEvent[];
  pokemonResults: PokemonIdentifiedEvent[];
  sceneCounts: Record<string, number>;
  totalElapsedMs: number;

  // OCR 関連
  ocrResults: Record<number, FrameOcrDetail>;
  engineStats: Record<string, RegionAccumulator>;
  frameFilenames: Record<number, string>;

  // スキップフレーム数（通常運用モード用）
  skippedFrames: number;

  // シーン名マップ（key → display_name）
  scenesMap: Record<string, SceneMeta>;
  sceneDisplayName: (key: string) => string;

  // アクション
  fetchScenes: () => Promise<void>;
  start: () => void;
  stop: () => void;
  setSessionId: (id: string) => void;
  setTotal: (n: number) => void;
  addSceneChange: (data: SceneChangeEvent) => void;
  addFrameSummary: (data: FrameSummaryEvent) => void;
  addFrameSkipped: () => void;
  addPokemonResult: (data: PokemonIdentifiedEvent) => void;
  addOcrResult: (data: BenchmarkResultEvent | OcrResultEvent) => void;
  selectFrame: (index: number | null) => void;
  registerFrameFilename: (index: number, timestampMs: number) => void;
  setDone: (data: FullMatchDoneEvent) => void;
  reset: () => void;
}

function _stripCropAndConvert(regions: BenchmarkResultRegion[]): LightRegion[] {
  return regions.map(({ name, x, y, w, h, engines }) => ({
    name, x, y, w, h, engines,
  }));
}

function _accumulateEngineStats(
  stats: Record<string, RegionAccumulator>,
  regions: BenchmarkResultRegion[],
): Record<string, RegionAccumulator> {
  const updated = { ...stats };
  for (const region of regions) {
    if (!updated[region.name]) {
      updated[region.name] = {
        engines: {},
        x: region.x,
        y: region.y,
        w: region.w,
        h: region.h,
      };
    }
    const acc = updated[region.name]!;
    for (const [engineName, result] of Object.entries(region.engines)) {
      if (!acc.engines[engineName]) {
        acc.engines[engineName] = {
          texts: [],
          confidences: [],
          elapsed_ms_values: [],
        };
      }
      const samples = acc.engines[engineName]!;
      samples.texts.push(result.text);
      samples.confidences.push(result.confidence);
      samples.elapsed_ms_values.push(result.elapsed_ms);
    }
  }
  return updated;
}

function _padZero(n: number, len: number): string {
  return String(n).padStart(len, "0");
}

export const useFullMatchStore = create<FullMatchState>()((set, get) => ({
  active: false,
  sessionId: "",
  totalFrames: 0,
  processedFrames: 0,
  selectedFrameIndex: null,

  sceneTimeline: [],
  frameResults: [],
  pokemonResults: [],
  sceneCounts: {},
  totalElapsedMs: 0,

  ocrResults: {},
  engineStats: {},
  frameFilenames: {},
  skippedFrames: 0,
  scenesMap: {},

  sceneDisplayName: (key: string): string => {
    const map = get().scenesMap;
    return map[key]?.display_name || key;
  },

  fetchScenes: async () => {
    const map = await getScenes();
    set({ scenesMap: map });
  },

  start: () =>
    set({
      active: true,
      totalFrames: 0,
      processedFrames: 0,
      skippedFrames: 0,
      selectedFrameIndex: null,
      sceneTimeline: [],
      frameResults: [],
      pokemonResults: [],
      sceneCounts: {},
      totalElapsedMs: 0,
      ocrResults: {},
      engineStats: {},
      frameFilenames: {},
    }),

  stop: () => set({ active: false }),

  setSessionId: (id: string) => set({ sessionId: id }),

  setTotal: (n: number) => set({ totalFrames: n }),

  addSceneChange: (data: SceneChangeEvent) =>
    set((state) => ({
      sceneTimeline: [...state.sceneTimeline, data],
    })),

  addFrameSummary: (data: FrameSummaryEvent) =>
    set((state) => ({
      frameResults: [...state.frameResults, data],
      processedFrames: state.processedFrames + 1,
    })),

  addFrameSkipped: () =>
    set((state) => ({ skippedFrames: state.skippedFrames + 1 })),

  addPokemonResult: (data: PokemonIdentifiedEvent) =>
    set((state) => ({
      pokemonResults: [...state.pokemonResults, data],
    })),

  addOcrResult: (data: BenchmarkResultEvent | OcrResultEvent) =>
    set((state) => {
      if (data.type === "benchmark_result") {
        const detail: FrameOcrDetail = {
          frame_index: data.frame_index,
          timestamp_ms: data.timestamp_ms,
          scene: data.scene,
          elapsed_ms: data.elapsed_ms,
          regions: _stripCropAndConvert(data.regions),
        };
        return {
          ocrResults: { ...state.ocrResults, [data.frame_index]: detail },
          engineStats: _accumulateEngineStats(state.engineStats, data.regions),
        };
      }
      // ocr_result (single engine mode) — リージョン情報だけ保存
      const detail: FrameOcrDetail = {
        frame_index: data.frame_index,
        timestamp_ms: data.timestamp_ms,
        scene: data.scene,
        elapsed_ms: data.elapsed_ms,
        regions: data.regions.map((r) => ({
          name: r.name,
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          engines: { default: { text: r.text, confidence: r.confidence, elapsed_ms: r.elapsed_ms } },
        })),
      };
      return {
        ocrResults: { ...state.ocrResults, [data.frame_index]: detail },
      };
    }),

  selectFrame: (index: number | null) => set({ selectedFrameIndex: index }),

  registerFrameFilename: (index: number, timestampMs: number) =>
    set((state) => ({
      frameFilenames: {
        ...state.frameFilenames,
        [index]: `${_padZero(index, 6)}_${_padZero(timestampMs, 7)}.jpg`,
      },
    })),

  setDone: (data: FullMatchDoneEvent) =>
    set({
      active: false,
      sceneCounts: data.scene_counts,
      totalElapsedMs: data.total_elapsed_ms,
    }),

  reset: () =>
    set({
      active: false,
      totalFrames: 0,
      processedFrames: 0,
      skippedFrames: 0,
      selectedFrameIndex: null,
      sceneTimeline: [],
      frameResults: [],
      pokemonResults: [],
      sceneCounts: {},
      totalElapsedMs: 0,
      ocrResults: {},
      engineStats: {},
      frameFilenames: {},
    }),
}));
