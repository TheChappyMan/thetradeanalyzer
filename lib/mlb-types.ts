/**
 * Shared MLB types, constants, and defaults.
 * Imported by app/mlb/page.tsx and app/settings/NhlSettingsForm.tsx.
 */

// ============================================================
// STAT KEYS
// ============================================================

// Derived from buildPlayerDatabase() stats object in app/mlb/page.tsx
// PO/A/E = fielding putouts, assists, errors
export type HitterStatKey =
  | "G" | "R" | "HR" | "RBI" | "SB" | "AVG" | "OBP" | "SLG"
  | "H" | "1B" | "2B" | "3B" | "BB" | "K" | "XBH" | "TB" | "CS" | "AB"
  | "SF" | "SH" | "HBP" | "GIDP" | "PA" | "PO" | "A" | "E";

// Derived from buildPlayerDatabase() stats object in app/mlb/page.tsx
// H = hits allowed, ER = earned runs, HR = home runs allowed,
// HBP = hit batters, NH/PG = no-hitters / perfect games
export type PitcherStatKey =
  | "W" | "L" | "SV" | "BS" | "HLD" | "K" | "ERA" | "WHIP"
  | "IP" | "OUTS" | "QS" | "GS" | "CG" | "NH" | "PG"
  | "H" | "ER" | "HR" | "BB" | "HBP" | "BLK"
  | "HR9" | "K/9" | "K/BB" | "K%";

export type HitterWeights  = Record<HitterStatKey,  number>;
export type PitcherWeights = Record<PitcherStatKey, number>;

// Used as: cfg.direction === "more" | "less" in both files
export type CategoryConfig = { direction: "more" | "less" };

// ============================================================
// LEAGUE FORMAT
// ============================================================

// Used as: (["5x5", "obp", "points"] as LeagueFormat[]) in both files
export type LeagueFormat = "5x5" | "obp" | "points";

// ============================================================
// ROSTER
// ============================================================

// Hitter slots (incl. CI = 1B/3B, MI = 2B/SS, IF = any infield,
// LF/CF/RF outfield splits), pitcher slots, and bench-type slots
// (BN, IL, NA = minors/not active — excluded from pool sizing).
export type MlbRosterKey =
  | "C" | "1B" | "2B" | "3B" | "SS" | "CI" | "MI" | "IF"
  | "OF" | "LF" | "CF" | "RF" | "UTIL"
  | "SP" | "RP" | "P" | "BN" | "IL" | "NA";

export type MlbRoster = Record<MlbRosterKey, number>;

// ============================================================
// LEAGUE
// ============================================================

// Derived from all league.* accesses in both files
export type MlbLeague = {
  name:             string;
  teams:            number;
  leagueType:       "redraft" | "keeper";
  keepersPerTeam:   number;
  roster:           MlbRoster;
  format:           LeagueFormat;
  hitterWeights:    HitterWeights;
  pitcherWeights:   PitcherWeights;
  hitterCategories:  Record<HitterStatKey,  CategoryConfig | null>;
  pitcherCategories: Record<PitcherStatKey, CategoryConfig | null>;
};

// ============================================================
// STAT LISTS
// ============================================================

export const HITTER_STATS: HitterStatKey[] = [
  "G", "R", "HR", "RBI", "SB", "AVG", "OBP", "SLG",
  "H", "1B", "2B", "3B", "BB", "K", "XBH", "TB", "CS", "AB",
  "SF", "SH", "HBP", "GIDP", "PA", "PO", "A", "E",
];

export const PITCHER_STATS: PitcherStatKey[] = [
  "W", "L", "SV", "BS", "HLD", "K", "ERA", "WHIP", "IP", "OUTS",
  "QS", "GS", "CG", "NH", "PG", "H", "ER", "HR", "BB", "HBP", "BLK",
  "HR9", "K/9", "K/BB", "K%",
];

// ============================================================
// FACTORY HELPERS
// ============================================================

export function emptyHitterWeights(): HitterWeights {
  return HITTER_STATS.reduce((a, s) => ({ ...a, [s]: 0 }), {} as HitterWeights);
}

export function emptyPitcherWeights(): PitcherWeights {
  return PITCHER_STATS.reduce((a, s) => ({ ...a, [s]: 0 }), {} as PitcherWeights);
}

export function emptyHitterCategories(): Record<HitterStatKey, CategoryConfig | null> {
  return HITTER_STATS.reduce(
    (a, s) => ({ ...a, [s]: null }),
    {} as Record<HitterStatKey, CategoryConfig | null>
  );
}

export function emptyPitcherCategories(): Record<PitcherStatKey, CategoryConfig | null> {
  return PITCHER_STATS.reduce(
    (a, s) => ({ ...a, [s]: null }),
    {} as Record<PitcherStatKey, CategoryConfig | null>
  );
}

/**
 * Returns category selections and scoring weights for a given format.
 * Spread onto MlbLeague when the user switches formats.
 */
export function presetForFormat(format: LeagueFormat): {
  hitterCategories:  Record<HitterStatKey,  CategoryConfig | null>;
  pitcherCategories: Record<PitcherStatKey, CategoryConfig | null>;
  hitterWeights:     HitterWeights;
  pitcherWeights:    PitcherWeights;
} {
  const hc = emptyHitterCategories();
  const pc = emptyPitcherCategories();
  const hw = emptyHitterWeights();
  const pw = emptyPitcherWeights();

  if (format === "5x5") {
    hc.R   = { direction: "more" };
    hc.HR  = { direction: "more" };
    hc.RBI = { direction: "more" };
    hc.SB  = { direction: "more" };
    hc.AVG = { direction: "more" };
    pc.W   = { direction: "more" };
    pc.SV  = { direction: "more" };
    pc.K   = { direction: "more" };
    pc.ERA  = { direction: "less" };
    pc.WHIP = { direction: "less" };
  } else if (format === "obp") {
    hc.R   = { direction: "more" };
    hc.HR  = { direction: "more" };
    hc.RBI = { direction: "more" };
    hc.SB  = { direction: "more" };
    hc.OBP = { direction: "more" };   // OBP replaces AVG
    pc.W   = { direction: "more" };
    pc.SV  = { direction: "more" };
    pc.K   = { direction: "more" };
    pc.ERA  = { direction: "less" };
    pc.WHIP = { direction: "less" };
  } else {
    // Points — typical default weights (from page.tsx inline hint text)
    hw.R   = 1;
    hw.H   = 1;
    hw.HR  = 4;
    hw.RBI = 1;
    hw.BB  = 1;
    hw.SB  = 2;
    hw.K   = -1;
    pw.W   = 5;
    pw.L   = -3;
    pw.SV  = 5;
    pw.HLD = 3;
    pw.K   = 1;
    pw.IP  = 1;
    pw.QS  = 3;
    pw.BB  = -1;
  }

  return { hitterCategories: hc, pitcherCategories: pc, hitterWeights: hw, pitcherWeights: pw };
}

// ============================================================
// DEFAULT LEAGUE
// ============================================================

export const DEFAULT_MLB_LEAGUE: MlbLeague = {
  name:           "",
  teams:          12,
  leagueType:     "redraft",
  keepersPerTeam: 0,
  roster: {
    C: 1, "1B": 1, "2B": 1, "3B": 1, SS: 1, CI: 0, MI: 0, IF: 0,
    OF: 3, LF: 0, CF: 0, RF: 0, UTIL: 1,
    SP: 5, RP: 3, P: 0, BN: 5, IL: 2, NA: 0,
  },
  format: "5x5",
  ...presetForFormat("5x5"),
};
