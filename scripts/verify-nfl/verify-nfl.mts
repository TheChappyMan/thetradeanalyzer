/**
 * NFL engine + Draft Mode verification harness.
 *
 *   npm run verify:nfl              — run all scenarios against the frozen
 *                                     snapshot; exits nonzero on any FAIL
 *   npm run verify:nfl -- --capture — print current actuals (used to re-pin
 *                                     fixtures after a DELIBERATE engine change)
 *   npm run verify:nfl:snapshot     — re-capture snapshot.json from the live
 *                                     feed (then run --capture and re-pin!)
 *
 * Runs ONLY against scripts/verify-nfl/snapshot.json — never live data.
 * Live Sleeper drift invalidated baselines once already (2026-09 week:
 * Jacobs' projection was slashed mid-verification). See SNAPSHOT.md.
 *
 * The recommendation layer is exercised through lib/nfl-draft-rec.ts —
 * the exact module the Rankings page runs, not a mirror. The trade-rating
 * scenario mirrors app/nfl/page.tsx's trade pipeline (documented drift risk;
 * keep in sync if that page's value pipeline changes).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  projectedNflValue,
  replacementLevelValue,
  valueAboveReplacement,
  rbScarcityMultiplier,
  teScarcityMultiplier,
  nflInjuryMultiplier,
  effectiveBenchSlots,
} from "../../lib/nfl-valuation";
import { computeNflDraftRecs } from "../../lib/nfl-draft-rec";
import {
  DEFAULT_NFL_LEAGUE,
  type NflDbPlayer,
  type NflPlayerPosition,
  type NflRoster,
  type NflScoringWeights,
} from "../../lib/nfl-types";
import { BTM, BTM_S3_PRE_TIER_RECIDS, FIXTURES, KEP, SF } from "./fixtures.mts";

const __dir = dirname(fileURLToPath(import.meta.url));
const CAPTURE = process.argv.includes("--capture");
const SNAPSHOT_MODE = process.argv.includes("--snapshot");

// ── Snapshot re-capture mode ─────────────────────────────────
if (SNAPSHOT_MODE) {
  const proj = await (await fetch("https://app.thetradeanalyzer.com/api/nfl?endpoint=projections")).json();
  const seasons = await (await fetch("https://app.thetradeanalyzer.com/api/nfl?endpoint=all-seasons")).json();
  const snap = {
    capturedAt: new Date().toISOString(),
    projSeasonId: proj.seasonId,
    projSource: proj.source,
    projPlayers: proj.players,
    lastSeasonId: seasons.priorSeason.seasonId,
    lastPlayers: seasons.priorSeason.players,
  };
  writeFileSync(join(__dir, "snapshot.json"), JSON.stringify(snap));
  console.log(`Snapshot re-captured (${snap.projPlayers.length} proj / ${snap.lastPlayers.length} last-year players).`);
  console.log("Update SNAPSHOT.md's date, then run --capture and re-pin fixtures.mts.");
  process.exit(0);
}

// ── Frozen data ──────────────────────────────────────────────
type Snapshot = {
  capturedAt: string;
  projSeasonId: string;
  projPlayers: NflDbPlayer[];
  lastSeasonId: string;
  lastPlayers: NflDbPlayer[];
};
const SNAP: Snapshot = JSON.parse(readFileSync(join(__dir, "snapshot.json"), "utf8"));

// ── Shared helpers (engine calls; no logic of their own) ─────
type League = { teams: number; qbFormat: "1QB" | "2QB"; roster: NflRoster; weights: NflScoringWeights };

function bars(players: NflDbPlayer[], lg: League) {
  const m = new Map<NflPlayerPosition, number>();
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DST"] as NflPlayerPosition[]) {
    m.set(pos, replacementLevelValue(pos, players, lg.weights, lg.roster, lg.teams, lg.qbFormat, false));
  }
  return m;
}
const varOf = (p: NflDbPlayer, players: NflDbPlayer[], lg: League, b = bars(players, lg)) =>
  valueAboveReplacement(projectedNflValue(p, lg.weights, false), b.get(p.position) ?? 0);

/** Replacement RANK: mirrors replacementLevelValue's index math. */
function replacementRank(pos: NflPlayerPosition, players: NflDbPlayer[], lg: League): number {
  const values = players.filter((p) => p.position === pos)
    .map((p) => projectedNflValue(p, lg.weights, false)).sort((a, b) => b - a);
  const bar = bars(players, lg).get(pos) ?? 0;
  const idx = values.findIndex((v) => Math.abs(v - bar) < 1e-9);
  return idx + 1;
}

const byProj = (players: NflDbPlayer[], pos: NflPlayerPosition, lg: League) =>
  players.filter((p) => p.position === pos)
    .sort((a, b) => projectedNflValue(b, lg.weights, false) - projectedNflValue(a, lg.weights, false));

const find = (players: NflDbPlayer[], name: string) => {
  const p = players.find((x) => x.name === name);
  if (!p) throw new Error(`snapshot missing player: ${name}`);
  return p;
};

// ── Trade pipeline (mirrors app/nfl/page.tsx — keep in sync) ──
function tradePipeline(players: NflDbPlayer[], lg: League, discountActive: boolean) {
  const b = bars(players, lg);
  const bv = (p: NflDbPlayer) => varOf(p, players, lg, b);
  const rank = new Map<number, number>();
  for (const pos of ["RB", "TE"] as const) {
    players.filter((p) => p.position === pos).sort((a, c) => bv(c) - bv(a))
      .forEach((p, i) => rank.set(p.id, i + 1));
  }
  const value = (p: NflDbPlayer) => {
    const scarcity =
      p.position === "RB" ? rbScarcityMultiplier(rank.get(p.id) ?? 999) :
      p.position === "TE" ? teScarcityMultiplier(rank.get(p.id) ?? 999) : 1.0;
    return bv(p) * scarcity * nflInjuryMultiplier(p.injuryStatus, discountActive);
  };
  const talent = players.map(bv).sort((a, c) => c - a);
  const pick = (overall: number) =>
    overall - 1 >= talent.length ? (talent[talent.length - 1] || 0) : (talent[overall - 1] || 0);
  return { value, pick, bv };
}
function tradeRating(send: number, recv: number): number {
  const offset = Math.min(0, send, recv);
  const minVal = Math.min(send - offset, recv - offset);
  const maxVal = Math.max(send - offset, recv - offset);
  return minVal === 0 || maxVal === 0 ? 0
    : Math.min(100, Math.round(100 * Math.exp(-2.5 * (maxVal / minVal - 1)) * 10) / 10);
}

// ── Draft Mode helper (exercises the REAL lib function) ──────
type Taken = Record<number, "league" | "mine">;
function recs(players: NflDbPlayer[], taken: Taken, lg: League, picksRemaining: number, probeIds?: number[]) {
  const res = computeNflDraftRecs({
    playerDb: players, taken, replacementLevels: bars(players, lg),
    weights: lg.weights, roster: lg.roster, qbFormat: lg.qbFormat, teams: lg.teams,
    useRates: false, availabilityDiscountActive: false, picksRemaining, probeIds,
  });
  const recPlayers = res.recIds.map((id) => players.find((p) => p.id === id)!);
  return { ...res, recPlayers };
}
const mark = (list: NflDbPlayer[], kind: "league" | "mine", into: Taken = {}) =>
  list.reduce((m, p) => ((m[p.id] = kind), m), into);

// ── Compute all actuals ──────────────────────────────────────
const proj = SNAP.projPlayers;
const last = SNAP.lastPlayers;

const actuals: Record<string, number | boolean | string> = {};

// 1. KEP replacement bars (projected snapshot)
for (const pos of ["QB", "RB", "WR", "TE"] as NflPlayerPosition[]) {
  actuals[`kep.bar.${pos}.rank`] = replacementRank(pos, proj, KEP);
  actuals[`kep.bar.${pos}.points`] = +((bars(proj, KEP).get(pos) ?? 0).toFixed(1));
}
// 2. McConkey VAR (KEP, projected)
actuals["kep.mcconkey.var"] = +varOf(find(proj, "Ladd McConkey"), proj, KEP).toFixed(1);
// 3. Picks
{
  const tp = tradePipeline(proj, KEP, false);
  actuals["kep.pick2_10.var"] = +tp.pick(20).toFixed(1);
  actuals["kep.pick12_02.var"] = +tp.pick(112).toFixed(1);
}
// 4. Reference trade: give Jacobs + 2.10, get McConkey + 12.02
for (const [key, players, discount] of [["proj", proj, false], ["last", last, true]] as const) {
  const tp = tradePipeline(players, KEP, discount);
  const send = tp.value(find(players, "Josh Jacobs")) + tp.pick(20);
  const recv = tp.value(find(players, "Ladd McConkey")) + tp.pick(112);
  actuals[`kep.trade.${key}.rating`] = +tradeRating(send, recv).toFixed(1);
}
// 5. Top healthy QB VAR
{
  const q = byProj(proj, "QB", KEP).filter((p) => !p.injuryStatus)[0];
  actuals["kep.topqb.var"] = +varOf(q, proj, KEP).toFixed(1);
}
// 6. effectiveBenchSlots
for (const bn of [2, 3, 4, 5, 11]) actuals[`bench.eff.${bn}`] = effectiveBenchSlots(bn);
// 7. BN=3 no-op: lib bars equal a raw-bench (no weighting) computation
{
  const kep3: League = { ...KEP, roster: { ...KEP.roster, BN: 3 } };
  // Raw-bench variant (pre-d6781c9 logic) — weighting must be a no-op at BN=3
  const rawBar = (pos: NflPlayerPosition) => {
    const values = proj.filter((p) => p.position === pos)
      .map((p) => projectedNflValue(p, kep3.weights, false)).sort((a, b) => b - a);
    const bench = 3, qbBench = Math.min(1, bench), rem = bench - qbBench;
    const flex = kep3.roster.FLEX ?? 0;
    const rbSF = (kep3.roster.RB ?? 0) + flex * 0.5, wrSF = (kep3.roster.WR ?? 0) + flex * 0.4, teSF = (kep3.roster.TE ?? 0) + flex * 0.1;
    const sfT = rbSF + wrSF + teSF;
    const bf = (sf: number) => rem * (sf / sfT);
    const perTeam: Record<string, number> = { QB: 1 + qbBench, RB: rbSF + bf(rbSF), WR: wrSF + bf(wrSF), TE: teSF + bf(teSF), K: 0, DST: 0 };
    const idx = Math.min(Math.round(kep3.teams * perTeam[pos]), values.length - 1);
    return values[idx] ?? 0;
  };
  actuals["bench.bn3.noop"] = (["QB", "RB", "WR", "TE"] as NflPlayerPosition[])
    .every((pos) => Math.abs((bars(proj, kep3).get(pos) ?? 0) - rawBar(pos)) < 1e-9);
}
// 8. Draft Mode (SF league)
{
  const qb = (n: number) => byProj(proj, "QB", SF).slice(0, n);
  // (a) 5RB/3WR/1TE/2QB, RB-drained board
  const mine = [...qb(2),
    byProj(proj, "RB", SF)[2], byProj(proj, "RB", SF)[7], byProj(proj, "RB", SF)[14], byProj(proj, "RB", SF)[19], byProj(proj, "RB", SF)[27],
    byProj(proj, "WR", SF)[1], byProj(proj, "WR", SF)[9], byProj(proj, "WR", SF)[17],
    byProj(proj, "TE", SF)[3]];
  const taken = mark(mine, "mine");
  for (const p of [...byProj(proj, "QB", SF).slice(2, 16), ...byProj(proj, "RB", SF).slice(0, 30),
    ...byProj(proj, "WR", SF).slice(0, 8), ...byProj(proj, "TE", SF).slice(0, 6)]) {
    if (!taken[p.id]) taken[p.id] = "league";
  }
  const a = recs(proj, taken, SF, 4);
  actuals["sf.a.topIsNeedWR"] = a.recPlayers[0]?.position === "WR" && a.diag.needsByPos.WR === true;
  actuals["sf.a.zeroQBs"] = !a.recPlayers.some((p) => p.position === "QB");
  actuals["sf.a.noKDst"] = !a.recPlayers.some((p) => p.position === "K" || p.position === "DST"); // (f)
  // (b) empty roster, round-3 board
  const t2 = mark([...byProj(proj, "RB", SF).slice(0, 6), ...byProj(proj, "WR", SF).slice(0, 5),
    ...qb(4), byProj(proj, "TE", SF)[0]], "league");
  actuals["sf.b.topIsQB"] = recs(proj, t2, SF, 13).recPlayers[0]?.position === "QB";
  // (c) 0RB / 4WR mine
  actuals["sf.c.topIsRB"] = recs(proj, mark(byProj(proj, "WR", SF).slice(0, 4), "mine"), SF, 11).recPlayers[0]?.position === "RB";
  // (d) 3 QBs + final-3 window
  actuals["sf.d.zeroQBs"] = !recs(proj, mark(qb(3), "mine"), SF, 3).recPlayers.some((p) => p.position === "QB");
  // (e) 2 QBs + final-3 window → eligible
  actuals["sf.e.qbEligible"] = !recs(proj, mark(qb(2), "mine"), SF, 3).diag.qbSuppressed;
}
// 10. Bye-stacking (synthetic byes injected — the frozen snapshot predates
//     the byeWeek field, and synthetic assignment keeps these deterministic)
{
  const withBye = (p: NflDbPlayer, byeWeek: number): NflDbPlayer => ({ ...p, byeWeek });
  const rbs = byProj(proj, "RB", SF);
  const wrs = byProj(proj, "WR", SF);
  // (a) Near-tie: top-2 RBs are within ~5% (209.2 vs 200.1 adj in SF).
  //     Give the higher one bye 7 and 3 of my players bye 7 → ×0.85 must
  //     flip green to the bye-10 rival.
  {
    const players = proj.map((p) => {
      if (p.id === rbs[0].id) return withBye(p, 7);
      if (p.id === rbs[1].id) return withBye(p, 10);
      if ([wrs[0].id, wrs[1].id, wrs[2].id].includes(p.id)) return withBye(p, 7);
      return p;
    });
    const taken = mark([wrs[0], wrs[1], wrs[2]].map((w) => players.find((p) => p.id === w.id)!), "mine");
    const r = recs(players, taken, SF, 10, [rbs[0].id, rbs[1].id]);
    actuals["bye.neartie.greenIsBye10"] = r.recPlayers[0]?.id === rbs[1].id;
    // Reported scores: both are RB rank 1-2 in the full pool → ×1.30 scarcity;
    // the bye-7 candidate additionally takes ×0.85 (3 same-bye players held).
    actuals["bye.neartie.scoreBye7"] = +((r.diag.probeBaseVar[rbs[0].id] ?? 0) * 1.30 * 0.85).toFixed(1);
    actuals["bye.neartie.scoreBye10"] = +((r.diag.probeBaseVar[rbs[1].id] ?? 0) * 1.30).toFixed(1);
  }
  // (b) 25%+ clear: same 3×bye-7 roster, but the bye-7 candidate has no
  //     near rival (next alternatives league-taken) → stays green despite ×0.85.
  {
    const players = proj.map((p) => (p.id === rbs[0].id ? withBye(p, 7) :
      [wrs[0].id, wrs[1].id, wrs[2].id].includes(p.id) ? withBye(p, 7) : p));
    const taken = mark([wrs[0], wrs[1], wrs[2]].map((w) => players.find((p) => p.id === w.id)!), "mine");
    // Remove near rivals INCLUDING the top superflex QB (who otherwise
    // outboosts the penalized RB) so the bye-7 candidate is 20%+ clear.
    const qbs = byProj(proj, "QB", SF);
    for (const rival of [rbs[1], rbs[2], rbs[3], qbs[0]]) taken[rival.id] = "league";
    const r = recs(players, taken, SF, 10);
    actuals["bye.clear.staysGreen"] = r.recPlayers[0]?.id === rbs[0].id;
  }
  // (c) Zero bye overlap (≤1 same-bye) → recIds identical to no-bye-data run.
  {
    const playersNoBye = proj;
    const playersBye = proj.map((p, i) => ({ ...p, byeWeek: (i % 14) + 5 })); // spread byes broadly
    const mine = [rbs[0], wrs[0]];
    // Force the two Mine players onto DIFFERENT byes so no 2+ stack exists
    playersBye.find((p) => p.id === rbs[0].id)!.byeWeek = 5;
    playersBye.find((p) => p.id === wrs[0].id)!.byeWeek = 6;
    const a = recs(playersNoBye, mark(mine.map((m) => playersNoBye.find((p) => p.id === m.id)!), "mine"), SF, 10);
    const b = recs(playersBye, mark(mine.map((m) => playersBye.find((p) => p.id === m.id)!), "mine"), SF, 10);
    // Strict: with no 2+ same-bye stack, penalties are all ×1 and the rec
    // list must be byte-identical to the run with no bye data at all.
    actuals["bye.zerooverlap.identical"] =
      JSON.stringify(a.recIds) === JSON.stringify(b.recIds) &&
      Object.values(b.diag.myByeCounts).every((n) => n < 2);
  }
}

// 11. Starter-urgency tiers (BTM league — the 2026-09-08 live bug repro)
const btmDetail: string[] = [];
{
  const b = bars(proj, BTM);
  const rbB = byProj(proj, "RB", BTM), wrB = byProj(proj, "WR", BTM), teB = byProj(proj, "TE", BTM);
  const lamar = find(proj, "Lamar Jackson");
  // Rec score replicated for reporting/expectations: baseVAR × full-pool
  // RB/TE scarcity (no byes in snapshot, discount off, QB suppressed).
  const scarRank = new Map<number, number>();
  for (const pos of ["RB", "TE"] as const) {
    proj.filter((p) => p.position === pos).sort((x, y) => varOf(y, proj, BTM, b) - varOf(x, proj, BTM, b))
      .forEach((p, i) => scarRank.set(p.id, i + 1));
  }
  const score = (p: NflDbPlayer) => varOf(p, proj, BTM, b) *
    (p.position === "RB" ? rbScarcityMultiplier(scarRank.get(p.id) ?? 999) :
     p.position === "TE" ? teScarcityMultiplier(scarRank.get(p.id) ?? 999) : 1);
  const detail = (label: string, r: ReturnType<typeof recs>) => {
    btmDetail.push(`  ${label}: guard=${r.diag.feasibilityGuard} tiers ` +
      `RB=${r.diag.tierByPos.RB} WR=${r.diag.tierByPos.WR} TE=${r.diag.tierByPos.TE}`);
    r.recPlayers.forEach((p, i) => btmDetail.push(
      `    rec${i + 1}: ${p.position} ${p.name}  tier=${r.diag.tierByPos[p.position]}  ` +
      `VAR=${varOf(p, proj, BTM, b).toFixed(1)}  score=${score(p).toFixed(1)}`));
  };

  // (1) Live bug repro: Lamar + 4 RBs, 0 WR, 0 TE, ~5 rounds gone.
  const taken1 = mark([lamar, rbB[3], rbB[9], rbB[15], rbB[21]], "mine");
  const allByProjB = [...proj].sort((x, y) =>
    projectedNflValue(y, BTM.weights, false) - projectedNflValue(x, BTM.weights, false));
  let n = 0;
  for (const p of allByProjB) { if (n >= 55) break; if (!taken1[p.id]) { taken1[p.id] = "league"; n++; } }
  const r1 = recs(proj, taken1, BTM, 10);
  actuals["btm.s1.onlyWrTe"] = r1.recPlayers.length === 5 &&
    r1.recPlayers.every((p) => p.position === "WR" || p.position === "TE");
  detail("s1 Lamar+4RB 0WR/0TE", r1);

  // (2) Starters filled (Lamar + 2RB + 2WR + 1TE): every skill position is
  // tier 2, so the green must be the global best rec score among them.
  const taken2 = mark([lamar, rbB[3], rbB[9], wrB[3], wrB[9], teB[2]], "mine");
  const r2 = recs(proj, taken2, BTM, 9);
  const expectGreen = proj
    .filter((p) => (p.position === "RB" || p.position === "WR" || p.position === "TE") && !taken2[p.id])
    .sort((x, y) => score(y) - score(x))[0];
  actuals["btm.s2.bestVarWins"] =
    r2.diag.tierByPos.RB === 2 && r2.diag.tierByPos.WR === 2 && r2.diag.tierByPos.TE === 2 &&
    r2.recPlayers[0]?.id === expectGreen.id;
  detail("s2 starters filled", r2);

  // (3) Empty roster, round 1: identical to the pre-tier pin.
  const taken3 = mark(allByProjB.slice(0, 11), "league");
  const r3 = recs(proj, taken3, BTM, 15);
  actuals["btm.s3.roundOneUnchanged"] =
    JSON.stringify(r3.recIds) === JSON.stringify(BTM_S3_PRE_TIER_RECIDS);

  // (4) Feasibility guard: starters + flex filled, K and DST missing,
  // exactly 2 picks left → recommendations are exclusively K/DST.
  const taken4 = mark([lamar, rbB[3], rbB[9], rbB[15], wrB[3], wrB[9], teB[2]], "mine");
  const r4 = recs(proj, taken4, BTM, 2);
  actuals["btm.s4.onlyKDst"] = r4.diag.feasibilityGuard === true &&
    r4.recPlayers.length > 0 &&
    r4.recPlayers.every((p) => p.position === "K" || p.position === "DST");
  detail("s4 guard: 2 picks left, K+DST open", r4);
}

// 9. One-engine consistency: rankings VAR === rec-layer base VAR (5 samples)
{
  const b = bars(proj, KEP);
  const samples = [byProj(proj, "QB", KEP)[0], byProj(proj, "RB", KEP)[0], byProj(proj, "WR", KEP)[3],
    byProj(proj, "TE", KEP)[1], byProj(proj, "WR", KEP)[40]];
  const r = recs(proj, {}, KEP, 10, samples.map((p) => p.id));
  actuals["consistency.rankingsEqualsRec"] = samples.every(
    (p) => Math.abs(varOf(p, proj, KEP, b) - (r.diag.probeBaseVar[p.id] ?? NaN)) < 1e-9);
}

// ── Capture mode ─────────────────────────────────────────────
if (CAPTURE) {
  console.log("Captured actuals (pin these in fixtures.mts):\n");
  console.log(JSON.stringify(actuals, null, 2));
  process.exit(0);
}

// ── Verify against fixtures ──────────────────────────────────
let failed = 0;
const rows: string[] = [];
for (const f of FIXTURES) {
  const actual = actuals[f.key];
  let pass: boolean;
  let expectedStr: string;
  if (f.kind === "range") {
    pass = typeof actual === "number" && actual >= f.min && actual <= f.max;
    expectedStr = `${f.min} .. ${f.max}`;
  } else if (f.kind === "exact") {
    pass = actual === f.value;
    expectedStr = String(f.value);
  } else {
    pass = actual === true;
    expectedStr = "true";
  }
  if (!pass) failed++;
  rows.push(
    `${pass ? "PASS" : "FAIL"}  ${f.key.padEnd(30)} actual ${String(actual).padStart(8)}   expected ${expectedStr.padEnd(16)} ${f.note}`
  );
}
console.log(`NFL engine verification — snapshot ${SNAP.capturedAt.slice(0, 10)} (proj ${SNAP.projSeasonId}, last ${SNAP.lastSeasonId})\n`);
for (const r of rows) console.log(r);
if (btmDetail.length) {
  console.log("\nBTM starter-urgency detail:");
  for (const line of btmDetail) console.log(line);
}
console.log(`\n${FIXTURES.length - failed}/${FIXTURES.length} passed${failed ? ` — ${failed} FAILED` : ""}`);
process.exit(failed > 0 ? 1 : 0);
