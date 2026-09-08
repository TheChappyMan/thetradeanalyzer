/**
 * Pinned expectations for the NFL verification harness (verify-nfl.mts).
 *
 * Values captured 2026-09-05 against snapshot.json (same date) with the
 * engine at commit 6e3f090. To re-pin after a DELIBERATE engine change:
 *   1. npm run verify:nfl -- --capture
 *   2. Copy the printed actuals into the fixtures below (keep the ranges'
 *      relative tolerances) and update this header's date/commit.
 * Never re-pin to make an unexplained FAIL go away — that's the regression
 * the harness exists to catch.
 */
import { DEFAULT_NFL_LEAGUE, type NflRoster, type NflScoringWeights } from "../../lib/nfl-types";

// ── League fixtures ──────────────────────────────────────────

/** KEP League: 10 teams, redraft, 1QB, Full PPR, deep bench (BN 11). */
export const KEP = {
  teams: 10, qbFormat: "1QB" as const,
  roster: { ...DEFAULT_NFL_LEAGUE.roster, QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, K: 0, DST: 0, BN: 11, IR: 0 } as NflRoster,
  weights: { ...DEFAULT_NFL_LEAGUE.scoringWeights, rec: 1 } as NflScoringWeights,
};

/** SF League: 8 teams, superflex (1QB+1SF) — the 2026-09 Draft Mode debug config. */
export const SF = {
  teams: 8, qbFormat: "2QB" as const,
  roster: { ...DEFAULT_NFL_LEAGUE.roster, QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, K: 1, DST: 1, BN: 5, IR: 0 } as NflRoster,
  weights: DEFAULT_NFL_LEAGUE.scoringWeights,
};

/** Boys to Men League: 12 teams, half PPR, 1QB — the 2026-09-08 live bug
 *  config ("5th RB recommended over 0 WR / 0 TE"). */
export const BTM = {
  teams: 12, qbFormat: "1QB" as const,
  roster: { ...DEFAULT_NFL_LEAGUE.roster, QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6, IR: 0 } as NflRoster,
  weights: DEFAULT_NFL_LEAGUE.scoringWeights, // half PPR default
};

/** BTM empty-roster round-1 recIds pinned BEFORE the starter-urgency tiers
 *  (captured at commit 4471eb2, snapshot 2026-09-05): CMC, Taylor, Cook,
 *  Henry, Achane. The tiers must not change round-1 behavior. */
export const BTM_S3_PRE_TIER_RECIDS = [86336, 86855, 71177, 51690, 28168];

// ── Scenario expectations ────────────────────────────────────

export type Fixture =
  | { key: string; kind: "range"; min: number; max: number; note: string }
  | { key: string; kind: "exact"; value: number | boolean; note: string }
  | { key: string; kind: "true"; note: string };

export const FIXTURES: Fixture[] = [
  // 1. KEP replacement bars — guards the diminishing bench weight (d6781c9).
  //    Ranks ±3; points ±10% of pinned.
  { key: "kep.bar.QB.rank",   kind: "range", min: 18,    max: 24,    note: "bench-weight bars (d6781c9): QB21" },
  { key: "kep.bar.QB.points", kind: "range", min: 231.2, max: 282.6, note: "QB bar 256.9 ±10%" },
  { key: "kep.bar.RB.rank",   kind: "range", min: 39,    max: 45,    note: "bench-weight bars: RB42" },
  { key: "kep.bar.RB.points", kind: "range", min: 115.1, max: 140.7, note: "RB bar 127.9 ±10%" },
  { key: "kep.bar.WR.rank",   kind: "range", min: 50,    max: 56,    note: "bench-weight bars: WR53 (was WR87 pre-fix)" },
  { key: "kep.bar.WR.points", kind: "range", min: 140.8, max: 172.0, note: "WR bar 156.4 ±10%" },
  { key: "kep.bar.TE.rank",   kind: "range", min: 15,    max: 21,    note: "bench-weight bars: TE18" },
  { key: "kep.bar.TE.points", kind: "range", min: 135.8, max: 166.0, note: "TE bar 150.9 ±10%" },

  // 2. McConkey window — bench-weight calibration target (d6781c9).
  { key: "kep.mcconkey.var", kind: "range", min: 60, max: 85, note: "McConkey VAR window (spec: 60-85; pinned 71.8)" },

  // 3. Pick values ±15% — guards talent-ranking + bar interactions.
  { key: "kep.pick2_10.var",  kind: "range", min: 79.9, max: 108.1, note: "pick 2.10 (overall 20) = 94.0 ±15%" },
  { key: "kep.pick12_02.var", kind: "range", min: 8.6,  max: 11.6,  note: "pick 12.02 (overall 112) = 10.1 ±15%" },

  // 4. Reference trade (give Jacobs + 2.10, get McConkey + 12.02) ±10 pts.
  //    Last-year mode also exercises the availability discount (e63eff3).
  { key: "kep.trade.proj.rating", kind: "range", min: 59.1, max: 79.1, note: "trade rating, projected = 69.1 ±10" },
  { key: "kep.trade.last.rating", kind: "range", min: 0,    max: 10.9, note: "trade rating, last-year = 0.9 ±10" },

  // 5. Mahomes-bug regression: top healthy QB must never zero out
  //    (zero-floor/replacement-baseline work, 9743744 / 58a7bff).
  { key: "kep.topqb.var", kind: "range", min: 1, max: 100000, note: "top healthy QB VAR > 0 (pinned 90.6)" },

  // 6. effectiveBenchSlots exact table (d6781c9).
  { key: "bench.eff.2",  kind: "exact", value: 2,   note: "BN2 → 2.0" },
  { key: "bench.eff.3",  kind: "exact", value: 3,   note: "BN3 → 3.0" },
  { key: "bench.eff.4",  kind: "exact", value: 3.5, note: "BN4 → 3.5" },
  { key: "bench.eff.5",  kind: "exact", value: 4,   note: "BN5 → 4.0" },
  { key: "bench.eff.11", kind: "exact", value: 4,   note: "BN11 → 4.0 (deep benches capped)" },

  // 7. BN=3: bench weighting must be a byte-identical no-op.
  { key: "bench.bn3.noop", kind: "true", note: "weighting no-op at BN=3 (d6781c9)" },

  // 8. Draft Mode behavior (SF league) — the real lib/nfl-draft-rec.ts.
  { key: "sf.a.topIsNeedWR", kind: "true", note: "5RB/3WR roster → need WR green (full-pool bars, de4fc1f)" },
  { key: "sf.a.zeroQBs",     kind: "true", note: "2 QBs held → zero QBs any tier (b18968a)" },
  { key: "sf.a.noKDst",      kind: "true", note: "K/DST absent mid-draft" },
  { key: "sf.b.topIsQB",     kind: "true", note: "empty roster in SF → QB green" },
  { key: "sf.c.topIsRB",     kind: "true", note: "0RB/4WR roster → RB green" },
  { key: "sf.d.zeroQBs",     kind: "true", note: "3 QBs + final-3 window → still zero QBs (cap, 6e3f090)" },
  { key: "sf.e.qbEligible",  kind: "true", note: "2 QBs + final-3 window → QB eligible again" },

  // 10. Bye-stacking (soft rec-score penalty; BYE_STACK_PENALTY in
  //     lib/nfl-draft-rec.ts). Synthetic byes injected by the harness.
  { key: "bye.neartie.greenIsBye10", kind: "true", note: "3 same-bye held: x0.85 flips a ~4.5% near-tie to the bye-10 rival" },
  { key: "bye.neartie.scoreBye7",  kind: "range", min: 151.1, max: 204.5, note: "penalized score 177.8 +-15% (Gibbs x1.30 x0.85)" },
  { key: "bye.neartie.scoreBye10", kind: "range", min: 170.1, max: 230.1, note: "rival score 200.1 +-15% (Bijan x1.30)" },
  { key: "bye.clear.staysGreen",   kind: "true", note: "20%+ clear candidate stays green despite worst bye penalty" },
  { key: "bye.zerooverlap.identical", kind: "true", note: "<=1 same-bye: recs byte-identical to no-bye-data run" },

  // 9. One-engine consistency: rankings VAR === rec-layer base VAR
  //    (available-pool divergence bug, de4fc1f).
  { key: "consistency.rankingsEqualsRec", kind: "true", note: "rankings path === rec layer, 5 samples" },

  // 11. Starter-urgency tiers (BTM league — 2026-09-08 live bug).
  { key: "btm.s1.onlyWrTe",         kind: "true", note: "Lamar+4RB, 0WR/0TE: recs contain ONLY WR/TE (tier 1 beats RB tier 3)" },
  { key: "btm.s2.bestVarWins",      kind: "true", note: "starters filled (all tier 2): green = global best rec score" },
  { key: "btm.s3.roundOneUnchanged", kind: "true", note: "empty roster rd 1: recIds identical to pre-tier pin" },
  { key: "btm.s4.onlyKDst",         kind: "true", note: "2 picks left, K+DST missing: feasibility guard, K/DST only" },
];
