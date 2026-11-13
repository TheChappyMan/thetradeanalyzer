"use client";

import React from "react";
import DraftPicksEditor from "@/app/components/DraftPicksEditor";
import { NHL_SKATER_DESCRIPTIONS, NHL_GOALIE_DESCRIPTIONS } from "@/lib/stat-descriptions";
import { DEFAULT_LEAGUE, GOALIE_STATS, SKATER_STATS, emptyPositionBonuses } from "@/lib/types";
import type { CategoryConfig, GoalieStatKey, League, RosterKey, SkaterStatKey } from "@/lib/types";
import {
  CategoryList, FieldLabel, LeagueBasicsFields, RosterSlots, WeightList, WeightRow,
} from "./shared";

/** Fills fields missing from older saved NHL settings with defaults. */
export function mergeLeague(saved: League): League {
  return {
    ...DEFAULT_LEAGUE,
    ...saved,
    roster:           { ...DEFAULT_LEAGUE.roster,           ...saved.roster },
    skaterWeights:    { ...DEFAULT_LEAGUE.skaterWeights,    ...saved.skaterWeights },
    goalieWeights:    { ...DEFAULT_LEAGUE.goalieWeights,    ...saved.goalieWeights },
    skaterCategories: { ...DEFAULT_LEAGUE.skaterCategories, ...saved.skaterCategories },
    goalieCategories: { ...DEFAULT_LEAGUE.goalieCategories, ...saved.goalieCategories },
    positionBonuses:  saved.positionBonuses ?? emptyPositionBonuses(),
  };
}

const skaterLabel = (stat: SkaterStatKey) => (stat === "PM" ? "+/-" : stat);

export default function NhlSettingsTab({
  league, setLeague,
}: {
  league: League;
  setLeague: React.Dispatch<React.SetStateAction<League>>;
}) {
  const isCatMode = league.scoringType === "categories";

  const updateLeague         = (patch: Partial<League>) => setLeague((p) => ({ ...p, ...patch }));
  const updateRoster         = (pos: RosterKey, val: number) =>
    setLeague((p) => ({ ...p, roster: { ...p.roster, [pos]: val } }));
  const updateSkaterWeight   = (stat: SkaterStatKey, val: number) =>
    setLeague((p) => ({ ...p, skaterWeights: { ...p.skaterWeights, [stat]: val } }));
  const updateGoalieWeight   = (stat: GoalieStatKey, val: number) =>
    setLeague((p) => ({ ...p, goalieWeights: { ...p.goalieWeights, [stat]: val } }));
  const updatePositionBonus  = (grp: "forwards" | "defenders", stat: "G" | "A" | "P", val: number) =>
    setLeague((p) => {
      const pb = p.positionBonuses ?? emptyPositionBonuses();
      return { ...p, positionBonuses: { ...pb, [grp]: { ...pb[grp], [stat]: val } } };
    });
  const updateSkaterCategory = (stat: SkaterStatKey, cfg: CategoryConfig | null) =>
    setLeague((p) => ({ ...p, skaterCategories: { ...p.skaterCategories, [stat]: cfg } }));
  const updateGoalieCategory = (stat: GoalieStatKey, cfg: CategoryConfig | null) =>
    setLeague((p) => ({ ...p, goalieCategories: { ...p.goalieCategories, [stat]: cfg } }));

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* League Settings */}
        <div className="card">
          <h2 className="font-medium mb-3" style={{ color: "var(--color-text)" }}>
            League Settings
          </h2>

          <LeagueBasicsFields league={league} onChange={updateLeague} />

          <RosterSlots
            roster={league.roster}
            onChange={updateRoster}
            hint="Use whichever forward slots your league has; set unused to 0."
            labelFor={(pos) => (pos === "IRplus" ? "IR+" : pos)}
          />
        </div>

        {/* Scoring */}
        <div className="card">
          <h2 className="font-medium mb-3" style={{ color: "var(--color-text)" }}>
            Scoring
          </h2>

          <FieldLabel>Scoring Type</FieldLabel>
          <select
            className="form-input mb-3"
            value={league.scoringType}
            onChange={(e) => updateLeague({ scoringType: e.target.value as "points" | "categories" })}
          >
            <option value="points">Points</option>
            <option value="categories">Categories</option>
          </select>

          {!isCatMode ? (
            <>
              <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>
                If your league scores both G+A and P, you&apos;re counting goals twice. Set G/A to 0
                if you only score P, or leave P at 0 if you score G and A separately. Same idea for
                special teams: use STP only if your league scores special teams as a single stat,
                and leave PPP/SHP/PPG/PPA/SHG/SHA at 0.
              </p>
              <h3 className="text-sm font-semibold mt-1 mb-1" style={{ color: "var(--color-text)" }}>
                Skaters
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
                <WeightList
                  stats={SKATER_STATS}
                  weights={league.skaterWeights}
                  descriptions={NHL_SKATER_DESCRIPTIONS}
                  onCommit={updateSkaterWeight}
                  labelWidth="w-16"
                  labelFor={skaterLabel}
                />
              </div>
              <h3 className="text-sm font-semibold mt-2 mb-1" style={{ color: "var(--color-text)" }}>
                Goalies
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <WeightList
                  stats={GOALIE_STATS}
                  weights={league.goalieWeights}
                  descriptions={NHL_GOALIE_DESCRIPTIONS}
                  onCommit={updateGoalieWeight}
                  labelWidth="w-16"
                />
              </div>

              <h3 className="text-sm font-semibold mt-3 mb-1" style={{ color: "var(--color-text)" }}>
                Positional Bonus Points
              </h3>
              <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>
                If a position in your league gets extra points for goals, assists, or points
                (e.g. defensemen earn +1 per goal), enter the bonus here. It&apos;s added on top of
                the skater weights above. Leave at 0 if your league doesn&apos;t use positional bonuses.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {(["forwards", "defenders"] as const).map((grp) => (
                  <div key={grp}>
                    <h4 className="text-xs font-semibold mb-1" style={{ color: "var(--color-muted)" }}>
                      {grp === "forwards" ? "Forwards" : "Defenders"}
                    </h4>
                    <div className="space-y-1">
                      {(["G", "A", "P"] as const).map((stat) => (
                        <WeightRow
                          key={stat}
                          label={stat}
                          help={NHL_SKATER_DESCRIPTIONS[stat]}
                          value={league.positionBonuses?.[grp]?.[stat] ?? 0}
                          onCommit={(n) => updatePositionBonus(grp, stat, n)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                Check each category your league uses. If your league has both G+A and P as
                categories, you&apos;re counting goals twice — the same goes for STP alongside
                PPP/SHP or the individual special-teams stats. Set direction to &ldquo;less&rdquo; for
                stats where lower is better (PIM, GAA, L, GA).
              </p>
              <div className="grid grid-cols-2 gap-4">
                <CategoryList
                  title="Skaters"
                  stats={SKATER_STATS}
                  categories={league.skaterCategories}
                  descriptions={NHL_SKATER_DESCRIPTIONS}
                  onChange={updateSkaterCategory}
                  idPrefix="scat"
                  labelWidth="w-14"
                  labelFor={skaterLabel}
                />
                <CategoryList
                  title="Goalies"
                  stats={GOALIE_STATS}
                  categories={league.goalieCategories}
                  descriptions={NHL_GOALIE_DESCRIPTIONS}
                  onChange={updateGoalieCategory}
                  idPrefix="gcat"
                  labelWidth="w-14"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Draft Picks: used by Rankings Draft Mode */}
      <DraftPicksEditor
        value={league.draftPicks}
        defaultTeams={league.teams}
        roster={league.roster}
        onChange={(cfg) => updateLeague({ draftPicks: cfg })}
      />
    </>
  );
}
