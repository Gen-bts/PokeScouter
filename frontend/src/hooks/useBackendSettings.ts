import { useCallback, useEffect, useState } from "react";

/** バックエンド設定の型定義（settings.toml の構造に対応） */
export interface BackendSettings {
  server: {
    host: string;
    port: number;
    cors_origins: string[];
    logging: {
      log_dir: string;
      max_bytes: number;
      backup_count: number;
      audit_max_bytes: number;
      audit_backup_count: number;
    };
  };
  calc_service: {
    base_url: string;
    timeout: number;
  };
  ocr: {
    glm: { model_id: string; max_new_tokens: number };
    paddle: { det_model: string; rec_model: string; device: string };
  };
  recognition: {
    scene_detector: {
      template_threshold: number;
      ocr_threshold: number;
    };
    pokemon_matcher: {
      threshold: number;
      model: string;
    };
    party_register: {
      detection_debounce: number;
      detection_debounce_high_conf: number;
      high_confidence_threshold: number;
      detection_timeout_s: number;
    };
    scene_state: {
      top_debounce: number;
      sub_debounce: number;
      sub_revert_count: number;
      force_cooldown_seconds: number;
    };
  };
}

interface PatchResponse {
  settings: BackendSettings;
  restart_required: boolean;
}

export function useBackendSettings() {
  const [settings, setSettings] = useState<BackendSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BackendSettings = await res.json();
      setSettings(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = useCallback(
    async (patch: Record<string, unknown>): Promise<PatchResponse | null> => {
      try {
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PatchResponse = await res.json();
        setSettings(data.settings);
        setError(null);
        return data;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [],
  );

  return { settings, loading, error, updateSettings, refetch: fetchSettings };
}
