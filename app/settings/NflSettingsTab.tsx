"use client";

import React from "react";
import DraftPicksEditor from "@/app/components/DraftPicksEditor";
import NflYardBonusRows from "@/app/components/NflYardBonusRows";
import { NFL_WEIGHT_DESCRIPTIONS } from "@/lib/stat-descriptions";
import {
  DEFAULT_NFL_LEAGUE,
  type NflLeague,
  type NflRoster,
  type NflScoringWeights,
  type NflYardBonusCategory,
} from "@/lib/nfl-types";
import { FieldLabel, LeagueBasicsFields, RosterSlots, WeightRow } from "./shared";

type NflWeightKey = keyof NflScoringWeights;

const NFL_WEIGHT_GROUPS: { heading: string; keys: NflWeightKey[]; bonusCat?: NflYardBonusCategory }[] = [
  { heading: "Passing",    keys: ["passYds", "passTDs", "passInt", "pass2pt"], bonusCat: "pass" },
  { heading: "Rushing",    keys: ["rushYds", "rushTDs", "rushAtt", "rush2pt"], bonusCat: "rush" },
  { heading: "Receiving",  keys: ["rec", "recYds", "recTDs", "rec2pt"], bonusCat: "rec" },
  { heading: "Misc",       keys: ["fumblesLost"] },
  { heading: "Kicker",     keys: ["fgMade0to39", "fgMade40to49", "fgMade50plus", "fgMissed", "patMade", "patMissed"] },
  { heading: "DST Counting", keys: ["sacks", "ints", "fumbRec", "defTDs"] },
  { heading: "DST Pts Allowed", keys: [
    "ptsAllowed0", "ptsAllowed1to6", "ptsAllowed7to13",
    "ptsAllowed14to20", "ptsAllowed21to27", "ptsAllowed28to34", "ptsAllowed35plus",
  ]},
];

const NFL_WEIGHT_LABELS: Record<NflWeightKey, string> = {
  passYds:          "Pass Yds (per yd)",
  passTDs:          "Pass TDs",
  passInt:          "Pass INTs",
  pass2pt:          "2-Pt Conversions (Pass)",
  rushYds:          "Rush Yds (per yd)",
  rushTDs:          "Rush TDs",
  rushAtt:          "Rush Attempts (per carry)",
  rush2pt:          "2-Pt Conversions (Rush)",
  rec:              "Reception",
  recYds:           "Rec Yds (per yd)",
  recTDs:           "Rec TDs",
  rec2pt:           "2-Pt Conversions (Rec)",
  // Yard-bonus keys are edited via the dropdown rows (NflYardBonusRows),
  // not rendered from the generic groups; labels exist for type completeness.
  bonusPassYd100:   "100+ Pass Yds Game",
  bonusPassYd150:   "150+ Pass Yds Game",
  bonusPassYd200:   "200+ Pass Yds Game",
  bonusPassYd250:   "250+ Pass Yds Game",
  bonusPassYd300:   "300+ Pass Yds Game",
  bonusRushYd100:   "100+ Rush Yds Game",
  bonusRushYd150:   "150+ Rush Yds Game",
  bonusRushYd200:   "200+ Rush Yds Game",
  bonusRushYd250:   "250+ Rush Yds Game",
  bonusRushYd300:   "300+ Rush Yds Game",
  bonusRecYd100:    "100+ Rec Yds Game",
  bonusRecYd150:    "150+ Rec Yds Game",
  bonusRecYd200:    "200+ Rec Yds Game",
  bonusRecYd250:    "250+ Rec Yds Game",
  bonusRecYd300:    "300+ Rec Yds Game",
  fumblesLost:      "Fumbles Lost",
  fgMade0to39:      "FG 0–39 yds",
  fgMade40to49:     "FG 40–49 yds",
  fgMade50plus:     "FG 50+ yds",
  fgMissed:         "FG Missed",
  patMade:          "PAT Made",
  patMissed:        "PAT Missed",
  sacks:            "Sacks",
  ints:             "DEF INTs",
  fumbRec:          "Fumble Rec",
  defTDs:           "DEF/ST TDs",
  ptsAllowed0:      "Pts Allowed: 0",
  ptsAllowed1to6:   "Pts Allowed: 1–6",
  ptsAllowed7to13:  "Pts Allowed: 7–13",
  ptsAllowed14to20: "Pts Allowed: 14–20",
  ptsAllowed21to27: "Pts Allowed: 21–27",
  ptsAllowed28to34: "Pts Allowed: 28–34",
  ptsAllowed35plus: "Pts Allowed: 35+",
};

/** Fills fields missing from older saved NFL settings with defaults. */
export function mergeNflLeague(saved: NflLeague): NflLeague {
  return {
    ...DEFAULT_NFL_LEAGUE,
    ...saved,
    roster:         { ...DEFAULT_NFL_LEAGUE.roster,         ...saved.roster },
    scoringWeights: { ...DEFAULT_NFL_LEAGUE.scoringWeights, ...saved.scoringWeights },
  };
}

export default function NflSettingsTab({
  league, setLeague, selectedId,
}: {
  league: NflLeague;
  setLeague: React.Dispatch<React.SetStateAction<NflLeague>>;
  /** Selected saved league; resets the yard-bonus dropdowns when it changes. */
  selectedId: string | null;
}) {
  const updateLeague    = (patch: Partial<NflLeague>) => setLeague((p) => ({ ...p, ...patch }));
  const updateRoster    = (pos: keyof NflRoster, val: number) =>
    setLeague((p) => ({ ...p, roster: { ...p.roster, [pos]: val } }));
  const updateWeight    = (key: NflWeightKey, val: number) =>
    setLeague((p) => ({ ...p, scoringWeights: { ...p.scoringWeights, [key]: val } }));
  const updatePprFormat = (pprFormat: "standard" | "half" | "full") => {
    const rec = pprFormat === "standard" ? 0 : pprFormat === "half" ? 0.5 : 1.0;
    setLeague((p) => ({ ...p, pprFormat, scoringWeights: { ...p.scoringWeights, rec } }));
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* NFL League Settings */}
        <div className="card">
          <h2 className="font-medium mb-3" style={{ color: "var(--color-text)" }}>
            League Settings
          </h2>

          <LeagueBasicsFields league={league} onChange={updateLeague} />

          <FieldLabel>QB Format</FieldLabel>
          <select
            className="form-input mb-3"
            value={league.qbFormat}
            onChange={(e) => updateLeague({ qbFormat: e.target.value as "1QB" | "2QB" })}
          >
            <option value="1QB">1QB</option>
            <option value="2QB">2QB / Superflex</option>
          </select>

          <FieldLabel>PPR Format</FieldLabel>
          <select
            className="form-input mb-3"
            value={league.pprFormat}
            onChange={(e) => updatePprFormat(e.target.value as "standard" | "half" | "full")}
          >
            <option value="standard">Standard (non-PPR)</option>
            <option value="half">Half PPR (0.5)</option>
            <option value="full">Full PPR (1.0)</option>
          </select>

          <RosterSlots roster={league.roster} onChange={updateRoster} />
        </div>

        {/* NFL Scoring Weights */}
        <div className="card">
          <h2 className="font-medium mb-3" style={{ color: "var(--color-text)" }}>
            Scoring Weights
          </h2>
          <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
            Changing PPR Format above auto-updates the Reception weight.
            Adjust any weight to match your league exactly.
          </p>
          {NFL_WEIGHT_GROUPS.map(({ heading, keys, bonusCat }) => (
            <div key={heading} className="mb-3">
              <h3
                className="text-sm font-semibold mt-2 mb-1"
                style={{ color: "var(--color-text)" }}
              >
                {heading}
              </h3>
              <div className="grid grid-cols-1 gap-y-1">
                {keys.map((key) => (
                  <WeightRow
                    key={key}
                    label={NFL_WEIGHT_LABELS[key]}
                    help={NFL_WEIGHT_DESCRIPTIONS[key]}
                    value={league.scoringWeights[key]}
                    onCommit={(n) => updateWeight(key, n)}
                    labelClassName="text-xs flex-1 flex items-center gap-1"
                    inputClassName="form-input w-20 p-1 text-sm"
                  />
                ))}
                {bonusCat && (
                  <NflYardBonusRows
                    category={bonusCat}
                    weights={league.scoringWeights}
                    onChange={updateWeight}
                    resetKey={selectedId}
                  />
                )}
              </div>
            </div>
          ))}
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
