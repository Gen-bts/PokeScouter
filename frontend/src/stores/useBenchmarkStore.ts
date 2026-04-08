import { create } from "zustand";
import type { BenchmarkRegion } from "../types";

export interface EngineSamples {
  texts: string[];
  confidences: number[];
  elapsed_ms_values: number[];
}

export interface RegionAccumulator {
  engines: Record<string, EngineSamples>;
  lastCrop?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BenchmarkState {
  active: boolean;
  scene: string;
  frameCount: number;
  regionData: Record<string, RegionAccumulator>;

  start: (scene: string) => void;
  stop: () => void;
  addFrame: (regions: BenchmarkRegion[]) => void;
  reset: () => void;
}

export const useBenchmarkStore = create<BenchmarkState>()((set) => ({
  active: false,
  scene: "",
  frameCount: 0,
  regionData: {},

  start: (scene: string) =>
    set({ active: true, scene, frameCount: 0, regionData: {} }),

  stop: () => set({ active: false }),

  addFrame: (regions: BenchmarkRegion[]) =>
    set((state) => {
      const updated = { ...state.regionData };

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

        const acc = updated[region.name];

        if (region.crop_b64) {
          acc.lastCrop = region.crop_b64;
        }

        for (const eng of region.engines) {
          if (!acc.engines[eng.engine]) {
            acc.engines[eng.engine] = {
              texts: [],
              confidences: [],
              elapsed_ms_values: [],
            };
          }
          const samples = acc.engines[eng.engine];
          samples.texts.push(eng.text);
          samples.confidences.push(eng.confidence);
          samples.elapsed_ms_values.push(eng.elapsed_ms);
        }
      }

      return { regionData: updated, frameCount: state.frameCount + 1 };
    }),

  reset: () => set({ active: false, scene: "", frameCount: 0, regionData: {} }),
}));
