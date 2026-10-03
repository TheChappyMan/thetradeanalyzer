/**
 * NHL engine + trade-card verification harness.
 *
 *   npm run verify:nhl              — run all scenarios against the frozen
 *                                     snapshot; exits nonzero on any FAIL
 *   npm run verify:nhl -- --capture — print current actuals (used to re-pin
 *                                     expectations after a DELIBERATE change)
 *   npm run verify:nhl:snapshot     — re-capture snapshot.json from the live
 *                                     NHL stats API (then --capture and re-pin!)
 *
 * Runs ONLY against scripts/verify-nhl/snapshot.json — never live data.
 * See SNAPSHOT.md.
 *
 * The engine is exercised through lib/nhl-valuation.ts — the exact module
 * the analyzer and the Rankings page import. The page-level pipeline
 * (eligibility → most favorable bar → tradeBase / displayBase → League
 * Ranking → pick talent ranking → flex multiplier) is MIRRORED from
 * app/nhl/page.tsx; keep it in sync if that page changes its value pipeline.
 *
 * Origin: 2026-10-03 bug — the trade card printed Base value 0.0 for
 * top-40 players in a categories league because it used the points
 * formula (all-zero weights) instead of tradeBase. Scenario S1 guards the
 * reported symptom directly: every top-100 League Ranking player must
 * carry a trade value > 0.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlayerDatabase,
  computePoolStats,
  zScoreValue,
  computeNhlReplacement,
  softReplacementValue,
  projectedSeasonValue,
  BELOW_REPL_BAND,
  type DbPlayer,
} from "../../lib/nhl-valuation";
import {
  DEFAULT_NHL_LEAGUE,
  emptySkaterCategories,
  emptyGoalieCategories,
  emptySkaterWeights,
  emptyGoalieWeights,
  type League,
  type Roster,
  type RosterKey,
  type SkaterStatKey,
  type GoalieStatKey,
} from "../../lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(HERE, "snapshot.json");
const SEASON = "20252026"; // "Last Year" once the 2026-27 season started (Oct 2026)

// ── Snapshot capture ──────────────────────────────────────────
// Raw NHL stats rows pruned to the fields buildPlayerDatabase reads, so the
// field-name fixes (timeOnIcePerGame → TOI, savePct → SV%) stay exercised.
const SKATER_FIELDS = ["playerId", "skaterFullName", "teamAbbrevs", "positionCode", "gamesPlayed",
  "goals", "assists", "points", "plusMinus", "penaltyMinutes", "ppPoints", "ppGoals", "shPoints",
  "shGoals", "gameWinningGoals", "shots", "timeOnIce", "timeOnIcePerGame"];
const REALTIME_FIELDS = ["playerId", "hits", "blockedShots"];
const FACEOFF_FIELDS = ["playerId", "totalFaceoffWins", "totalFaceoffLosses"];
const GOALIE_FIELDS = ["playerId", "goalieFullName", "teamAbbrevs", "gamesPlayed", "wins", "losses",
  "otLosses", "shutouts", "saves", "goalsAgainst", "goalsAgainstAverage", "savePct", "savePercentage"];

type Rows = Record<string, unknown>[];
type Snapshot = { season: string; capturedAt: string; summary: Rows; realtime: Rows; faceoffs: Rows; goalies: Rows };

async function fetchRows(path: string, fields: string[]): Promise<Rows> {
  const url = `https://api.nhle.com/stats/rest/en/${path}?limit=-1&cayenneExp=seasonId=${SEASON}%20and%20gameTypeId=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}`);
  const json = (await res.json()) as { data?: Rows };
  return (json.data ?? []).map((row) => Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]])));
}

async function captureSnapshot(): Promise<void> {
  const [summary, realtime, faceoffs, goalies] = await Promise.all([
    fetchRows("skater/summary", SKATER_FIELDS),
    fetchRows("skater/realtime", REALTIME_FIELDS),
    fetchRows("skater/faceoffwins", FACEOFF_FIELDS),
    fetchRows("goalie/summary", GOALIE_FIELDS),
  ]);
  const snap: Snapshot = { season: SEASON, capturedAt: new Date().toISOString(), summary, realtime, faceoffs, goalies };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap));
  console.log(`snapshot written: ${summary.length} skaters, ${goalies.length} goalies (${SEASON})`);
}

// ── League fixtures ───────────────────────────────────────────
/** LMAGMCF — the league from the 2026-10-03 bug report. */
function lmagmcf(): League {
  const skaterCategories = emptySkaterCategories();
  (["G", "A", "P", "PM", "PIM", "PPP", "GWG", "SOG", "HIT", "BLK", "FW"] as SkaterStatKey[])
    .forEach((k) => { skaterCategories[k] = { direction: "more" }; });
  const goalieCategories = emptyGoalieCategories();
  (["W", "SO", "SV", "SV%"] as GoalieStatKey[]).forEach((k) => { goalieCategories[k] = { direction: "more" }; });
  return {
    ...DEFAULT_NHL_LEAGUE,
    name: "LMAGMCF",
    teams: 12,
    leagueType: "redraft",
    roster: { C: 3, LW: 0, RW: 0, W: 4, F: 0, D: 3, U: 0, G: 2, B: 5, IR: 0, IRplus: 2 },
    scoringType: "categories",
    // A saved categories league carries no point weights — this is exactly
    // what made the old card formula print 0.0.
    skaterWeights: emptySkaterWeights(),
    goalieWeights: emptyGoalieWeights(),
    skaterCategories,
    goalieCategories,
  };
}

// ── Page pipeline mirror (app/nhl/page.tsx) ───────────────────
const SKATER_STATS: SkaterStatKey[] = ["G", "A", "P", "PM", "PIM", "PPG", "PPA", "PPP", "SHG", "SHA", "SHP", "STP", "GWG", "SOG", "HIT", "BLK", "FW", "FL", "TOI", "ATOI"];
const GOALIE_STATS: GoalieStatKey[] = ["W", "L", "OTL", "SO", "SV", "GA", "GAA", "SV%"];
const POSITION_SLOT_MAP: Record<string, string[]> = {
  C: ["C", "F", "U"], LW: ["LW", "W", "F", "U"], RW: ["RW", "W", "F", "U"],
  W: ["W", "LW", "RW", "F", "U"], F: ["F", "C", "LW", "RW", "W", "U"], D: ["D", "U"], G: ["G"],
};
const SKATER_SLOT_KEYS: RosterKey[] = ["C", "LW", "RW", "W", "F", "D", "U"];
const FLEX_ALPHA = 0.4;

function positionMultiplier(positions: string[], roster: Roster): number {
  if (!positions || positions.length === 0) return 1;
  if (positions.includes("G")) return 1;
  const totalSlots = SKATER_SLOT_KEYS.reduce((s, k) => s + (roster[k] || 0), 0);
  if (totalSlots === 0) return 1;
  const covered = (ps: string[]) => {
    const set = new Set<string>();
    ps.forEach((p) => (POSITION_SLOT_MAP[p] || []).forEach((s) => set.add(s)));
    let n = 0;
    set.forEach((s) => { if ((SKATER_SLOT_KEYS as string[]).includes(s)) n += roster[s as RosterKey] || 0; });
    return n;
  };
  return 1 + (covered(positions) / totalSlots - covered(["C"]) / totalSlots) * FLEX_ALPHA;
}

type Pipeline = {
  db: DbPlayer[];
  bars: Record<string, number>;
  diff: (p: DbPlayer, elig?: string[]) => number | null;
  tradeBase: (p: DbPlayer, elig?: string[]) => number;
  displayBase: (p: DbPlayer, elig?: string[]) => number;
  leagueRank: Map<number, number>;
  ranked: DbPlayer[];
  talent: number[];
  pickValue: (overall: number) => number;
};

function buildPipeline(db: DbPlayer[], league: League, useRates = false): Pipeline {
  const isCat = league.scoringType === "categories";
  const pool = isCat ? computePoolStats(db, league.teams, league.roster, SKATER_STATS, GOALIE_STATS, useRates) : null;
  const zOf = (p: DbPlayer) => zScoreValue(p, league.skaterCategories, league.goalieCategories, pool!, SKATER_STATS, GOALIE_STATS, useRates);
  const repl = isCat ? computeNhlReplacement(db, league.teams, league.roster, zOf) : null;
  const points = (p: DbPlayer) => projectedSeasonValue(p, league.skaterWeights, league.goalieWeights, useRates, league.positionBonuses);

  // Mirrors replacementDiff: most favorable eligible positional bar.
  const diff = (p: DbPlayer, elig?: string[]): number | null => {
    if (!isCat || !repl) return null;
    const z = zOf(p);
    if (p.isGoalie) return z - (repl.byPosition.G ?? 0);
    const cands = new Set<string>();
    for (const pos of (elig && elig.length > 0 ? elig : [p.position])) {
      if (pos === "W") { cands.add("LW"); cands.add("RW"); }
      else if (pos === "F") { cands.add("C"); cands.add("LW"); cands.add("RW"); }
      else if (pos in repl.byPosition) cands.add(pos);
    }
    if (cands.size === 0) cands.add(p.position);
    let best = -Infinity;
    for (const g of cands) best = Math.max(best, z - (repl.byPosition[g] ?? 0));
    return best;
  };
  const tradeBase = (p: DbPlayer, elig?: string[]) => {
    const d = diff(p, elig);
    if (d === null) return points(p);
    return d >= 0 ? d + BELOW_REPL_BAND : 0;
  };
  const displayBase = (p: DbPlayer, elig?: string[]) => {
    const d = diff(p, elig);
    return d === null ? points(p) : softReplacementValue(d);
  };
  const ranked = [...db].sort((a, b) => displayBase(b) - displayBase(a) || b.gamesPlayed - a.gamesPlayed);
  const leagueRank = new Map(ranked.map((p, i) => [p.id, i + 1]));
  const talent = db.map((p) => tradeBase(p)).sort((a, b) => b - a);
  const pickValue = (overall: number) => { const v = talent[overall - 1] || 0; return Math.min(v, v * 1.075); };
  return { db, bars: repl?.byPosition ?? {}, diff, tradeBase, displayBase, leagueRank, ranked, talent, pickValue };
}

// ── Scenario runner ───────────────────────────────────────────
type Result = { name: string; pass: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, pass: boolean, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
const byName = (db: DbPlayer[], name: string) => {
  const p = db.find((x) => x.name === name);
  if (!p) throw new Error(`snapshot has no player named ${name}`);
  return p;
};

function run(capture: boolean): void {
  const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
  const db = buildPlayerDatabase({ summary: snap.summary, realtime: snap.realtime, faceoffs: snap.faceoffs, goalies: snap.goalies });
  console.log(`snapshot ${snap.season} captured ${snap.capturedAt}: ${db.length} players\n`);

  // Data-field fixes (2b50d5b) stay live: TOI derived, SV% read from savePct.
  const skaters = db.filter((p) => !p.isGoalie && p.gamesPlayed > 0);
  const goalies = db.filter((p) => p.isGoalie && p.gamesPlayed > 0);
  check("D1 every skater has TOI > 0 (timeOnIcePerGame × GP)", skaters.every((p) => (p.stats.TOI || 0) > 0));
  check("D2 every goalie has SV% > 0 (savePct)", goalies.every((p) => (p.stats["SV%"] || 0) > 0));

  // ── LMAGMCF, Last Year - Total ──
  const L = lmagmcf();
  const P = buildPipeline(db, L, false);
  const johnston = byName(db, "Wyatt Johnston");
  const guentzel = byName(db, "Jake Guentzel");

  if (capture) {
    console.log("bars:", Object.fromEntries(Object.entries(P.bars).map(([k, v]) => [k, +v.toFixed(3)])));
    for (const p of [johnston, guentzel]) {
      console.log(`${p.name}: rank ${P.leagueRank.get(p.id)}  tradeBase C ${P.tradeBase(p, ["C"]).toFixed(3)}  C+W ${P.tradeBase(p, ["C", "W"]).toFixed(3)}  W ${P.tradeBase(p, ["W"]).toFixed(3)}`);
    }
    console.log(`pick 2.10 (22): ${P.pickValue(22).toFixed(3)}   pick 11.05 (125): ${P.pickValue(125).toFixed(3)}\n`);
  }

  // S1 — the reported symptom. Any top-100 League Ranking player must have a
  // positive trade value (the card now prints tradeBase, never the points
  // formula). Reported separately for skaters so the bug-report wording is
  // covered verbatim.
  const top100 = P.ranked.slice(0, 100);
  const zeroTop = top100.filter((p) => P.tradeBase(p) <= 0);
  const zeroTopSkaters = zeroTop.filter((p) => !p.isGoalie);
  check("S1a top-100 League Ranking skaters all have trade value > 0", zeroTopSkaters.length === 0,
    zeroTopSkaters.length ? zeroTopSkaters.map((p) => p.name).join(", ") : `${top100.filter((p) => !p.isGoalie).length} skaters checked`);
  check("S1b top-100 League Ranking players (incl. goalies) all have trade value > 0", zeroTop.length === 0);
  // The card's displayed base is tradeBase at the checked eligibility — it
  // can never print 0.0 for a top-100 skater at any REALISTIC eligibility
  // (a set that includes the player's own position; forcing a defenseman
  // to "C only" is not a case the card needs to survive).
  const realistic = (p: DbPlayer): string[][] =>
    p.position === "D" ? [["D"]] : [[p.position], [p.position, "W"], [p.position, "F"]];
  const cardZero = top100.filter((p) => !p.isGoalie).filter((p) =>
    realistic(p).some((elig) => P.tradeBase(p, elig) <= 0));
  check("S1c card base (tradeBase at any realistic eligibility) > 0 for every top-100 skater", cardZero.length === 0,
    cardZero.map((p) => p.name).join(", "));

  // S2 — pinned values from the bug report (reproduced 2026-10-03 against
  // live 2025-26 data before the fix; the engine was already correct).
  check("S2a Johnston League Ranking = 39", P.leagueRank.get(johnston.id) === 39, `got ${P.leagueRank.get(johnston.id)}`);
  check("S2b Guentzel League Ranking = 31", P.leagueRank.get(guentzel.id) === 31, `got ${P.leagueRank.get(guentzel.id)}`);
  check("S2c Johnston tradeBase C-only ≈ 4.71", near(P.tradeBase(johnston, ["C"]), 4.712), P.tradeBase(johnston, ["C"]).toFixed(3));
  check("S2d Johnston tradeBase C+W ≈ 7.63 (valued at LW bar)", near(P.tradeBase(johnston, ["C", "W"]), 7.625), P.tradeBase(johnston, ["C", "W"]).toFixed(3));
  check("S2e Guentzel tradeBase W ≈ 8.30", near(P.tradeBase(guentzel, ["W"]), 8.297), P.tradeBase(guentzel, ["W"]).toFixed(3));
  check("S2f Guentzel tradeBase C-only ≈ 5.38", near(P.tradeBase(guentzel, ["C"]), 5.384), P.tradeBase(guentzel, ["C"]).toFixed(3));
  check("S2g pick 2.10 ≈ 6.17 and pick 11.05 ≈ 0.44", near(P.pickValue(22), 6.17) && near(P.pickValue(125), 0.44),
    `${P.pickValue(22).toFixed(3)} / ${P.pickValue(125).toFixed(3)}`);
  check("S2h flex multiplier for C+W in LMAGMCF = ×1.160", near(positionMultiplier(["C", "W"], L.roster), 1.16, 0.001));

  // S3 — standing invariants over the whole pool.
  const diffs = db.map((p) => ({ p, d: P.diff(p)!, tb: P.tradeBase(p), db: P.displayBase(p) }));
  check("S3a trade value is never negative (adding a player never lowers a side)", diffs.every((x) => x.tb >= 0));
  check("S3b below-replacement players are worth exactly 0 in trade math", diffs.filter((x) => x.d < 0).every((x) => x.tb === 0),
    `${diffs.filter((x) => x.d < 0).length} below-bar players`);
  check("S3c above the bar, tradeBase === displayBase", diffs.filter((x) => x.d >= 0).every((x) => x.tb === x.db));
  check("S3d displayBase keeps below-bar players ordered (strictly positive)", diffs.filter((x) => x.d < 0).every((x) => x.db > 0 && x.db <= BELOW_REPL_BAND));
  // Lowest-bar rule: a multi-eligible player is never worth less than at any single eligibility.
  const lowestBarOk = skaters.slice(0, 300).every((p) =>
    P.tradeBase(p, ["C", "W"]) >= Math.max(P.tradeBase(p, ["C"]), P.tradeBase(p, ["W"])) - 1e-9);
  check("S3e multi-eligible value = best single-eligibility value", lowestBarOk);

  // S4 — bench / IR / IR+ never feed pool sizing or replacement bars.
  const noBench: League = { ...L, roster: { ...L.roster, B: 0, IR: 0, IRplus: 0 } };
  const P2 = buildPipeline(db, noBench, false);
  const barsSame = Object.keys(P.bars).every((k) => P.bars[k] === P2.bars[k]);
  const valuesSame = db.every((p) => P.tradeBase(p) === P2.tradeBase(p));
  check("S4 B / IR / IR+ slots do not change bars or trade values", barsSame && valuesSame);

  // S5 — points mode untouched: tradeBase and displayBase are the raw
  // projected points, unshifted and unclamped.
  const pointsLeague: League = { ...DEFAULT_NHL_LEAGUE, scoringType: "points" };
  const P3 = buildPipeline(db, pointsLeague, false);
  const pts = (p: DbPlayer) => projectedSeasonValue(p, pointsLeague.skaterWeights, pointsLeague.goalieWeights, false, pointsLeague.positionBonuses);
  const maxDrift = Math.max(...db.map((p) => Math.abs(P3.tradeBase(p) - pts(p))), ...db.map((p) => Math.abs(P3.displayBase(p) - pts(p))));
  check("S5 points mode byte-identical (max |value − projected| = 0)", maxDrift === 0, `max drift ${maxDrift}`);

  // ── Summary ──
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--snapshot")) {
  await captureSnapshot();
} else {
  run(args.includes("--capture"));
}
