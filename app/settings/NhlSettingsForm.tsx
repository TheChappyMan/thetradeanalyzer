"use client";

import React, { useMemo, useState } from "react";
import { saveLeagueSettings, saveNflLeagueSettings } from "./actions";
import {
  DEFAULT_LEAGUE,
  GOALIE_STATS,
  SKATER_STATS,
} from "@/lib/types";
import type {
  CategoryConfig,
  GoalieStatKey,
  League,
  LeagueRow,
  RosterKey,
  SkaterStatKey,
} from "@/lib/types";
import {
  DEFAULT_NFL_LEAGUE,
  type NflLeague,
  type NflScoringWeights,
  type NflRoster,
} from "@/lib/nfl-types";

// ============================================================
// NFL scoring weight helpers
// ============================================================

type NflWeightKey = keyof NflScoringWeights;

const NFL_WEIGHT_GROUPS: { heading: string; keys: NflWeightKey[] }[] = [
  { heading: "Passing",    keys: ["passYds", "passTDs", "passInt"] },
  { heading: "Rushing",    keys: ["rushYds", "rushTDs"] },
  { heading: "Receiving",  keys: ["rec", "recYds", "recTDs"] },
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
  rushYds:          "Rush Yds (per yd)",
  rushTDs:          "Rush TDs",
  rec:              "Reception",
  recYds:           "Rec Yds (per yd)",
  recTDs:           "Rec TDs",
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

// ============================================================
// Helpers
// ============================================================

function mergeLeague(saved: League): League {
  return {
    ...DEFAULT_LEAGUE,
    ...saved,
    roster:           { ...DEFAULT_LEAGUE.roster,           ...saved.roster },
    skaterWeights:    { ...DEFAULT_LEAGUE.skaterWeights,    ...saved.skaterWeights },
    goalieWeights:    { ...DEFAULT_LEAGUE.goalieWeights,    ...saved.goalieWeights },
    skaterCategories: { ...DEFAULT_LEAGUE.skaterCategories, ...saved.skaterCategories },
    goalieCategories: { ...DEFAULT_LEAGUE.goalieCategories, ...saved.goalieCategories },
  };
}

function mergeNflLeague(saved: NflLeague): NflLeague {
  return {
    ...DEFAULT_NFL_LEAGUE,
    ...saved,
    roster:         { ...DEFAULT_NFL_LEAGUE.roster,         ...saved.roster },
    scoringWeights: { ...DEFAULT_NFL_LEAGUE.scoringWeights, ...saved.scoringWeights },
  };
}

// ============================================================
// Props and types
// ============================================================

type Props = {
  initialLeague:    League    | null;
  initialNflLeague: NflLeague | null;
  tier:             string;
  allNhlLeagues:    LeagueRow[];
  allNflLeagues:    LeagueRow[];
};

type Tab        = "nhl" | "nfl";
type SaveStatus = "idle" | "saving" | "saved" | "error";

// ============================================================
// Component
// ============================================================

export default function NhlSettingsForm({
  initialLeague,
  initialNflLeague,
  tier,
  allNhlLeagues: initialNhlLeagues,
  allNflLeagues: initialNflLeagues,
}: Props) {
  const isTier2 = tier === "tier2";

  const [activeTab, setActiveTab] = useState<Tab>("nhl");

  // ── Tier 2 league lists ───────────────────────────────────
  const [nhlLeagues, setNhlLeagues] = useState<LeagueRow[]>(initialNhlLeagues);
  const [nflLeagues, setNflLeagues] = useState<LeagueRow[]>(initialNflLeagues);
  const [selectedNhlId, setSelectedNhlId] = useState<string | null>(
    initialNhlLeagues[0]?.id ?? null
  );
  const [selectedNflId, setSelectedNflId] = useState<string | null>(
    initialNflLeagues[0]?.id ?? null
  );
  const [creatingNhl, setCreatingNhl] = useState(false);
  const [creatingNfl, setCreatingNfl] = useState(false);

  // ── NHL state ─────────────────────────────────────────────
  const [league, setLeague] = useState<League>(() =>
    initialLeague ? mergeLeague(initialLeague) : DEFAULT_LEAGUE
  );
  const [nhlIsNew,     setNhlIsNew]     = useState(initialLeague === null);
  const [nhlStatus,    setNhlStatus]    = useState<SaveStatus>("idle");
  const [nhlSaveError, setNhlSaveError] = useState<string | null>(null);

  // ── NFL state ─────────────────────────────────────────────
  const [nflLeague, setNflLeague] = useState<NflLeague>(() =>
    initialNflLeague ? mergeNflLeague(initialNflLeague) : DEFAULT_NFL_LEAGUE
  );
  const [nflIsNew,     setNflIsNew]     = useState(initialNflLeague === null);
  const [nflStatus,    setNflStatus]    = useState<SaveStatus>("idle");
  const [nflSaveError, setNflSaveError] = useState<string | null>(null);

  // ── Derived ───────────────────────────────────────────────
  const isCatMode = league.scoringType === "categories";

  const totalNhlRosterSize = useMemo(
    () => Object.values(league.roster).reduce((a, b) => a + b, 0),
    [league.roster]
  );
  const totalNflRosterSize = useMemo(
    () => Object.values(nflLeague.roster).reduce((a, b) => a + b, 0),
    [nflLeague.roster]
  );

  // ── NHL updaters ──────────────────────────────────────────
  const updateLeague         = (patch: Partial<League>) => setLeague((p) => ({ ...p, ...patch }));
  const updateRoster         = (pos: RosterKey, val: number) =>
    setLeague((p) => ({ ...p, roster: { ...p.roster, [pos]: val } }));
  const updateSkaterWeight   = (stat: SkaterStatKey, val: number) =>
    setLeague((p) => ({ ...p, skaterWeights: { ...p.skaterWeights, [stat]: val } }));
  const updateGoalieWeight   = (stat: GoalieStatKey, val: number) =>
    setLeague((p) => ({ ...p, goalieWeights: { ...p.goalieWeights, [stat]: val } }));
  const updateSkaterCategory = (stat: SkaterStatKey, cfg: CategoryConfig | null) =>
    setLeague((p) => ({ ...p, skaterCategories: { ...p.skaterCategories, [stat]: cfg } }));
  const updateGoalieCategory = (stat: GoalieStatKey, cfg: CategoryConfig | null) =>
    setLeague((p) => ({ ...p, goalieCategories: { ...p.goalieCategories, [stat]: cfg } }));

  // ── NFL updaters ──────────────────────────────────────────
  const updateNflLeague    = (patch: Partial<NflLeague>) => setNflLeague((p) => ({ ...p, ...patch }));
  const updateNflRoster    = (pos: keyof NflRoster, val: number) =>
    setNflLeague((p) => ({ ...p, roster: { ...p.roster, [pos]: val } }));
  const updateNflWeight    = (key: NflWeightKey, val: number) =>
    setNflLeague((p) => ({ ...p, scoringWeights: { ...p.scoringWeights, [key]: val } }));
  const updateNflPprFormat = (pprFormat: "standard" | "half" | "full") => {
    const rec = pprFormat === "standard" ? 0 : pprFormat === "half" ? 0.5 : 1.0;
    setNflLeague((p) => ({ ...p, pprFormat, scoringWeights: { ...p.scoringWeights, rec } }));
  };

  // ── Tier 2: switch NHL league ─────────────────────────────
  function handleNhlLeagueChange(id: string) {
    setSelectedNhlId(id);
    const row = nhlLeagues.find((r) => r.id === id);
    if (row?.settings) setLeague(mergeLeague(row.settings as League));
    else setLeague(DEFAULT_LEAGUE);
  }

  // ── Tier 2: switch NFL league ─────────────────────────────
  function handleNflLeagueChange(id: string) {
    setSelectedNflId(id);
    const row = nflLeagues.find((r) => r.id === id);
    if (row?.settings) setNflLeague(mergeNflLeague(row.settings as NflLeague));
    else setNflLeague(DEFAULT_NFL_LEAGUE);
  }

  // ── Tier 2: create new NHL league ────────────────────────
  async function handleCreateNhlLeague() {
    setCreatingNhl(true);
    const res = await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport: "nhl", name: "New League", settings: DEFAULT_LEAGUE }),
    });
    if (res.ok) {
      const json = await res.json();
      const newRow = json.data as LeagueRow;
      setNhlLeagues((prev) => [newRow, ...prev]);
      setSelectedNhlId(newRow.id);
      setLeague(DEFAULT_LEAGUE);
      setNhlIsNew(false);
    }
    setCreatingNhl(false);
  }

  // ── Tier 2: create new NFL league ────────────────────────
  async function handleCreateNflLeague() {
    setCreatingNfl(true);
    const res = await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport: "nfl", name: "New League", settings: DEFAULT_NFL_LEAGUE }),
    });
    if (res.ok) {
      const json = await res.json();
      const newRow = json.data as LeagueRow;
      setNflLeagues((prev) => [newRow, ...prev]);
      setSelectedNflId(newRow.id);
      setNflLeague(DEFAULT_NFL_LEAGUE);
      setNflIsNew(false);
    }
    setCreatingNfl(false);
  }

  // ── Save handlers ─────────────────────────────────────────
  async function handleNhlSave() {
    setNhlStatus("saving");
    setNhlSaveError(null);

    if (isTier2 && selectedNhlId) {
      // Update the specific league row via PUT
      const res = await fetch("/api/leagues", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedNhlId,
          name: league.name || "My NHL League",
          settings: league,
        }),
      });
      if (res.ok) {
        setNhlIsNew(false);
        setNhlStatus("saved");
        // Sync name in local league list
        setNhlLeagues((prev) =>
          prev.map((l) =>
            l.id === selectedNhlId ? { ...l, name: league.name || "My NHL League" } : l
          )
        );
        setTimeout(() => setNhlStatus("idle"), 2000);
      } else {
        setNhlStatus("error");
        setNhlSaveError("Save failed");
      }
      return;
    }

    // Tier 1: server action upsert
    const result = await saveLeagueSettings(league);
    if (result.success) {
      setNhlIsNew(false);
      setNhlStatus("saved");
      setTimeout(() => setNhlStatus("idle"), 2000);
    } else {
      setNhlStatus("error");
      setNhlSaveError(result.error ?? "Unknown error");
    }
  }

  async function handleNflSave() {
    setNflStatus("saving");
    setNflSaveError(null);

    if (isTier2 && selectedNflId) {
      const res = await fetch("/api/leagues", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedNflId,
          name: nflLeague.name || "My NFL League",
          settings: nflLeague,
        }),
      });
      if (res.ok) {
        setNflIsNew(false);
        setNflStatus("saved");
        setNflLeagues((prev) =>
          prev.map((l) =>
            l.id === selectedNflId ? { ...l, name: nflLeague.name || "My NFL League" } : l
          )
        );
        setTimeout(() => setNflStatus("idle"), 2000);
      } else {
        setNflStatus("error");
        setNflSaveError("Save failed");
      }
      return;
    }

    const result = await saveNflLeagueSettings(nflLeague);
    if (result.success) {
      setNflIsNew(false);
      setNflStatus("saved");
      setTimeout(() => setNflStatus("idle"), 2000);
    } else {
      setNflStatus("error");
      setNflSaveError(result.error ?? "Unknown error");
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <a href="/" className="text-xs text-blue-600 hover:underline">
            ← Back to Dashboard
          </a>
        </div>

        {activeTab === "nhl" && (
          <div className="flex items-center gap-3">
            {nhlStatus === "saved" && <span className="text-xs text-green-600">✓ Saved!</span>}
            {nhlStatus === "error" && <span className="text-xs text-red-600">{nhlSaveError}</span>}
            <button
              className="text-sm bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleNhlSave}
              disabled={nhlStatus === "saving"}
            >
              {nhlStatus === "saving" ? "Saving…" : nhlIsNew ? "Create League" : "Save Settings"}
            </button>
          </div>
        )}

        {activeTab === "nfl" && (
          <div className="flex items-center gap-3">
            {nflStatus === "saved" && <span className="text-xs text-green-600">✓ Saved!</span>}
            {nflStatus === "error" && <span className="text-xs text-red-600">{nflSaveError}</span>}
            <button
              className="text-sm bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleNflSave}
              disabled={nflStatus === "saving"}
            >
              {nflStatus === "saving" ? "Saving…" : nflIsNew ? "Create League" : "Save Settings"}
            </button>
          </div>
        )}
      </div>

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 border-b">
        {(["nhl", "nfl"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── NHL tab ─────────────────────────────────────────── */}
      {activeTab === "nhl" && (
        <>
          {/* Tier 2: league selector */}
          {isTier2 && (
            <div className="flex items-center gap-3 mb-5 p-3 bg-gray-50 rounded-xl border">
              <label className="text-sm text-gray-600 shrink-0">League:</label>
              {nhlLeagues.length > 0 ? (
                <select
                  className="border rounded-xl px-3 py-1.5 text-sm flex-1 max-w-xs"
                  value={selectedNhlId ?? ""}
                  onChange={(e) => handleNhlLeagueChange(e.target.value)}
                >
                  {nhlLeagues.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-gray-400 italic">No leagues yet</span>
              )}
              <button
                onClick={handleCreateNhlLeague}
                disabled={creatingNhl}
                className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap"
              >
                {creatingNhl ? "Creating…" : "+ New League"}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* League Settings */}
            <div className="border rounded-2xl p-4">
              <h2 className="font-medium mb-2">League Settings</h2>

              <label className="text-sm">League Name (optional)</label>
              <input
                type="text"
                className="border rounded-xl p-2 w-full mb-2"
                value={league.name}
                onChange={(e) => updateLeague({ name: e.target.value })}
              />

              <label className="text-sm">Number of Teams</label>
              <input
                type="number" min={2}
                className="border rounded-xl p-2 w-full mb-2"
                value={league.teams}
                onChange={(e) => updateLeague({ teams: parseInt(e.target.value || "12", 10) })}
              />

              <label className="text-sm">League Type</label>
              <select
                className="border rounded-xl p-2 w-full mb-2"
                value={league.leagueType}
                onChange={(e) => updateLeague({ leagueType: e.target.value as "redraft" | "keeper" })}
              >
                <option value="redraft">Redraft</option>
                <option value="keeper">Keeper</option>
              </select>

              {league.leagueType === "keeper" && (
                <>
                  <label className="text-sm">Keepers per Team</label>
                  <input
                    type="number" min={0}
                    className="border rounded-xl p-2 w-full mb-2"
                    value={league.keepersPerTeam}
                    onChange={(e) => updateLeague({ keepersPerTeam: parseInt(e.target.value || "0", 10) })}
                  />
                </>
              )}

              <h3 className="text-sm font-semibold mt-3 mb-2">Roster Slots</h3>
              <p className="text-xs text-gray-600 mb-2">
                Use whichever forward slots your league has; set unused to 0.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(league.roster) as RosterKey[]).map((pos) => (
                  <label key={pos} className="text-xs flex items-center gap-2">
                    <span className="w-12">{pos === "IRplus" ? "IR+" : pos}</span>
                    <input
                      type="number" min={0}
                      className="border rounded-xl p-1 w-full"
                      value={league.roster[pos]}
                      onChange={(e) => updateRoster(pos, parseInt(e.target.value || "0", 10))}
                    />
                  </label>
                ))}
              </div>
              <div className="text-xs text-gray-600 mt-2">
                Total roster size: <span className="font-semibold">{totalNhlRosterSize}</span>
              </div>
            </div>

            {/* Scoring */}
            <div className="border rounded-2xl p-4">
              <h2 className="font-medium mb-2">Scoring</h2>

              <label className="text-sm">Scoring Type</label>
              <select
                className="border rounded-xl p-2 w-full mb-3"
                value={league.scoringType}
                onChange={(e) => updateLeague({ scoringType: e.target.value as "points" | "categories" })}
              >
                <option value="points">Points</option>
                <option value="categories">Categories</option>
              </select>

              {!isCatMode ? (
                <>
                  <p className="text-xs text-gray-600 mb-2">
                    If your league scores both G+A and P, you&apos;re counting goals twice. Set G/A to 0
                    if you only score P, or leave P at 0 if you score G and A separately.
                  </p>
                  <h3 className="text-sm font-semibold mt-1 mb-1">Skaters</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
                    {SKATER_STATS.map((stat) => (
                      <div key={stat} className="flex items-center justify-between gap-2">
                        <label className="text-sm w-16">
                          {stat === "PM" ? "+/-" : stat}
                        </label>
                        <input
                          type="number" step="0.1"
                          className="border rounded-xl p-1 w-full"
                          value={league.skaterWeights[stat]}
                          onChange={(e) => updateSkaterWeight(stat, parseFloat(e.target.value || "0"))}
                        />
                      </div>
                    ))}
                  </div>
                  <h3 className="text-sm font-semibold mt-2 mb-1">Goalies</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {GOALIE_STATS.map((stat) => (
                      <div key={stat} className="flex items-center justify-between gap-2">
                        <label className="text-sm w-16">{stat}</label>
                        <input
                          type="number" step="0.1"
                          className="border rounded-xl p-1 w-full"
                          value={league.goalieWeights[stat]}
                          onChange={(e) => updateGoalieWeight(stat, parseFloat(e.target.value || "0"))}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-600 mb-3">
                    Check each category your league uses. Set direction to &ldquo;less&rdquo; for
                    stats where lower is better (PIM, GAA, L, GA).
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Skaters</h3>
                      <div className="space-y-1">
                        {SKATER_STATS.map((stat) => {
                          const cfg = league.skaterCategories[stat];
                          const label = stat === "PM" ? "+/-" : stat;
                          return (
                            <div key={stat} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                id={`scat-${stat}`}
                                checked={cfg !== null}
                                onChange={(e) =>
                                  updateSkaterCategory(stat, e.target.checked ? { direction: "more" } : null)
                                }
                              />
                              <label htmlFor={`scat-${stat}`} className="w-10 cursor-pointer">{label}</label>
                              {cfg && (
                                <div className="flex rounded-lg border overflow-hidden text-xs">
                                  <button
                                    className={`px-1.5 py-0.5 ${cfg.direction === "more" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                    onClick={() => updateSkaterCategory(stat, { direction: "more" })}
                                  >+</button>
                                  <button
                                    className={`px-1.5 py-0.5 ${cfg.direction === "less" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                    onClick={() => updateSkaterCategory(stat, { direction: "less" })}
                                  >−</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Goalies</h3>
                      <div className="space-y-1">
                        {GOALIE_STATS.map((stat) => {
                          const cfg = league.goalieCategories[stat];
                          return (
                            <div key={stat} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                id={`gcat-${stat}`}
                                checked={cfg !== null}
                                onChange={(e) =>
                                  updateGoalieCategory(stat, e.target.checked ? { direction: "more" } : null)
                                }
                              />
                              <label htmlFor={`gcat-${stat}`} className="w-10 cursor-pointer">{stat}</label>
                              {cfg && (
                                <div className="flex rounded-lg border overflow-hidden text-xs">
                                  <button
                                    className={`px-1.5 py-0.5 ${cfg.direction === "more" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                    onClick={() => updateGoalieCategory(stat, { direction: "more" })}
                                  >+</button>
                                  <button
                                    className={`px-1.5 py-0.5 ${cfg.direction === "less" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                    onClick={() => updateGoalieCategory(stat, { direction: "less" })}
                                  >−</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── NFL tab ─────────────────────────────────────────── */}
      {activeTab === "nfl" && (
        <>
          {/* Tier 2: league selector */}
          {isTier2 && (
            <div className="flex items-center gap-3 mb-5 p-3 bg-gray-50 rounded-xl border">
              <label className="text-sm text-gray-600 shrink-0">League:</label>
              {nflLeagues.length > 0 ? (
                <select
                  className="border rounded-xl px-3 py-1.5 text-sm flex-1 max-w-xs"
                  value={selectedNflId ?? ""}
                  onChange={(e) => handleNflLeagueChange(e.target.value)}
                >
                  {nflLeagues.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-gray-400 italic">No leagues yet</span>
              )}
              <button
                onClick={handleCreateNflLeague}
                disabled={creatingNfl}
                className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap"
              >
                {creatingNfl ? "Creating…" : "+ New League"}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* NFL League Settings */}
            <div className="border rounded-2xl p-4">
              <h2 className="font-medium mb-2">League Settings</h2>

              <label className="text-sm">League Name (optional)</label>
              <input
                type="text"
                className="border rounded-xl p-2 w-full mb-2"
                value={nflLeague.name}
                onChange={(e) => updateNflLeague({ name: e.target.value })}
              />

              <label className="text-sm">Number of Teams</label>
              <input
                type="number" min={2}
                className="border rounded-xl p-2 w-full mb-2"
                value={nflLeague.teams}
                onChange={(e) => updateNflLeague({ teams: parseInt(e.target.value || "12", 10) })}
              />

              <label className="text-sm">League Type</label>
              <select
                className="border rounded-xl p-2 w-full mb-2"
                value={nflLeague.leagueType}
                onChange={(e) => updateNflLeague({ leagueType: e.target.value as "redraft" | "keeper" })}
              >
                <option value="redraft">Redraft</option>
                <option value="keeper">Keeper</option>
              </select>

              {nflLeague.leagueType === "keeper" && (
                <>
                  <label className="text-sm">Keepers per Team</label>
                  <input
                    type="number" min={0}
                    className="border rounded-xl p-2 w-full mb-2"
                    value={nflLeague.keepersPerTeam}
                    onChange={(e) => updateNflLeague({ keepersPerTeam: parseInt(e.target.value || "0", 10) })}
                  />
                </>
              )}

              <label className="text-sm">QB Format</label>
              <select
                className="border rounded-xl p-2 w-full mb-2"
                value={nflLeague.qbFormat}
                onChange={(e) => updateNflLeague({ qbFormat: e.target.value as "1QB" | "2QB" })}
              >
                <option value="1QB">1QB</option>
                <option value="2QB">2QB / Superflex</option>
              </select>

              <label className="text-sm">PPR Format</label>
              <select
                className="border rounded-xl p-2 w-full mb-2"
                value={nflLeague.pprFormat}
                onChange={(e) => updateNflPprFormat(e.target.value as "standard" | "half" | "full")}
              >
                <option value="standard">Standard (non-PPR)</option>
                <option value="half">Half PPR (0.5)</option>
                <option value="full">Full PPR (1.0)</option>
              </select>

              <h3 className="text-sm font-semibold mt-3 mb-2">Roster Slots</h3>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(nflLeague.roster) as (keyof NflRoster)[]).map((pos) => (
                  <label key={pos} className="text-xs flex items-center gap-2">
                    <span className="w-12">{pos}</span>
                    <input
                      type="number" min={0}
                      className="border rounded-xl p-1 w-full"
                      value={nflLeague.roster[pos]}
                      onChange={(e) => updateNflRoster(pos, parseInt(e.target.value || "0", 10))}
                    />
                  </label>
                ))}
              </div>
              <div className="text-xs text-gray-600 mt-2">
                Total roster size: <span className="font-semibold">{totalNflRosterSize}</span>
              </div>
            </div>

            {/* NFL Scoring Weights */}
            <div className="border rounded-2xl p-4">
              <h2 className="font-medium mb-2">Scoring Weights</h2>
              <p className="text-xs text-gray-600 mb-3">
                Changing PPR Format above auto-updates the Reception weight.
                Adjust any weight to match your league exactly.
              </p>
              {NFL_WEIGHT_GROUPS.map(({ heading, keys }) => (
                <div key={heading} className="mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    {heading}
                  </h3>
                  <div className="grid grid-cols-1 gap-y-1">
                    {keys.map((key) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <label className="text-xs text-gray-700 flex-1">
                          {NFL_WEIGHT_LABELS[key]}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          className="border rounded-xl p-1 w-20 text-sm"
                          value={nflLeague.scoringWeights[key]}
                          onChange={(e) => updateNflWeight(key, parseFloat(e.target.value || "0"))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
