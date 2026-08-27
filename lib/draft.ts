/**
 * Draft-pick helpers shared by the Settings pick-list builder and the
 * Rankings Draft Mode. Picks use the same round.slot format ("1.09")
 * as the analyzer's pick valuation, where slot is the position within
 * the round (snake order is baked into the generated slot numbers).
 */

export type DraftFormat = 'snake' | 'linear'

/** Draft-pick configuration saved inside a league's settings (NHL and NFL). */
export type DraftPicksConfig = {
  teams: number
  slot: number
  format: DraftFormat
  /** Owned picks in round.slot format, e.g. ["1.09", "2.04"]. */
  picks: string[]
}

/**
 * Number of draft rounds a league needs: every non-IR roster spot.
 * Works for any sport's roster record (NHL uses IR/IRplus, NFL uses IR).
 */
const NON_DRAFTABLE_SLOTS = new Set(['IR', 'IRplus'])
export function draftRounds(roster: Record<string, number>): number {
  return Object.entries(roster).reduce(
    (sum, [slot, n]) => (NON_DRAFTABLE_SLOTS.has(slot) ? sum : sum + (n || 0)),
    0
  )
}

/** Generate the full pick list for one team (before any pick trades). */
export function generateDraftPicks(
  teams: number,
  slot: number,
  format: DraftFormat,
  rounds: number
): string[] {
  const picks: string[] = []
  for (let r = 1; r <= rounds; r++) {
    const pos = format === 'linear' || r % 2 === 1 ? slot : teams + 1 - slot
    picks.push(`${r}.${String(pos).padStart(2, '0')}`)
  }
  return picks
}

export type ParsedDraftPick = { raw: string; round: number; slot: number; overall: number }

/** Parse "round.slot" into overall pick number; null if invalid for the league size. */
export function parseDraftPick(raw: string, teams: number): ParsedDraftPick | null {
  const m = raw.trim().match(/^(\d+)\.(\d+)$/)
  if (!m) return null
  const round = parseInt(m[1], 10)
  const slot = parseInt(m[2], 10)
  if (round < 1 || slot < 1 || slot > teams) return null
  return { raw: raw.trim(), round, slot, overall: (round - 1) * teams + slot }
}
