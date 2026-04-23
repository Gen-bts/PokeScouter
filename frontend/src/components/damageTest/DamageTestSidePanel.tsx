import { useMemo } from "react";
import { usePokemonNames } from "../../hooks/usePokemonNames";
import { usePokemonDetail } from "../../hooks/usePokemonDetail";
import { useItemNames } from "../../hooks/useItemNames";
import { useLearnset } from "../../hooks/useLearnset";
import {
  useDamageTestStore,
  type NatureMultiplier,
  type Stat,
  type StatKey,
  type StatusKind,
  BOOST_STATS,
  NATURE_MULTIPLIERS,
  STAT_KEYS,
} from "../../stores/useDamageTestStore";
import { calcChampionsHp, calcChampionsStat } from "../../utils/statCalc";
import { PokemonSprite } from "../PokemonSprite";
import { TypeBadge } from "../TypeBadge";
import { Autocomplete, type AutocompleteOption } from "./Autocomplete";

type Role = "attacker" | "defender";

const STAT_LABELS: Record<StatKey, string> = {
  hp: "H",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};

const STAT_FULL_LABELS: Record<StatKey, string> = {
  hp: "HP",
  atk: "こうげき",
  def: "ぼうぎょ",
  spa: "とくこう",
  spd: "とくぼう",
  spe: "すばやさ",
};

const STATUS_OPTIONS: Array<{ value: StatusKind | "none"; label: string }> = [
  { value: "none", label: "なし" },
  { value: "slp", label: "ねむり" },
  { value: "psn", label: "どく" },
  { value: "tox", label: "もうどく" },
  { value: "brn", label: "やけど" },
  { value: "frz", label: "こおり" },
  { value: "par", label: "まひ" },
];

const BOOST_VALUES = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

interface Props {
  role: Role;
}

export function DamageTestSidePanel({ role }: Props) {
  const side = useDamageTestStore((s) => (role === "attacker" ? s.attacker : s.defender));
  const attackerLive = useDamageTestStore((s) => s.attacker);
  const { names: pokemonNames } = usePokemonNames({ championsOnly: false });
  const { items: itemList } = useItemNames();
  const { detail } = usePokemonDetail(side.pokemonKey);
  const { moves: learnset } = useLearnset(side.pokemonKey);

  const setPokemon = useDamageTestStore((s) =>
    role === "attacker" ? s.setAttackerPokemon : s.setDefenderPokemon,
  );
  const setEv = useDamageTestStore((s) =>
    role === "attacker" ? s.setAttackerEv : s.setDefenderEv,
  );
  const setNatureMul = useDamageTestStore((s) =>
    role === "attacker"
      ? s.setAttackerNatureMultiplier
      : s.setDefenderNatureMultiplier,
  );
  const setBoost = useDamageTestStore((s) =>
    role === "attacker" ? s.setAttackerBoost : s.setDefenderBoost,
  );
  const setAbility = useDamageTestStore((s) =>
    role === "attacker" ? s.setAttackerAbility : s.setDefenderAbility,
  );
  const setItem = useDamageTestStore((s) =>
    role === "attacker" ? s.setAttackerItem : s.setDefenderItem,
  );
  const setStatus = useDamageTestStore((s) =>
    role === "attacker" ? s.setAttackerStatus : s.setDefenderStatus,
  );
  const toggleMega = useDamageTestStore((s) =>
    role === "attacker" ? s.toggleAttackerMega : s.toggleDefenderMega,
  );
  const setMove = useDamageTestStore((s) => s.setAttackerMove);
  const reset = useDamageTestStore((s) =>
    role === "attacker" ? s.resetAttacker : s.resetDefender,
  );

  const pokemonOptions = useMemo<AutocompleteOption[]>(
    () =>
      Object.entries(pokemonNames)
        .map(([name, key]) => ({
          key,
          name,
          icon: <PokemonSprite pokemonId={key} size={24} />,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [pokemonNames],
  );

  const itemOptions = useMemo<AutocompleteOption[]>(
    () =>
      itemList.map((it) => ({
        key: it.key,
        name: it.name,
      })),
    [itemList],
  );

  const moveOptions = useMemo<AutocompleteOption[]>(
    () =>
      learnset.map((m) => ({
        key: m.move_key,
        name: m.name,
        subtitle: m.type
          ? `${m.type}${m.power ? ` ${m.power}` : ""}${m.damage_class ? ` ${m.damage_class[0]}` : ""}`
          : undefined,
      })),
    [learnset],
  );

  // メガ進化選択肢（トグルで切り替わる対象の mega_form）
  const megaForm = useMemo(() => {
    if (!detail?.mega_forms || detail.mega_forms.length === 0) return null;
    if (!side.itemKey) return null;
    return detail.mega_forms.find((m) => m.item_key === side.itemKey) ?? null;
  }, [detail, side.itemKey]);

  const canMega = megaForm !== null;
  const isMega = canMega && side.isMegaActive;

  const effectiveBaseStats = isMega && megaForm ? megaForm.base_stats : detail?.base_stats;
  const effectiveTypes = isMega && megaForm ? megaForm.types : detail?.types;

  const pokemonDisplayName = side.pokemonKey
    ? isMega && megaForm
      ? megaForm.mega_name
      : (detail?.name ?? findNameByKey(pokemonNames, side.pokemonKey) ?? side.pokemonKey)
    : null;

  // 実数値プレビュー：性格補正はわざ種類で切り替わるため、攻撃側は atk/spa、
  // 防御側は def/spd に同じ倍率を適用したプレビューを表示する。
  const previewStats = useMemo(() => {
    if (!effectiveBaseStats) return null;
    const mods: Record<Stat, number> = { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 };
    const mul = side.natureMultiplier;
    if (mul !== 1) {
      if (role === "attacker") {
        mods.atk = mul;
        mods.spa = mul;
      } else {
        mods.def = mul;
        mods.spd = mul;
      }
    }
    return {
      hp: calcChampionsHp(effectiveBaseStats.hp ?? 0, side.evAllocation.hp),
      atk: calcChampionsStat(effectiveBaseStats.atk ?? 0, side.evAllocation.atk, mods.atk),
      def: calcChampionsStat(effectiveBaseStats.def ?? 0, side.evAllocation.def, mods.def),
      spa: calcChampionsStat(effectiveBaseStats.spa ?? 0, side.evAllocation.spa, mods.spa),
      spd: calcChampionsStat(effectiveBaseStats.spd ?? 0, side.evAllocation.spd, mods.spd),
      spe: calcChampionsStat(effectiveBaseStats.spe ?? 0, side.evAllocation.spe, mods.spe),
    };
  }, [effectiveBaseStats, side.evAllocation, side.natureMultiplier, role]);

  const evTotal = STAT_KEYS.reduce((sum, s) => sum + (side.evAllocation[s] ?? 0), 0);

  // 特性選択肢（メガ時は mega 固定、それ以外は normal + hidden）
  const abilityOptions = useMemo<Array<{ key: string; name: string; hidden: boolean }>>(() => {
    if (!detail) return [];
    if (isMega && megaForm) {
      const k = megaForm.ability.key ?? megaForm.ability.name;
      return [{ key: k, name: megaForm.ability.name, hidden: false }];
    }
    const opts: Array<{ key: string; name: string; hidden: boolean }> = [];
    for (const a of detail.abilities.normal) {
      opts.push({ key: a.key ?? a.name, name: a.name, hidden: false });
    }
    if (detail.abilities.hidden) {
      const h = detail.abilities.hidden;
      opts.push({ key: h.key ?? h.name, name: h.name, hidden: true });
    }
    return opts;
  }, [detail, isMega, megaForm]);

  const moveAlreadySelected = (idx: number, key: string) =>
    role === "attacker" &&
    attackerLive.moveKeys.some((k, i) => i !== idx && k === key);

  return (
    <div className={`dt-side-panel dt-side-${role}`}>
      <div className="dt-side-header">
        <h3>{role === "attacker" ? "攻撃側" : "防御側"}</h3>
        <button type="button" className="dt-reset-btn" onClick={reset} title="リセット">
          リセット
        </button>
      </div>

      {/* ポケモン選択 */}
      <div className="dt-section">
        <label className="dt-label">ポケモン</label>
        <Autocomplete
          value={side.pokemonKey}
          displayName={pokemonDisplayName}
          options={pokemonOptions}
          placeholder="ポケモン名を入力..."
          onSelect={(key) => setPokemon(key)}
          onClear={() => setPokemon(null)}
          minQueryLength={1}
          maxResults={20}
        />
      </div>

      {/* 種族値・タイプ表示 */}
      {detail && effectiveBaseStats && effectiveTypes && (
        <div className="dt-section">
          <div className="dt-type-row">
            {effectiveTypes.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
            {canMega && (
              <button
                type="button"
                className={`dt-mega-toggle ${isMega ? "active" : ""}`}
                onClick={toggleMega}
                title={`メガ進化: ${megaForm?.mega_name ?? ""}`}
              >
                {isMega ? "✦ メガ中" : "メガ進化"}
              </button>
            )}
          </div>
          <div className="dt-base-stats">
            {STAT_KEYS.map((s) => (
              <div key={s} className="dt-base-stat">
                <span className="dt-stat-label">{STAT_LABELS[s]}</span>
                <span className="dt-stat-value">{effectiveBaseStats[s] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EV / 努力値 */}
      <div className="dt-section">
        <div className="dt-section-head">
          <label className="dt-label">努力値 (各 0-32)</label>
          <span className={`dt-ev-total ${evTotal > 66 ? "over" : ""}`}>
            合計 {evTotal} / 66
          </span>
        </div>
        <div className="dt-ev-grid">
          {STAT_KEYS.map((s) => (
            <div key={s} className="dt-ev-cell">
              <span className="dt-stat-label" title={STAT_FULL_LABELS[s]}>
                {STAT_LABELS[s]}
              </span>
              <input
                type="number"
                min={0}
                max={32}
                value={side.evAllocation[s]}
                onChange={(e) => setEv(s, Number(e.target.value))}
                className="dt-ev-input"
              />
              {previewStats && (
                <span className="dt-stat-preview">{previewStats[s]}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 性格補正（わざ種類に応じて atk/spa または def/spd に倍率を適用） */}
      <div className="dt-section">
        <label className="dt-label">
          性格補正{" "}
          <span className="dt-hint-inline">
            {role === "attacker" ? "→ A/C" : "→ B/D"}
          </span>
        </label>
        <div className="dt-nature-toggle">
          {NATURE_MULTIPLIERS.map((m) => (
            <button
              key={m}
              type="button"
              className={`dt-nature-btn ${side.natureMultiplier === m ? "active" : ""}`}
              onClick={() => setNatureMul(m as NatureMultiplier)}
            >
              ×{m.toFixed(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ランク補正 */}
      <div className="dt-section">
        <label className="dt-label">ランク補正 (-6〜+6)</label>
        <div className="dt-boost-grid">
          {BOOST_STATS.map((s) => (
            <div key={s} className="dt-boost-cell">
              <span className="dt-stat-label" title={STAT_FULL_LABELS[s]}>
                {STAT_LABELS[s]}
              </span>
              <select
                value={side.boosts[s] ?? 0}
                onChange={(e) => setBoost(s, Number(e.target.value))}
                className="dt-select"
              >
                {BOOST_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v > 0 ? `+${v}` : v}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* 特性 */}
      <div className="dt-section">
        <label className="dt-label">特性</label>
        <select
          value={side.abilityKey ?? ""}
          onChange={(e) => setAbility(e.target.value || null)}
          className="dt-select dt-select-wide"
          disabled={isMega || abilityOptions.length === 0}
        >
          <option value="">—</option>
          {abilityOptions.map((a) => (
            <option key={a.key} value={a.key}>
              {a.name}
              {a.hidden ? " (夢)" : ""}
            </option>
          ))}
        </select>
        {isMega && (
          <p className="dt-hint">メガ進化時は特性が固定されます</p>
        )}
      </div>

      {/* 道具 */}
      <div className="dt-section">
        <label className="dt-label">道具</label>
        <Autocomplete
          value={side.itemKey}
          displayName={
            side.itemKey
              ? (itemList.find((it) => it.key === side.itemKey)?.name ?? side.itemKey)
              : null
          }
          options={itemOptions}
          placeholder="道具名を入力..."
          onSelect={(key) => setItem(key)}
          onClear={() => setItem(null)}
          minQueryLength={1}
          maxResults={30}
        />
      </div>

      {/* 技（攻撃側のみ） */}
      {role === "attacker" && (
        <div className="dt-section">
          <label className="dt-label">技 (最大 4)</label>
          <div className="dt-moves-list">
            {[0, 1, 2, 3].map((idx) => {
              const currentKey = attackerLive.moveKeys[idx];
              const currentMove = currentKey
                ? learnset.find((m) => m.move_key === currentKey)
                : null;
              return (
                <div key={idx} className="dt-move-row">
                  <span className="dt-move-idx">{idx + 1}</span>
                  <Autocomplete
                    value={currentKey ?? null}
                    displayName={
                      currentMove
                        ? `${currentMove.name}${currentMove.power ? ` (${currentMove.power})` : ""}`
                        : null
                    }
                    options={moveOptions.filter(
                      (o) => !moveAlreadySelected(idx, o.key),
                    )}
                    placeholder={
                      side.pokemonKey ? "技名を入力..." : "ポケモン未選択"
                    }
                    onSelect={(key) => setMove(idx, key)}
                    onClear={() => setMove(idx, null)}
                    disabled={!side.pokemonKey}
                    minQueryLength={0}
                    maxResults={20}
                    emptyLabel="該当する技がありません"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 状態異常 */}
      <div className="dt-section">
        <label className="dt-label">状態</label>
        <select
          value={side.status ?? "none"}
          onChange={(e) => {
            const v = e.target.value;
            setStatus(v === "none" ? null : (v as StatusKind));
          }}
          className="dt-select dt-select-wide"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function findNameByKey(
  names: Record<string, string>,
  key: string,
): string | null {
  for (const [name, k] of Object.entries(names)) {
    if (k === key) return name;
  }
  return null;
}
