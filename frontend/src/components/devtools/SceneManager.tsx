import { useCallback, useEffect, useState } from "react";
import {
  getScenes,
  createScene,
  updateScene,
  deleteScene,
  reorderScenes,
  type SceneMeta,
} from "../../api/devtools";

interface SceneEntry {
  key: string;
  display_name: string;
  description: string;
  interval_ms: number;
}

export function SceneManager() {
  const [scenes, setScenes] = useState<SceneEntry[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIntervalMs, setEditIntervalMs] = useState(500);

  // 新規追加フォーム
  const [newKey, setNewKey] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const loadScenes = useCallback(async () => {
    const data = await getScenes();
    const entries: SceneEntry[] = Object.entries(data).map(([key, meta]) => ({
      key,
      display_name: meta.display_name,
      description: meta.description,
      interval_ms: meta.interval_ms,
    }));
    setScenes(entries);
  }, []);

  useEffect(() => {
    loadScenes();
  }, [loadScenes]);

  // --- 追加 ---
  const handleAdd = useCallback(async () => {
    if (!newKey.trim()) return;
    await createScene(
      newKey.trim(),
      newDisplayName.trim() || newKey.trim(),
      newDescription.trim(),
    );
    setNewKey("");
    setNewDisplayName("");
    setNewDescription("");
    await loadScenes();
  }, [newKey, newDisplayName, newDescription, loadScenes]);

  // --- 編集 ---
  const startEdit = useCallback((entry: SceneEntry) => {
    setEditingKey(entry.key);
    setEditDisplayName(entry.display_name);
    setEditDescription(entry.description);
    setEditIntervalMs(entry.interval_ms);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingKey(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingKey) return;
    await updateScene(editingKey, {
      display_name: editDisplayName,
      description: editDescription,
      interval_ms: editIntervalMs,
    });
    setEditingKey(null);
    await loadScenes();
  }, [editingKey, editDisplayName, editDescription, loadScenes]);

  // --- 削除 ---
  const handleDelete = useCallback(
    async (key: string, displayName: string) => {
      if (!confirm(`シーン「${displayName}」を削除しますか？\nこのシーンに属する全てのクロップも削除されます。`))
        return;
      await deleteScene(key);
      await loadScenes();
    },
    [loadScenes],
  );

  // --- 並び替え ---
  const moveScene = useCallback(
    async (index: number, direction: -1 | 1) => {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= scenes.length) return;

      const reordered = [...scenes];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(newIndex, 0, moved);
      setScenes(reordered);

      await reorderScenes(reordered.map((s) => s.key));
    },
    [scenes],
  );

  return (
    <div className="devtools-panel scene-manager">
      <h2>シーン管理</h2>
      <p className="scene-manager-description">
        シーンの追加・編集・削除・並び替えを行います。
        シーンの順序はシーン判定の優先度に影響します。
      </p>

      {/* シーン一覧 */}
      <div className="scene-list">
        {scenes.length === 0 && (
          <p className="placeholder">シーンがありません</p>
        )}
        {scenes.map((entry, index) => (
          <div className="scene-item" key={entry.key}>
            {editingKey === entry.key ? (
              /* 編集モード */
              <div className="scene-edit-form">
                <div className="scene-edit-row">
                  <span className="scene-key-badge">{entry.key}</span>
                </div>
                <label>表示名</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                />
                <label>説明</label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
                <label>ポーリング間隔 (ms)</label>
                <input
                  type="number"
                  min={100}
                  max={5000}
                  step={100}
                  value={editIntervalMs}
                  onChange={(e) => setEditIntervalMs(Number(e.target.value))}
                />
                <div className="scene-edit-actions">
                  <button className="btn-save" onClick={saveEdit}>
                    保存
                  </button>
                  <button onClick={cancelEdit}>キャンセル</button>
                </div>
              </div>
            ) : (
              /* 表示モード */
              <>
                <div className="scene-order-controls">
                  <button
                    className="btn-icon"
                    onClick={() => moveScene(index, -1)}
                    disabled={index === 0}
                    title="上へ"
                  >
                    ▲
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => moveScene(index, 1)}
                    disabled={index === scenes.length - 1}
                    title="下へ"
                  >
                    ▼
                  </button>
                </div>
                <div className="scene-info">
                  <div className="scene-header">
                    <span className="scene-key-badge">{entry.key}</span>
                    <span className="scene-display-name">
                      {entry.display_name}
                    </span>
                    <span className="scene-interval-badge">
                      {entry.interval_ms}ms
                    </span>
                  </div>
                  {entry.description && (
                    <div className="scene-description">
                      {entry.description}
                    </div>
                  )}
                </div>
                <div className="scene-actions">
                  <button
                    className="btn-icon"
                    onClick={() => startEdit(entry)}
                    title="編集"
                  >
                    ✎
                  </button>
                  <button
                    className="btn-icon btn-danger"
                    onClick={() =>
                      handleDelete(entry.key, entry.display_name)
                    }
                    title="削除"
                  >
                    ×
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* 新規追加フォーム */}
      <div className="scene-add-form">
        <h3>シーン追加</h3>
        <label htmlFor="scene-new-key">キー (ASCII)</label>
        <input
          type="text"
          id="scene-new-key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="例: battle"
          pattern="[a-zA-Z0-9_]+"
        />
        <label htmlFor="scene-new-display-name">表示名</label>
        <input
          type="text"
          id="scene-new-display-name"
          value={newDisplayName}
          onChange={(e) => setNewDisplayName(e.target.value)}
          placeholder="例: バトル"
        />
        <label htmlFor="scene-new-description">説明</label>
        <input
          type="text"
          id="scene-new-description"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          placeholder="例: 対戦中の画面"
        />
        <button
          className="btn-save"
          onClick={handleAdd}
          disabled={!newKey.trim()}
        >
          追加
        </button>
      </div>
    </div>
  );
}
