import { useEffect, useRef } from "react";
import {
  useMatchLogStore,
  type BattleEventLogEntry,
  type MatchLogEntry,
  type MatchTeamsLogEntry,
  type OcrResultLogEntry,
} from "../stores/useMatchLogStore";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("ja-JP", { hour12: false });
}

function SceneChangeEntry({ entry }: { entry: MatchLogEntry & { kind: "scene_change" } }) {
  return (
    <div className="match-log-entry">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-scene">{entry.scene}</span>
      <span className="match-log-confidence">
        {(entry.confidence * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function MatchTeamsEntry({ entry }: { entry: MatchTeamsLogEntry }) {
  const playerNames = entry.playerTeam
    .map((p) => p.name || "?")
    .join(", ");
  const opponentNames = entry.opponentTeam
    .map((p) => p.name || "?")
    .join(", ");
  return (
    <div className="match-log-entry match-log-teams">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <div className="match-log-teams-detail">
        <div className="match-log-team-row">
          <span className="match-log-team-label">味方</span>
          <span className="match-log-team-names">{playerNames}</span>
        </div>
        <div className="match-log-team-row">
          <span className="match-log-team-label">相手</span>
          <span className="match-log-team-names">{opponentNames}</span>
        </div>
      </div>
    </div>
  );
}

function TeamSelectionEntry({
  entry,
  entries,
}: {
  entry: MatchLogEntry & { kind: "team_selection" };
  entries: MatchLogEntry[];
}) {
  // 直前の match_teams エントリから名前を引く
  const lastTeams = [...entries]
    .reverse()
    .find((e): e is MatchTeamsLogEntry => e.kind === "match_teams");

  const names = entry.selectedPositions.map((pos) => {
    const p = lastTeams?.playerTeam.find((t) => t.position === pos);
    return p?.name || `#${pos}`;
  });

  return (
    <div className="match-log-entry match-log-selection">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-selection-label">選出:</span>
      <span className="match-log-selection-names">{names.join(", ")}</span>
    </div>
  );
}

function OcrResultEntry({ entry }: { entry: OcrResultLogEntry }) {
  return (
    <div className="match-log-entry match-log-ocr">
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-scene">{entry.scene}</span>
      <div className="match-log-ocr-regions">
        {entry.regions.map((r, i) => (
          <div key={i} className="match-log-ocr-region">
            <span className="match-log-ocr-name">{r.name}</span>
            <span className="match-log-ocr-text">{r.text || "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BattleEventEntry({ entry }: { entry: BattleEventLogEntry }) {
  const sideLabel = entry.side === "opponent" ? "相手" : "自分";
  const sideCls = entry.side === "opponent" ? "match-log-event-opponent" : "match-log-event-player";

  let description = entry.rawText;
  if (entry.eventType === "pokemon_fainted") {
    const name = entry.pokemonName ?? "???";
    description = `${sideLabel}の ${name} は たおれた！`;
  } else if (entry.eventType === "opponent_sent_out") {
    const name = entry.pokemonName ?? "???";
    const trainer = (entry.details?.trainer_name as string) ?? "相手";
    description = `${trainer}が ${name} を繰り出した！`;
  }

  return (
    <div className={`match-log-entry match-log-battle-event ${sideCls}`}>
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-event-text">{description}</span>
    </div>
  );
}

function BattleResultEntry({ entry }: { entry: MatchLogEntry & { kind: "battle_result" } }) {
  const cls =
    entry.result === "win"
      ? "match-log-result-win"
      : entry.result === "lose"
        ? "match-log-result-lose"
        : "";
  const label =
    entry.result === "win" ? "WIN" : entry.result === "lose" ? "LOSE" : "???";
  return (
    <div className={`match-log-entry match-log-result ${cls}`}>
      <span className="match-log-time">{formatTime(entry.timestamp)}</span>
      <span className="match-log-result-label">{label}</span>
    </div>
  );
}

export function MatchLog() {
  const entries = useMatchLogStore((s) => s.entries);
  const clear = useMatchLogStore((s) => s.clear);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="panel-section match-log">
      <div className="match-log-header">
        <h2>Match Log</h2>
        {entries.length > 0 && (
          <button className="btn-small btn-clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <div className="match-log-list" ref={listRef}>
        {entries.length === 0 ? (
          <span className="placeholder">シーン遷移を待機中…</span>
        ) : (
          entries.map((e, i) => {
            switch (e.kind) {
              case "scene_change":
                return <SceneChangeEntry key={i} entry={e} />;
              case "match_teams":
                return <MatchTeamsEntry key={i} entry={e} />;
              case "team_selection":
                return (
                  <TeamSelectionEntry key={i} entry={e} entries={entries} />
                );
              case "battle_result":
                return <BattleResultEntry key={i} entry={e} />;
              case "battle_event":
                return <BattleEventEntry key={i} entry={e} />;
              case "ocr_result":
                return <OcrResultEntry key={i} entry={e} />;
            }
          })
        )}
      </div>
    </div>
  );
}
