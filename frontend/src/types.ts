export type ConnectionState =
  | "connected"
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "processing";

export interface Region {
  name: string;
  text: string;
  confidence: number;
  elapsed_ms: number;
  x: number;
  y: number;
  w: number;
  h: number;
  crop_b64?: string;
}

export interface OcrResult {
  type: "ocr_result";
  regions: Region[];
  elapsed_ms: number;
  scene: string;
  resolution?: { width: number; height: number };
}

export interface StatusMessage {
  type: "status";
  status: string;
}

export interface WsConfig {
  scene?: string;
  interval_ms?: number;
  paused?: boolean;
  debug_crops?: boolean;
  benchmark?: boolean;
}

export interface BenchmarkEngineResult {
  engine: string;
  text: string;
  confidence: number;
  elapsed_ms: number;
}

export interface BenchmarkRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  crop_b64?: string;
  engines: BenchmarkEngineResult[];
}

export interface BenchmarkResult {
  type: "benchmark_result";
  scene: string;
  elapsed_ms: number;
  regions: BenchmarkRegion[];
  resolution?: { width: number; height: number };
}

export interface PokemonIdentified {
  position: number;
  pokemon_id: number | null;
  confidence: number;
}

export interface PokemonIdentifiedResult {
  type: "pokemon_identified";
  pokemon: PokemonIdentified[];
  elapsed_ms: number;
}
