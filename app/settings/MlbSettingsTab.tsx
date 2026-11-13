"use client";

import React from "react";
import { MLB_HITTER_DESCRIPTIONS, MLB_PITCHER_DESCRIPTIONS } from "@/lib/stat-descriptions";
import type { CategoryConfig } from "@/lib/types";
import {
  DEFAULT_MLB_LEAGUE,
  HITTER_STATS,
  PITCHER_STATS,
  presetForFormat,
  type HitterStatKey,
  type LeagueFormat,
  type MlbLeague,
  type MlbRosterKey,
  type PitcherStatKey,
} from "@/lib/mlb-types";
import { CategoryList, FieldLabel, LeagueBasicsFields, RosterSlots, WeightList } from "./shared";

/** Fills fields missing from older saved MLB settings with defaults. */
export function mergeMlbLeague(saved: MlbLeague): MlbLeague {
  return {
    ...DEFAULT_MLB_LEAGUE,
    ...saved,
    roster:            { ...DEFAULT_MLB_LEAGUE.roster,            ...saved.roster },
    hitterWeights:     { ...DEFAULT_MLB_LEAGUE.hitterWeights,     ...saved.hitterWeights },
    pitcherWeights:    { ...DEFAULT_MLB_LEAGUE.pitcherWeights,    ...saved.pitcherWeights },
    hitterCategories:  { ...DEFAULT_MLB_LEAGUE.hitterCategories,  ...saved.hitterCategories },
    pitcherCategories: { ...DEFAULT_MLB_LEAGUE.pitcherCategories, ...saved.pitcherCategories },
  };
}

export default function MlbSettingsTab({
  league, setLeague,
}: {
  league: MlbLeague;
  setLeague: React.Dispatch<React.SetStateAction<MlbLeague>>;
}) {
  const isCatMode = league.format !== "points";

  const updateLeague = (patch: Partial<MlbLeague>) => setLeague((p) => ({ ...p, ...patch }));
  const updateRoster = (pos: MlbRosterKey, val: number) =>
    setLeague((p) => ({ ...p, roster: { ...p.roster, [pos]: val } }));
  const updateHitterWeight = (stat: HitterStatKey, val: number) =>
    setLeague((p) => ({ ...p, hitterWeights: { ...p.hitterWeights, [stat]: val } }));
  const updatePitcherWeight = (stat: PitcherStatKey, val: number) =>
    setLeague((p) => ({ ...p, pitcherWeights: { ...p.pitcherWeights, [stat]: val } }));
  const updateHitterCategory = (stat: HitterStatKey, cfg: CategoryConfig | null) =>
    setLeague((p) => ({ ...p, hitterCategories: { ...p.hitterCategories, [stat]: cfg } }));
  const updatePitcherCategory = (stat: PitcherStatKey, cfg: CategoryConfig | null) =>
    setLeague((p) => ({ ...p, pitcherCategories: { ...p.pitcherCategories, [stat]: cfg } }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

      {/* MLB League Settings */}
      <div className="card">
        <h2 className="font-medium mb-3" style={{ color: "var(--color-text)" }}>League Settings</h2>

        <LeagueBasicsFields league={league} onChange={updateLeague} />

        <FieldLabel>League Format</FieldLabel>
        <div
          className="flex rounded-xl border overflow-hidden mb-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          {(["5x5", "obp", "points"] as LeagueFormat[]).map((fmt) => (
            <button
              key={fmt}
              className="flex-1 text-sm py-1.5 transition-colors"
              style={league.format === fmt
                ? { background: "var(--color-primary)", color: "#fff" }
                : { color: "var(--color-muted)" }}
              onClick={() => {
                const preset = presetForFormat(fmt);
                updateLeague({ format: fmt, ...preset });
              }}
            >
              {fmt === "5x5" ? "5×5 Roto" : fmt === "obp" ? "OBP Roto" : "Points"}
            </button>
          ))}
        </div>

        <RosterSlots roster={league.roster} onChange={updateRoster} />
      </div>

      {/* MLB Scoring */}
      <div className="card">
        <h2 className="font-medium mb-3" style={{ color: "var(--color-text)" }}>Scoring</h2>

        {isCatMode ? (
          <>
            <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
              Check each category your league uses. Set direction to &ldquo;less&rdquo; for
              stats where lower is better (ERA, WHIP, L).
            </p>
            <div className="grid grid-cols-2 gap-4">
              <CategoryList
                title="Hitters"
                stats={HITTER_STATS}
                categories={league.hitterCategories}
                descriptions={MLB_HITTER_DESCRIPTIONS}
                onChange={updateHitterCategory}
                idPrefix="hcat"
                labelWidth="w-10"
              />
              <CategoryList
                title="Pitchers"
                stats={PITCHER_STATS}
                categories={league.pitcherCategories}
                descriptions={MLB_PITCHER_DESCRIPTIONS}
                onChange={updatePitcherCategory}
                idPrefix="pcat"
                labelWidth="w-10"
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>
              Set each stat&apos;s point value to match your league exactly.
              Use negative values for stats like L, BB (pitchers), and HR9.
            </p>
            <h3 className="text-sm font-semibold mt-1 mb-1" style={{ color: "var(--color-text)" }}>Hitters</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
              <WeightList
                stats={HITTER_STATS}
                weights={league.hitterWeights}
                descriptions={MLB_HITTER_DESCRIPTIONS}
                onCommit={updateHitterWeight}
                labelWidth="w-12"
              />
            </div>
            <h3 className="text-sm font-semibold mt-2 mb-1" style={{ color: "var(--color-text)" }}>Pitchers</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <WeightList
                stats={PITCHER_STATS}
                weights={league.pitcherWeights}
                descriptions={MLB_PITCHER_DESCRIPTIONS}
                onCommit={updatePitcherWeight}
                labelWidth="w-12"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
