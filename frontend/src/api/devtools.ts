// DevTools REST API クライアント

import type { BenchmarkRegion } from "../types";

export interface SessionMetadata {
  session_id: string;
  created_at: string;
  frame_count: number;
  duration_ms: number;
  resolution: [number, number];
  status: "recording" | "completed";
  description: string;
}

export interface FrameInfo {
  index: number;
  filename: string;
  timestamp_ms: number;
}

// ---------------------------------------------------------------------------
// リージョン（OCR読み取り用クロップ）
// ---------------------------------------------------------------------------

export interface RegionDef {
  x: number;
  y: number;
  w: number;
  h: number;
  engine: string;
  read_once?: boolean;
}

// ---------------------------------------------------------------------------
// 検出クロップ（シーン判定用）
// ---------------------------------------------------------------------------

export interface DetectionRegionDef {
  x: number;
  y: number;
  w: number;
  h: number;
  method: string;
  [key: string]: unknown; // method 固有パラメータ
}

// ---------------------------------------------------------------------------
// ポケモンアイコン（画像認識用クロップ）
// ---------------------------------------------------------------------------

export interface PokemonIconDef {
  x: number;
  y: number;
  w: number;
  h: number;
  read_once?: boolean;
}

// ---------------------------------------------------------------------------
// リージョングループ（テンプレート + スロット）
// ---------------------------------------------------------------------------

export interface RegionGroupTemplateEntry {
  dx: number;
  dy: number;
  w: number;
  h: number;
  type: "region" | "pokemon_icon";
  engine?: string;
  read_once?: boolean;
}

export interface RegionGroupSlot {
  name: string;
  x: number;
  y: number;
}

export interface RegionGroup {
  template: Record<string, RegionGroupTemplateEntry>;
  slots: RegionGroupSlot[];
}

// ---------------------------------------------------------------------------
// シーン
// ---------------------------------------------------------------------------

export interface SceneMeta {
  display_name: string;
  description: string;
  interval_ms: number;
}

export interface SceneConfig {
  display_name: string;
  description: string;
  detection: Record<string, DetectionRegionDef>;
  regions: Record<string, RegionDef>;
  pokemon_icons?: Record<string, PokemonIconDef>;
  region_groups?: Record<string, RegionGroup>;
}

export interface RegionsConfig {
  _comment?: string;
  resolution: { width: number; height: number };
  scenes: Record<string, SceneConfig>;
}

const BASE = "/api/devtools";

// ---------------------------------------------------------------------------
// 録画セッション
// ---------------------------------------------------------------------------

export async function createSession(
  description = "",
): Promise<SessionMetadata> {
  const res = await fetch(`${BASE}/recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return res.json();
}

export async function listSessions(): Promise<SessionMetadata[]> {
  const res = await fetch(`${BASE}/recordings`);
  return res.json();
}

export async function getSession(
  sessionId: string,
): Promise<SessionMetadata> {
  const res = await fetch(`${BASE}/recordings/${sessionId}`);
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BASE}/recordings/${sessionId}`, { method: "DELETE" });
}

export async function uploadFrame(
  sessionId: string,
  blob: Blob,
  timestampMs: number,
): Promise<FrameInfo> {
  const res = await fetch(`${BASE}/recordings/${sessionId}/frames`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Timestamp-Ms": String(timestampMs),
    },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`uploadFrame failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function completeSession(
  sessionId: string,
): Promise<SessionMetadata> {
  const res = await fetch(`${BASE}/recordings/${sessionId}/complete`, {
    method: "POST",
  });
  return res.json();
}

export async function listFrames(sessionId: string): Promise<FrameInfo[]> {
  const res = await fetch(`${BASE}/recordings/${sessionId}/frames`);
  return res.json();
}

export function frameUrl(sessionId: string, filename: string): string {
  return `${BASE}/recordings/${sessionId}/frames/${filename}`;
}

export function thumbnailUrl(sessionId: string, filename: string): string {
  return `${BASE}/recordings/${sessionId}/frames/${filename}/thumbnail`;
}

// ---------------------------------------------------------------------------
// シーン管理
// ---------------------------------------------------------------------------

export async function getScenes(): Promise<Record<string, SceneMeta>> {
  const res = await fetch(`${BASE}/scenes`);
  return res.json();
}

export async function createScene(
  key: string,
  displayName: string,
  description = "",
): Promise<RegionsConfig> {
  const res = await fetch(`${BASE}/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, display_name: displayName, description }),
  });
  return res.json();
}

export async function updateScene(
  scene: string,
  meta: { display_name?: string; description?: string; interval_ms?: number },
): Promise<RegionsConfig> {
  const res = await fetch(`${BASE}/scenes/${scene}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  return res.json();
}

export async function deleteScene(scene: string): Promise<RegionsConfig> {
  const res = await fetch(`${BASE}/scenes/${scene}`, { method: "DELETE" });
  return res.json();
}

export async function reorderScenes(
  keys: string[],
): Promise<RegionsConfig> {
  const res = await fetch(`${BASE}/scenes/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// リージョン（OCR読み取り用クロップ）
// ---------------------------------------------------------------------------

export async function getRegions(): Promise<RegionsConfig> {
  const res = await fetch(`${BASE}/regions`);
  return res.json();
}

export async function upsertRegion(
  scene: string,
  name: string,
  region: RegionDef,
): Promise<RegionsConfig> {
  const res = await fetch(`${BASE}/regions/${scene}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...region }),
  });
  return res.json();
}

export async function deleteRegion(
  scene: string,
  name: string,
): Promise<RegionsConfig> {
  const res = await fetch(
    `${BASE}/regions/${scene}?name=${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  return res.json();
}

// ---------------------------------------------------------------------------
// 検出クロップ（シーン判定用）
// ---------------------------------------------------------------------------

export async function upsertDetectionRegion(
  scene: string,
  name: string,
  def: DetectionRegionDef,
): Promise<RegionsConfig> {
  const { x, y, w, h, method, ...rest } = def;
  const res = await fetch(`${BASE}/detection/${scene}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, x, y, w, h, method, params: rest }),
  });
  return res.json();
}

export async function deleteDetectionRegion(
  scene: string,
  name: string,
): Promise<RegionsConfig> {
  const res = await fetch(
    `${BASE}/detection/${scene}?name=${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  return res.json();
}

// ---------------------------------------------------------------------------
// ポケモンアイコン（画像認識用クロップ）
// ---------------------------------------------------------------------------

export async function upsertPokemonIcon(
  scene: string,
  name: string,
  def: PokemonIconDef,
): Promise<RegionsConfig> {
  const res = await fetch(`${BASE}/pokemon-icons/${scene}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...def }),
  });
  return res.json();
}

export async function deletePokemonIcon(
  scene: string,
  name: string,
): Promise<RegionsConfig> {
  const res = await fetch(
    `${BASE}/pokemon-icons/${scene}?name=${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  return res.json();
}

// ---------------------------------------------------------------------------
// リージョングループ
// ---------------------------------------------------------------------------

export async function createRegionGroup(
  scene: string,
  groupName: string,
  template: Record<string, RegionGroupTemplateEntry> = {},
  slots: RegionGroupSlot[] = [],
): Promise<RegionsConfig> {
  const res = await fetch(`${BASE}/region-groups/${scene}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group_name: groupName, template, slots }),
  });
  return res.json();
}

export async function deleteRegionGroup(
  scene: string,
  groupName: string,
): Promise<RegionsConfig> {
  const res = await fetch(
    `${BASE}/region-groups/${scene}?group_name=${encodeURIComponent(groupName)}`,
    { method: "DELETE" },
  );
  return res.json();
}

export async function upsertGroupTemplate(
  scene: string,
  groupName: string,
  subName: string,
  entry: Omit<RegionGroupTemplateEntry, "type"> & { type?: string },
): Promise<RegionsConfig> {
  const res = await fetch(
    `${BASE}/region-groups/${scene}/${encodeURIComponent(groupName)}/template`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub_name: subName, ...entry }),
    },
  );
  return res.json();
}

export async function deleteGroupTemplate(
  scene: string,
  groupName: string,
  subName: string,
): Promise<RegionsConfig> {
  const res = await fetch(
    `${BASE}/region-groups/${scene}/${encodeURIComponent(groupName)}/template?sub_name=${encodeURIComponent(subName)}`,
    { method: "DELETE" },
  );
  return res.json();
}

export async function upsertGroupSlot(
  scene: string,
  groupName: string,
  slot: RegionGroupSlot,
): Promise<RegionsConfig> {
  const res = await fetch(
    `${BASE}/region-groups/${scene}/${encodeURIComponent(groupName)}/slots`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slot),
    },
  );
  return res.json();
}

export async function deleteGroupSlot(
  scene: string,
  groupName: string,
  slotName: string,
): Promise<RegionsConfig> {
  const res = await fetch(
    `${BASE}/region-groups/${scene}/${encodeURIComponent(groupName)}/slots?name=${encodeURIComponent(slotName)}`,
    { method: "DELETE" },
  );
  return res.json();
}

// ---------------------------------------------------------------------------
// オフラインベンチマーク（SSE）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1試合通しベンチマーク（SSE）
// ---------------------------------------------------------------------------

export interface SceneChangeEvent {
  type: "scene_change";
  frame_index: number;
  timestamp_ms: number;
  scene: string;
  top_level: string;
  sub_scene: string | null;
  confidence: number;
}

export interface PokemonIdentifiedEvent {
  type: "pokemon_identified";
  frame_index: number;
  timestamp_ms: number;
  pokemon: { position: number; pokemon_id: number | null; confidence: number }[];
  elapsed_ms: number;
}

export interface FrameSummaryEvent {
  type: "frame_summary";
  frame_index: number;
  timestamp_ms: number;
  scene_key: string;
  detection_ms: number;
  ocr_ms: number;
  total_ms: number;
}

export interface FullMatchDoneEvent {
  total_frames: number;
  processed_frames: number;
  skipped_frames: number;
  total_elapsed_ms: number;
  scene_timeline: { frame_index: number; timestamp_ms: number; scene: string; confidence: number }[];
  scene_counts: Record<string, number>;
}

export interface FrameSkippedEvent {
  frame_index: number;
  timestamp_ms: number;
  scene_key: string;
}

export interface BenchmarkResultRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  crop_b64?: string;
  engines: Record<string, { text: string; confidence: number; elapsed_ms: number }>;
}

export interface BenchmarkResultEvent {
  type: "benchmark_result";
  frame_index: number;
  timestamp_ms: number;
  scene: string;
  elapsed_ms: number;
  regions: BenchmarkResultRegion[];
}

export interface OcrResultEvent {
  type: "ocr_result";
  frame_index: number;
  timestamp_ms: number;
  scene: string;
  elapsed_ms: number;
  regions: {
    name: string;
    text: string;
    confidence: number;
    elapsed_ms: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }[];
}

export interface FullMatchCallbacks {
  onStart: (totalFrames: number) => void;
  onSceneChange: (data: SceneChangeEvent) => void;
  onPokemonIdentified: (data: PokemonIdentifiedEvent) => void;
  onOcrResult: (data: BenchmarkResultEvent | OcrResultEvent) => void;
  onFrameSummary: (data: FrameSummaryEvent) => void;
  onFrameSkipped?: (data: FrameSkippedEvent) => void;
  onDone: (data: FullMatchDoneEvent) => void;
  onError: (error: Error) => void;
}

export function runFullMatchBenchmark(
  sessionId: string,
  ocrMode: string,
  callbacks: FullMatchCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/benchmark/${sessionId}/full-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ocr_mode: ocrMode }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Full-match benchmark failed: ${res.status} ${res.statusText}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop()!;

        for (const part of parts) {
          if (!part.trim()) continue;

          let eventType = "message";
          let data = "";

          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              data = line.slice(6);
            }
          }

          if (!data) continue;
          const parsed = JSON.parse(data);

          switch (eventType) {
            case "start":
              callbacks.onStart(parsed.total_frames);
              break;
            case "scene_change":
              callbacks.onSceneChange(parsed);
              break;
            case "pokemon_identified":
              callbacks.onPokemonIdentified(parsed);
              break;
            case "ocr_result":
            case "benchmark_result":
              callbacks.onOcrResult(parsed);
              break;
            case "frame_summary":
              callbacks.onFrameSummary(parsed);
              break;
            case "frame_skipped":
              callbacks.onFrameSkipped?.(parsed);
              break;
            case "done":
              callbacks.onDone(parsed);
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        callbacks.onError(err as Error);
      }
    }
  })();

  return controller;
}

// ---------------------------------------------------------------------------
// アドホックテスト（フレームビューワー用）
// ---------------------------------------------------------------------------

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrTestResult {
  crop: CropRect;
  engines: Record<string, { text: string; confidence: number; elapsed_ms: number }>;
}

export interface PokemonCandidate {
  pokemon_id: number;
  name: string;
  confidence: number;
}

export interface PokemonTestResult {
  crop: CropRect;
  candidates: PokemonCandidate[];
  threshold: number;
  result: { pokemon_id: number; confidence: number } | null;
  crop_b64: string;
  template_b64: string | null;
  elapsed_ms: number;
}

export async function runOcrTest(
  sessionId: string,
  filename: string,
  crop: CropRect,
): Promise<OcrTestResult> {
  const res = await fetch(
    `${BASE}/recordings/${sessionId}/frames/${filename}/ocr-test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(crop),
    },
  );
  if (!res.ok) {
    throw new Error(`OCR test failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function runPokemonTest(
  sessionId: string,
  filename: string,
  crop: CropRect,
): Promise<PokemonTestResult> {
  const res = await fetch(
    `${BASE}/recordings/${sessionId}/frames/${filename}/pokemon-test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(crop),
    },
  );
  if (!res.ok) {
    throw new Error(`Pokemon test failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// OCRエンジン比較ベンチマーク（SSE）
// ---------------------------------------------------------------------------

export interface OfflineBenchmarkCallbacks {
  onStart: (totalFrames: number) => void;
  onFrame: (regions: BenchmarkRegion[]) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export function runOfflineBenchmark(
  sessionId: string,
  scene: string,
  callbacks: OfflineBenchmarkCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${BASE}/benchmark/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Benchmark failed: ${res.status} ${res.statusText}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE イベントをパース（\n\n で区切られる）
        const parts = buffer.split("\n\n");
        buffer = parts.pop()!; // 最後の不完全な部分を保持

        for (const part of parts) {
          if (!part.trim()) continue;

          let eventType = "message";
          let data = "";

          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              data = line.slice(6);
            }
          }

          if (!data) continue;
          const parsed = JSON.parse(data);

          switch (eventType) {
            case "start":
              callbacks.onStart(parsed.total_frames);
              break;
            case "frame":
              callbacks.onFrame(parsed.regions);
              break;
            case "done":
              callbacks.onDone();
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        callbacks.onError(err as Error);
      }
    }
  })();

  return controller;
}
