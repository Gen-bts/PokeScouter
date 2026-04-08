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
// シーン
// ---------------------------------------------------------------------------

export interface SceneMeta {
  display_name: string;
  description: string;
}

export interface SceneConfig {
  display_name: string;
  description: string;
  detection: Record<string, DetectionRegionDef>;
  regions: Record<string, RegionDef>;
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
  meta: { display_name?: string; description?: string },
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
// オフラインベンチマーク（SSE）
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
