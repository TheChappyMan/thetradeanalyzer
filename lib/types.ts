/**
 * Shared League types and constants.
 *
 * app/page.tsx keeps its own identical copies of these definitions so that
 * file doesn't need to be changed. Keep this file in sync whenever the
 * types evolve.
 */

// ============================================================
// TYPES
// ============================================================

/** A row from the Supabase leagues table. */
export type LeagueRow = {
  id: string;
  name: string;
  sport: string;
  settings: unknown;
  created_at: string;
};

export type SkaterStatKey =
  | "G" | "A" | "P" | "PM" | "PIM"
  | "PPG" | "PPA" | "PPP"
  | "SHG" | "SHA" | "SHP"
  | "GWG" | "SOG" | "HIT" | "BLK" | "FW" | "FL"
  | "TOI" | "ATOI";

export type GoalieStatKey = "W" | "L" | "OTL" | "SO" | "SV" | "GA" | "GAA" | "SV%";

export type SkaterWeights = Record<SkaterStatKey, number>;
export type GoalieWeights = Record<GoalieStatKey, number>;

export type CategoryConfig = { direction: "more" | "less" };

export type RosterKey =
  | "C" | "LW" | "RW" | "W" | "F" | "D" | "U" | "G" | "B" | "IR" | "IRplus";
export type Roster = Record<RosterKey, number>;

export type League = {
  name: string;
  teams: number;
  leagueType: "redraft" | "keeper";
  keepersPerTeam: number;
  roster: Roster;
  scoringType: "points" | "categories";
  skaterWeights: SkaterWeights;
  goalieWeights: GoalieWeights;
  skaterCategories: Record<SkaterStatKey, CategoryConfig | null>;
  goalieCategories: Record<GoalieStatKey, CategoryConfig | null>;
};

// ============================================================
// CONSTANTS
// ============================================================

export const SKATER_STATS: SkaterStatKey[] = [
  "G", "A", "P", "PM", "PIM",
  "PPG", "PPA", "PPP",
  "SHG", "SHA", "SHP",
  "GWG", "SOG", "HIT", "BLK", "FW", "FL",
  "TOI", "ATOI",
];

export const GOALIE_STATS: GoalieStatKey[] = ["W", "L", "OTL", "SO", "SV", "GA", "GAA", "SV%"];

// ============================================================
// FACTORY HELPERS
// ============================================================

export function emptySkaterWeights(): SkaterWeights {
  return SKATER_STATS.reduce((acc, s) => ({ ...acc, [s]: 0 }), {} as SkaterWeights);
}
export function emptyGoalieWeights(): GoalieWeights {
  return GOALIE_STATS.reduce((acc, s) => ({ ...acc, [s]: 0 }), {} as GoalieWeights);
}
export function emptySkaterCategories(): Record<SkaterStatKey, CategoryConfig | null> {
  return SKATER_STATS.reduce(
    (acc, s) => ({ ...acc, [s]: null }),
    {} as Record<SkaterStatKey, CategoryConfig | null>
  );
}
export function emptyGoalieCategories(): Record<GoalieStatKey, CategoryConfig | null> {
  return GOALIE_STATS.reduce(
    (acc, s) => ({ ...acc, [s]: null }),
    {} as Record<GoalieStatKey, CategoryConfig | null>
  );
}

/** Standard points-league skater weights — applied when no league is configured. */
export function defaultSkaterWeights(): SkaterWeights {
  return {
    ...emptySkaterWeights(),
    G: 3, A: 2, PM: 0.5, PIM: 0,
    PPG: 1, PPA: 0.5, SHG: 2, SHA: 1,
    SOG: 0.1, HIT: 0.1, BLK: 0.1, FW: 0,
  };
}

/** Standard points-league goalie weights — applied when no league is configured. */
export function defaultGoalieWeights(): GoalieWeights {
  // Note: quality starts (QS) is not a stat the NHL data source provides,
  // so it is not part of GoalieStatKey and has no default weight.
  return {
    ...emptyGoalieWeights(),
    W: 5, SO: 3, GAA: 0, "SV%": 0,
  };
}

export const DEFAULT_NHL_LEAGUE: League = {
  name: "",
  teams: 12,
  leagueType: "redraft",
  keepersPerTeam: 0,
  roster: {
    C: 2, LW: 2, RW: 2, W: 0, F: 0,
    D: 4, U: 1, G: 2, B: 4, IR: 2, IRplus: 0,
  },
  scoringType: "points",
  skaterWeights: defaultSkaterWeights(),
  goalieWeights: defaultGoalieWeights(),
  skaterCategories: emptySkaterCategories(),
  goalieCategories: emptyGoalieCategories(),
};

/** Back-compat alias — existing imports use this name. */
export const DEFAULT_LEAGUE = DEFAULT_NHL_LEAGUE;
