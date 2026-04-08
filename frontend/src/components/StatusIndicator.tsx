import type { ConnectionState } from "../types";

const STATE_LABELS: Record<ConnectionState, string> = {
  connected: "接続中",
  disconnected: "未接続",
  connecting: "接続中...",
  reconnecting: "再接続中...",
  processing: "処理中...",
};

interface Props {
  state: ConnectionState;
}

export function StatusIndicator({ state }: Props) {
  return (
    <section className="panel-section">
      <h2>ステータス</h2>
      <div className={`status ${state}`}>
        <span className="status-dot" />
        <span>{STATE_LABELS[state]}</span>
      </div>
    </section>
  );
}
