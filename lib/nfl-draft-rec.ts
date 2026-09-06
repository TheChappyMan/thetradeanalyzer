import type { NflDbPlayer, NflPlayerPosition, NflRoster, NflScoringWeights } from './nfl-types'
import {
  projectedNflValue,
  valueAboveReplacement,
  rbScarcityMultiplier,
  teScarcityMultiplier,
  nflInjuryMultiplier,
} from './nfl-valuation'

// ============================================================
// NFL DRAFT MODE — RECOMMENDATION LAYER
// ============================================================
// Extracted from app/rankings/NflRankings.tsx so the verification harness
// (scripts/verify-nfl) exercises the exact code the UI runs — never a copy.
// Pure function: no React, no fetching.
//
// Design decisions this encodes (see git log for the debugging history):
// - Bars and scarcity ranks use the FULL pool, not the available pool:
//   per-available bars fall fastest at whichever position the board (and
//   the user) drafted most, inverting positional need, and
//   rank-1-of-available pins elite multipliers on leftover players.
// - QB tiers: starter slots open (dedicated + superflex) → full need
//   priority with the superflex value boost. Starters filled → QBs hard
//   suppressed from all badge tiers until the final 3 owned picks, and
//   only below a hard cap of starters + 1 insurance QB (superflex 3,
//   1QB 2) — at the cap, suppressed through the end of the draft.
// - K/DST: suppressed until the final two owned picks (or all skill needs
//   covered); in the final two picks, unfilled K/DST slots lead the list.

// A player at a position the roster already covers is only recommended when
// its value overwhelms the best need-filling option by this factor.
export const NFL_REC_OVERWHELM = 1.5

export type NflDraftRecInput = {
  playerDb: NflDbPlayer[]
  taken: Record<number, 'league' | 'mine'>
  /** Full-pool replacement bars — the same map the rankings table uses. */
  replacementLevels: Map<NflPlayerPosition, number>
  weights: NflScoringWeights
  roster: NflRoster
  qbFormat: '1QB' | '2QB'
  teams: number
  useRates: boolean
  availabilityDiscountActive: boolean
  picksRemaining: number
  /** Optional: ids whose internal base VAR should be reported (harness). */
  probeIds?: number[]
}

export type NflDraftRecResult = {
  /** Ordered candidate ids for the badge tiers (green, 2× amber, 2× orange). */
  recIds: number[]
  diag: {
    qbSuppressed: boolean
    qbStartersOpen: boolean
    allowKDst: boolean
    needsByPos: Record<string, boolean>
    /** Internal base VAR for each requested probeId. */
    probeBaseVar: Record<number, number>
  }
}

export function computeNflDraftRecs(input: NflDraftRecInput): NflDraftRecResult {
  const {
    playerDb, taken, replacementLevels, weights, roster, qbFormat,
    useRates, availabilityDiscountActive, picksRemaining, probeIds,
  } = input

  const available = playerDb.filter((p) => taken[p.id] === undefined)

  const projOf = new Map(playerDb.map((p) => [p.id, projectedNflValue(p, weights, useRates)]))
  const baseVar = (p: NflDbPlayer) =>
    valueAboveReplacement(projOf.get(p.id) ?? 0, replacementLevels.get(p.position) ?? 0)

  // RB/TE/QB scarcity multipliers by VAR rank across the FULL pool —
  // drafting the RB1 does not turn RB20 into an "elite" RB1.
  const scarcityRank = new Map<number, number>()
  for (const pos of ['RB', 'TE', 'QB'] as const) {
    playerDb
      .filter((p) => p.position === pos)
      .sort((a, b) => baseVar(b) - baseVar(a))
      .forEach((p, i) => scarcityRank.set(p.id, i + 1))
  }

  // In 2QB/Superflex the second QB slot counts as a dedicated QB slot
  // (superflex drafts fill it with a QB by value).
  const qbSlots = qbFormat === '2QB' ? Math.max(roster.QB ?? 1, 2) : (roster.QB ?? 1)
  const mine = playerDb.filter((p) => taken[p.id] === 'mine')
  const myQBs = mine.filter((p) => p.position === 'QB').length

  const qbStartersOpen = myQBs < qbSlots
  // Hard cap: starters + 1 insurance QB. At the cap, QB stays suppressed
  // through the end of the draft — the final-picks window must not
  // re-enable a 4th superflex QB.
  const qbCap = qbSlots + 1
  const finalPicksWindow = picksRemaining > 0 && picksRemaining <= 3 && myQBs < qbCap
  const qbSuppressed = !qbStartersOpen && !finalPicksWindow

  // Superflex/2QB: QBs are the scarcest superflex asset; mirror the RB/TE
  // market-calibration tiers so top QBs surface early. Turns off once the
  // starter slots are filled (a bench QB competes at face value).
  const qbSuperflexMultiplier = (rank: number): number =>
    rank <= 5 ? 1.40 : rank <= 10 ? 1.25 : rank <= 15 ? 1.10 : 1.0
  const adjVar = (p: NflDbPlayer) => {
    let v = baseVar(p) * nflInjuryMultiplier(p.injuryStatus, availabilityDiscountActive)
    const rank = scarcityRank.get(p.id)
    if (!rank) return v
    if (p.position === 'RB') v *= rbScarcityMultiplier(rank)
    else if (p.position === 'TE') v *= teScarcityMultiplier(rank)
    else if (p.position === 'QB' && qbFormat === '2QB' && qbStartersOpen) {
      v *= qbSuperflexMultiplier(rank)
    }
    return v
  }

  // Positional targets: starters + bench share, mirroring the engine's
  // bench-aware replacement (1 bench to QB, rest proportional RB/WR/TE).
  const bench = roster.BN ?? 0
  const qbBench = Math.min(1, bench)
  const remainingBench = Math.max(0, bench - qbBench)
  const flex = roster.FLEX ?? 0
  const rbSF = (roster.RB ?? 0) + flex * 0.5
  const wrSF = (roster.WR ?? 0) + flex * 0.4
  const teSF = (roster.TE ?? 0) + flex * 0.1
  const sfTotal = rbSF + wrSF + teSF
  const benchFor = (sf: number) => (sfTotal > 0 ? remainingBench * (sf / sfTotal) : 0)
  const target: Record<NflPlayerPosition, number> = {
    QB: qbSlots + qbBench,
    RB: rbSF + benchFor(rbSF),
    WR: wrSF + benchFor(wrSF),
    TE: teSF + benchFor(teSF),
    K: roster.K ?? 0,
    DST: roster.DST ?? 0,
  }
  const myCount: Record<string, number> = {}
  for (const p of mine) myCount[p.position] = (myCount[p.position] ?? 0) + 1

  // QB need is starters-only: once the dedicated (and superflex) slots are
  // filled, a QB is never a "need" — the hard suppression above governs
  // whether he can appear at all.
  const needs = (pos: NflPlayerPosition) =>
    pos === 'QB' ? qbStartersOpen : (myCount[pos] ?? 0) < target[pos] - 1e-9

  // K/DST suppression: never recommend until my final two owned picks,
  // unless every skill-position need is already fully covered.
  const skillNeedsRemain = (['QB', 'RB', 'WR', 'TE'] as const).some(needs)
  const allowKDst = picksRemaining > 0 && (picksRemaining <= 2 || !skillNeedsRemain)

  const candidates = available.filter((p) =>
    p.position === 'K' || p.position === 'DST' ? allowKDst :
    p.position === 'QB' ? !qbSuppressed : true)
  const scored = candidates
    .map((p) => ({ p, value: adjVar(p), need: needs(p.position) }))
    .sort((a, b) => b.value - a.value)
  const bestNeed = scored.find((s) => s.need)?.value ?? 0
  let recs = scored
    .filter((s) => s.need || s.value >= bestNeed * NFL_REC_OVERWHELM)
    .slice(0, 5)

  // Final two owned picks: unfilled K/DST slots lead the recommendations
  // (raw VAR would keep burying them under leftover skill players).
  if (picksRemaining > 0 && picksRemaining <= 2) {
    const kdBest = (['K', 'DST'] as const)
      .filter(needs)
      .map((pos) => scored.find((s) => s.p.position === pos))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
    if (kdBest.length > 0) {
      const rest = recs.filter((r) => !kdBest.includes(r))
      recs = [...kdBest, ...rest].slice(0, 5)
    }
  }

  const probeBaseVar: Record<number, number> = {}
  for (const id of probeIds ?? []) {
    const p = playerDb.find((x) => x.id === id)
    if (p) probeBaseVar[id] = baseVar(p)
  }

  return {
    recIds: recs.map((r) => r.p.id),
    diag: {
      qbSuppressed,
      qbStartersOpen,
      allowKDst,
      needsByPos: {
        QB: needs('QB'), RB: needs('RB'), WR: needs('WR'),
        TE: needs('TE'), K: needs('K'), DST: needs('DST'),
      },
      probeBaseVar,
    },
  }
}
