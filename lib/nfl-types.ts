// ============================================================
// NFL TYPES
// ============================================================

/** All roster slot positions including bench/IR */
export type NflPosition =
  | "QB" | "RB" | "WR" | "TE" | "K" | "DST"
  | "FLEX" | "BN" | "IR";

/** Only positions that map to actual players on the field */
export type NflPlayerPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

/** Slots per position in a roster */
export type NflRoster = Record<NflPosition, number>;

/** Per-stat scoring weights */
export type NflScoringWeights = {
  // ── Passing ──────────────────────────────────────────────
  passYds: number;       // per yard (e.g. 0.04 = 1pt/25yds)
  passTDs: number;       // per TD
  passInt: number;       // per INT (negative)
  pass2pt: number;       // per passing 2-pt conversion

  // ── Rushing ──────────────────────────────────────────────
  rushYds: number;       // per yard (e.g. 0.1 = 1pt/10yds)
  rushTDs: number;       // per TD
  rushAtt: number;       // per rushing attempt (carry)
  rush2pt: number;       // per rushing 2-pt conversion

  // ── Receiving ────────────────────────────────────────────
  rec: number;           // per reception (0 std / 0.5 half / 1 full PPR)
  recYds: number;        // per yard
  recTDs: number;        // per TD
  rec2pt: number;        // per receiving 2-pt conversion

  // ── Yard bonuses (points per game hitting the threshold) ─
  // The UI exposes two configurable bonus slots per category;
  // each slot picks one of these threshold keys to hold points.
  bonusPassYd100: number;
  bonusPassYd150: number;
  bonusPassYd200: number;
  bonusPassYd250: number;
  bonusPassYd300: number;
  bonusRushYd100: number;
  bonusRushYd150: number;
  bonusRushYd200: number;
  bonusRushYd250: number;
  bonusRushYd300: number;
  bonusRecYd100: number;
  bonusRecYd150: number;
  bonusRecYd200: number;
  bonusRecYd250: number;
  bonusRecYd300: number;

  // ── Turnovers ────────────────────────────────────────────
  fumblesLost: number;   // per fumble lost (negative)

  // ── Kicker ───────────────────────────────────────────────
  fgMade0to39: number;
  fgMade40to49: number;
  fgMade50plus: number;
  fgMissed: number;      // per miss (negative)
  patMade: number;
  patMissed: number;     // per miss (negative)

  // ── Defense / Special Teams (counting stats) ─────────────
  sacks: number;
  ints: number;          // defensive interceptions
  fumbRec: number;       // fumble recoveries
  defTDs: number;        // defensive/ST touchdowns

  // ── DST: points-allowed step function ────────────────────
  ptsAllowed0: number;      // 0 pts allowed
  ptsAllowed1to6: number;
  ptsAllowed7to13: number;
  ptsAllowed14to20: number;
  ptsAllowed21to27: number;
  ptsAllowed28to34: number;
  ptsAllowed35plus: number;
};

/** Raw seasonal stats stored per player */
export type NflPlayerStats = {
  // Skill positions
  passYds?: number;
  passTDs?: number;
  passInt?: number;
  rushYds?: number;
  rushTDs?: number;
  rushAtt?: number;
  rec?: number;
  recYds?: number;
  recTDs?: number;
  fumblesLost?: number;
  pass2pt?: number;
  rush2pt?: number;
  rec2pt?: number;
  // Season counts of games hitting each yardage threshold
  bonusPassYd100?: number;
  bonusPassYd150?: number;
  bonusPassYd200?: number;
  bonusPassYd250?: number;
  bonusPassYd300?: number;
  bonusRushYd100?: number;
  bonusRushYd150?: number;
  bonusRushYd200?: number;
  bonusRushYd250?: number;
  bonusRushYd300?: number;
  bonusRecYd100?: number;
  bonusRecYd150?: number;
  bonusRecYd200?: number;
  bonusRecYd250?: number;
  bonusRecYd300?: number;
  // Kicker
  fgMade0to39?: number;
  fgMade40to49?: number;
  fgMade50plus?: number;
  fgMissed?: number;
  patMade?: number;
  patMissed?: number;
  // DST
  sacks?: number;
  ints?: number;
  fumbRec?: number;
  defTDs?: number;
  ptsAllowed?: number;   // total points allowed for the season
  ydsAllowed?: number;   // total yards allowed for the season
};

/** A player entry in the NFL player database */
export type NflDbPlayer = {
  id: number;
  name: string;
  team: string;
  position: NflPlayerPosition;
  gamesPlayed: number;
  stats: NflPlayerStats;
};

/** Full NFL league configuration */
export type NflLeague = {
  name: string;
  teams: number;
  leagueType: "redraft" | "keeper";
  keepersPerTeam: number;
  qbFormat: "1QB" | "2QB";
  pprFormat: "standard" | "half" | "full";
  roster: NflRoster;
  scoringWeights: NflScoringWeights;
};

// ============================================================
// YARD BONUS HELPERS
// ============================================================

/** Threshold options offered in the yard-bonus dropdowns */
export const NFL_YARD_BONUS_THRESHOLDS = [100, 150, 200, 250, 300] as const;
export type NflYardBonusThreshold = (typeof NFL_YARD_BONUS_THRESHOLDS)[number];
export type NflYardBonusCategory = "pass" | "rush" | "rec";

/** Scoring-weight key for a category + threshold, e.g. nflYardBonusKey("rec", 150) → "bonusRecYd150" */
export function nflYardBonusKey(
  cat: NflYardBonusCategory,
  thr: NflYardBonusThreshold
): keyof NflScoringWeights {
  const c = cat === "pass" ? "Pass" : cat === "rush" ? "Rush" : "Rec";
  return `bonus${c}Yd${thr}` as keyof NflScoringWeights;
}

/** All 15 yard-bonus weight keys (also valid NflPlayerStats keys) */
export const NFL_YARD_BONUS_KEYS = (["pass", "rush", "rec"] as const).flatMap((cat) =>
  NFL_YARD_BONUS_THRESHOLDS.map((thr) => nflYardBonusKey(cat, thr))
) as (keyof NflScoringWeights & keyof NflPlayerStats)[];

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_NFL_ROSTER: NflRoster = {
  QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 7, IR: 1,
};

/** Standard half-PPR 1QB 12-team scoring */
export const DEFAULT_NFL_SCORING_WEIGHTS: NflScoringWeights = {
  passYds:         0.04,  // 1 pt / 25 yds
  passTDs:         4,
  passInt:        -2,
  rushYds:         0.1,   // 1 pt / 10 yds
  rushTDs:         6,
  rushAtt:         0,
  rec:             0.5,   // half PPR
  recYds:          0.1,   // 1 pt / 10 yds
  recTDs:          6,
  pass2pt:         0,
  rush2pt:         0,
  rec2pt:          0,
  bonusPassYd100:  0,
  bonusPassYd150:  0,
  bonusPassYd200:  0,
  bonusPassYd250:  0,
  bonusPassYd300:  0,
  bonusRushYd100:  0,
  bonusRushYd150:  0,
  bonusRushYd200:  0,
  bonusRushYd250:  0,
  bonusRushYd300:  0,
  bonusRecYd100:   0,
  bonusRecYd150:   0,
  bonusRecYd200:   0,
  bonusRecYd250:   0,
  bonusRecYd300:   0,
  fumblesLost:    -2,
  fgMade0to39:     3,
  fgMade40to49:    4,
  fgMade50plus:    5,
  fgMissed:       -1,
  patMade:         1,
  patMissed:      -1,
  sacks:           1,
  ints:            2,
  fumbRec:         2,
  defTDs:          6,
  ptsAllowed0:     10,
  ptsAllowed1to6:   7,
  ptsAllowed7to13:  4,
  ptsAllowed14to20: 1,
  ptsAllowed21to27: 0,
  ptsAllowed28to34:-1,
  ptsAllowed35plus:-4,
};

export const DEFAULT_NFL_LEAGUE: NflLeague = {
  name: "",
  teams: 12,
  leagueType: "redraft",
  keepersPerTeam: 0,
  qbFormat: "1QB",
  pprFormat: "half",
  roster: DEFAULT_NFL_ROSTER,
  scoringWeights: DEFAULT_NFL_SCORING_WEIGHTS,
};
