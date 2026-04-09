import { useEffect, useState } from "react";
import { useMyPartyStore, type MyPartySlot } from "../stores/useMyPartyStore";
import { useConnectionStore } from "../stores/useConnectionStore";

const PHASE_LABELS: Record<string, string> = {
  detecting_screen1: "画面1を検出中...",
  reading_screen1: "画面1を読み取り中...",
  detecting_screen2: "画面2を検出中...",
  reading_screen2: "画面2を読み取り中...",
};

function SpriteImg({
  pokemonId,
  size = 40,
}: {
  pokemonId: number | null;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [pokemonId]);

  if (pokemonId === null || errored) {
    return (
      <div
        className="my-party-slot-placeholder"
        style={{ width: size, height: size }}
      >
        ?
      </div>
    );
  }

  return (
    <img
      className="my-party-slot-img"
      src={`/sprites/${pokemonId}.png`}
      alt={`#${pokemonId}`}
      width={size}
      height={size}
      onError={() => setErrored(true)}
    />
  );
}

function SlotRow({ slot }: { slot: MyPartySlot }) {
  const detailEntries = Object.entries(slot.details);

  return (
    <div
      className={`my-party-slot${slot.pokemonId === null ? " my-party-slot-empty" : ""}`}
    >
      <span className="my-party-slot-pos">#{slot.position}</span>
      <SpriteImg pokemonId={slot.pokemonId} />
      <div className="my-party-slot-info">
        <span className="my-party-slot-name">
          {slot.name ?? "???"}
        </span>
        {detailEntries.length > 0 && (
          <div className="my-party-slot-details">
            {detailEntries.map(([key, val]) => (
              <span key={key} className="my-party-slot-detail" title={key}>
                {val}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function MyPartyPanel() {
  const slots = useMyPartyStore((s) => s.slots);
  const registrationState = useMyPartyStore((s) => s.registrationState);
  const error = useMyPartyStore((s) => s.error);
  const clear = useMyPartyStore((s) => s.clear);

  const isConnected = useConnectionStore((s) => s.isConnected);
  const sendStart = useConnectionStore((s) => s.sendPartyRegisterStart);
  const sendCancel = useConnectionStore((s) => s.sendPartyRegisterCancel);

  const isRegistering =
    registrationState !== "idle" && registrationState !== "done";
  const hasParty = slots.some((s) => s.pokemonId !== null);
  const showSlots = hasParty || registrationState === "done";

  return (
    <div className="panel-section my-party-panel">
      <div className="my-party-panel-header">
        <h2>自分のパーティ</h2>
        {showSlots && !isRegistering && (
          <button className="btn-small btn-clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>

      {isRegistering && (
        <div className="my-party-progress">
          <span className="my-party-progress-label">
            {PHASE_LABELS[registrationState] ?? registrationState}
          </span>
          <button
            className="btn-small btn-cancel"
            onClick={() => {
              sendCancel();
              useMyPartyStore.getState().setRegistrationState("idle");
            }}
          >
            キャンセル
          </button>
        </div>
      )}

      {error && (
        <div className="my-party-error">
          {error}
        </div>
      )}

      {showSlots && (
        <div className="my-party-slots">
          {slots.map((slot) => (
            <SlotRow key={slot.position} slot={slot} />
          ))}
        </div>
      )}

      {!isRegistering && !showSlots && (
        <div className="my-party-actions">
          <button
            className="btn-primary"
            disabled={!isConnected}
            onClick={sendStart}
            title={isConnected ? "パーティ登録を開始" : "サーバーに接続してください"}
          >
            パーティ登録
          </button>
        </div>
      )}

      {showSlots && !isRegistering && (
        <div className="my-party-actions">
          <button
            className="btn-small"
            disabled={!isConnected}
            onClick={sendStart}
          >
            再登録
          </button>
        </div>
      )}
    </div>
  );
}
