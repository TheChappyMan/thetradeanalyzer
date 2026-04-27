"use client";

import React, { useMemo, useState } from "react";
import { saveLeagueSettings } from "./actions";
import {
  DEFAULT_LEAGUE,
  GOALIE_STATS,
  SKATER_STATS,
} from "@/lib/types";
import type {
  CategoryConfig,
  GoalieStatKey,
  League,
  RosterKey,
  SkaterStatKey,
} from "@/lib/types";

type Props = {
  initialLeague: League | null;
};

type Tab = "nhl" | "nfl";
type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function NhlSettingsForm({ initialLeague }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("nhl");

  // Merge saved settings over defaults to handle any fields added after
  // the league was first created.
  const [league, setLeague] = useState<League>(() =>
    initialLeague
      ? { ...DEFAULT_LEAGUE, ...initialLeague,
          roster: { ...DEFAULT_LEAGUE.roster, ...initialLeague.roster },
          skaterWeights: { ...DEFAULT_LEAGUE.skaterWeights, ...initialLeague.skaterWeights },
          goalieWeights: { ...DEFAULT_LEAGUE.goalieWeights, ...initialLeague.goalieWeights },
          skaterCategories: { ...DEFAULT_LEAGUE.skaterCategories, ...initialLeague.skaterCategories },
          goalieCategories: { ...DEFAULT_LEAGUE.goalieCategories, ...initialLeague.goalieCategories },
        }
      : DEFAULT_LEAGUE
  );

  // Track whether this is a new (not-yet-saved) league so the button
  // label switches to "Save Settings" after the first successful save.
  const [isNew, setIsNew] = useState(initialLeague === null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const isCatMode = league.scoringType === "categories";

  const totalRosterSize = useMemo(
    () => Object.values(league.roster).reduce((a, b) => a + b, 0),
    [league.roster]
  );

  // ── Updaters (mirror page.tsx patterns exactly) ──────────────
  const updateLeague = (patch: Partial<League>) =>
    setLeague((prev) => ({ ...prev, ...patch }));

  const updateRoster = (pos: RosterKey, val: number) =>
    setLeague((prev) => ({ ...prev, roster: { ...prev.roster, [pos]: val } }));

  const updateSkaterWeight = (stat: SkaterStatKey, val: number) =>
    setLeague((prev) => ({ ...prev, skaterWeights: { ...prev.skaterWeights, [stat]: val } }));

  const updateGoalieWeight = (stat: GoalieStatKey, val: number) =>
    setLeague((prev) => ({ ...prev, goalieWeights: { ...prev.goalieWeights, [stat]: val } }));

  const updateSkaterCategory = (stat: SkaterStatKey, cfg: CategoryConfig | null) =>
    setLeague((prev) => ({ ...prev, skaterCategories: { ...prev.skaterCategories, [stat]: cfg } }));

  const updateGoalieCategory = (stat: GoalieStatKey, cfg: CategoryConfig | null) =>
    setLeague((prev) => ({ ...prev, goalieCategories: { ...prev.goalieCategories, [stat]: cfg } }));

  // ── Save handler ─────────────────────────────────────────────
  async function handleSave() {
    setSaveStatus("saving");
    setSaveError(null);
    const result = await saveLeagueSettings(league);
    if (result.success) {
      setIsNew(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } else {
      setSaveStatus("error");
      setSaveError(result.error ?? "Unknown error");
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <a href="/" className="text-xs text-blue-600 hover:underline">
            ← Back to Analyzer
          </a>
        </div>

        {activeTab === "nhl" && (
          <div className="flex items-center gap-3">
            {saveStatus === "saved" && (
              <span className="text-xs text-green-600">✓ Saved!</span>
            )}
            {saveStatus === "error" && (
              <span className="text-xs text-red-600">{saveError}</span>
            )}
            <button
              className="text-sm bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSave}
              disabled={saveStatus === "saving"}
            >
              {saveStatus === "saving" ? "Saving…" : isNew ? "Create League" : "Save Settings"}
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

      {/* ── NFL tab ─────────────────────────────────────────── */}
      {activeTab === "nfl" && (
        <div className="border rounded-2xl p-8 text-center text-gray-500">
          <p className="text-base font-medium mb-1">NFL</p>
          <p className="text-sm">Coming Soon</p>
        </div>
      )}

      {/* ── NHL tab ─────────────────────────────────────────── */}
      {activeTab === "nhl" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* League Settings ─────────────────────────────── */}
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
              type="number"
              min={2}
              className="border rounded-xl p-2 w-full mb-2"
              value={league.teams}
              onChange={(e) =>
                updateLeague({ teams: parseInt(e.target.value || "12", 10) })
              }
            />

            <label className="text-sm">League Type</label>
            <select
              className="border rounded-xl p-2 w-full mb-2"
              value={league.leagueType}
              onChange={(e) =>
                updateLeague({ leagueType: e.target.value as "redraft" | "keeper" })
              }
            >
              <option value="redraft">Redraft</option>
              <option value="keeper">Keeper</option>
            </select>

            {league.leagueType === "keeper" && (
              <>
                <label className="text-sm">Keepers per Team</label>
                <input
                  type="number"
                  min={0}
                  className="border rounded-xl p-2 w-full mb-2"
                  value={league.keepersPerTeam}
                  onChange={(e) =>
                    updateLeague({ keepersPerTeam: parseInt(e.target.value || "0", 10) })
                  }
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
                    type="number"
                    min={0}
                    className="border rounded-xl p-1 w-full"
                    value={league.roster[pos]}
                    onChange={(e) =>
                      updateRoster(pos, parseInt(e.target.value || "0", 10))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="text-xs text-gray-600 mt-2">
              Total roster size:{" "}
              <span className="font-semibold">{totalRosterSize}</span>
            </div>
          </div>

          {/* Scoring ─────────────────────────────────────── */}
          <div className="border rounded-2xl p-4">
            <h2 className="font-medium mb-2">Scoring</h2>

            <label className="text-sm">Scoring Type</label>
            <select
              className="border rounded-xl p-2 w-full mb-3"
              value={league.scoringType}
              onChange={(e) =>
                updateLeague({ scoringType: e.target.value as "points" | "categories" })
              }
            >
              <option value="points">Points</option>
              <option value="categories">Categories</option>
            </select>

            {!isCatMode ? (
              <>
                <p className="text-xs text-gray-600 mb-2">
                  If your league scores both G+A and P, you&apos;re counting goals twice.
                  Set G/A to 0 if you only score P, or leave P at 0 if you score G and A
                  separately.
                </p>

                <h3 className="text-sm font-semibold mt-1 mb-1">Skaters</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
                  {SKATER_STATS.map((stat) => (
                    <div key={stat} className="flex items-center justify-between gap-2">
                      <label className="text-sm w-16">
                        {stat === "PLUS" ? "+" : stat === "MINUS" ? "−" : stat}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        className="border rounded-xl p-1 w-full"
                        value={league.skaterWeights[stat]}
                        onChange={(e) =>
                          updateSkaterWeight(stat, parseFloat(e.target.value || "0"))
                        }
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
                        type="number"
                        step="0.1"
                        className="border rounded-xl p-1 w-full"
                        value={league.goalieWeights[stat]}
                        onChange={(e) =>
                          updateGoalieWeight(stat, parseFloat(e.target.value || "0"))
                        }
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
                        const label =
                          stat === "PLUS" ? "+" : stat === "MINUS" ? "−" : stat;
                        return (
                          <div key={stat} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              id={`scat-${stat}`}
                              checked={cfg !== null}
                              onChange={(e) =>
                                updateSkaterCategory(
                                  stat,
                                  e.target.checked ? { direction: "more" } : null
                                )
                              }
                            />
                            <label
                              htmlFor={`scat-${stat}`}
                              className="w-10 cursor-pointer"
                            >
                              {label}
                            </label>
                            {cfg && (
                              <div className="flex rounded-lg border overflow-hidden text-xs">
                                <button
                                  className={`px-1.5 py-0.5 ${
                                    cfg.direction === "more"
                                      ? "bg-blue-600 text-white"
                                      : "text-gray-600 hover:bg-gray-100"
                                  }`}
                                  onClick={() =>
                                    updateSkaterCategory(stat, { direction: "more" })
                                  }
                                >
                                  +
                                </button>
                                <button
                                  className={`px-1.5 py-0.5 ${
                                    cfg.direction === "less"
                                      ? "bg-blue-600 text-white"
                                      : "text-gray-600 hover:bg-gray-100"
                                  }`}
                                  onClick={() =>
                                    updateSkaterCategory(stat, { direction: "less" })
                                  }
                                >
                                  −
                                </button>
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
                                updateGoalieCategory(
                                  stat,
                                  e.target.checked ? { direction: "more" } : null
                                )
                              }
                            />
                            <label
                              htmlFor={`gcat-${stat}`}
                              className="w-10 cursor-pointer"
                            >
                              {stat}
                            </label>
                            {cfg && (
                              <div className="flex rounded-lg border overflow-hidden text-xs">
                                <button
                                  className={`px-1.5 py-0.5 ${
                                    cfg.direction === "more"
                                      ? "bg-blue-600 text-white"
                                      : "text-gray-600 hover:bg-gray-100"
                                  }`}
                                  onClick={() =>
                                    updateGoalieCategory(stat, { direction: "more" })
                                  }
                                >
                                  +
                                </button>
                                <button
                                  className={`px-1.5 py-0.5 ${
                                    cfg.direction === "less"
                                      ? "bg-blue-600 text-white"
                                      : "text-gray-600 hover:bg-gray-100"
                                  }`}
                                  onClick={() =>
                                    updateGoalieCategory(stat, { direction: "less" })
                                  }
                                >
                                  −
                                </button>
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
      )}
    </div>
  );
}
