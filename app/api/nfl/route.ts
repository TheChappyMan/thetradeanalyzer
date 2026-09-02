import { NextResponse } from 'next/server'
import type { NflDbPlayer, NflPlayerPosition, NflPlayerStats } from '@/lib/nfl-types'
import nflPlayersJson from '@/lib/nfl-players.json'
import nflProjectionsJson from '@/lib/nfl-projections.json'

// ── NFL API Proxy ────────────────────────────────────────────────────────────
// Fetches live data from the Sleeper API at request time, matching the
// pattern used by /api/nhl and /api/mlb. The old ESPN path (which returned
// nothing usable and cost a 5s timeout per load) has been removed.
//
//   GET /api/nfl?endpoint=all-seasons   (preferred)
//     → { currentSeason: { seasonId, players, source, hasData },
//         priorSeason:   { seasonId, players, source, hasData },
//         fallbackGeneratedAt?: string }
//
//   GET /api/nfl                        (legacy: current season only)
//     → { data: NflDbPlayer[], source: 'sleeper' | 'fallback' }
//
// Cache lifetimes (per Sleeper's guidance not to poll the large player
// metadata endpoint frequently):
//   player metadata  → revalidate 86400 (daily)
//   weekly stats     → revalidate 3600  (hourly)
//
// lib/nfl-players.json remains ONLY as a last-resort fallback when Sleeper
// is unreachable; the client surfaces a staleness warning when it is used.

const SLEEPER   = 'https://api.sleeper.app/v1'
const NFL_WEEKS = 18

// ── Position caps ────────────────────────────────────────────────────────────
// Sleeper's database contains thousands of irrelevant players; caps keep the
// payload sane. Sized ≥20% above the deepest plausible bench-aware
// replacement level (14-team, 11-bench ≈ 95 RB / 120 WR effective).
const POS_LIMITS: Record<string, number> = {
  QB: 60, RB: 120, WR: 160, TE: 70, K: 32, DST: 32,
}
const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])

// ── Season helpers ───────────────────────────────────────────────────────────
// The NFL season is labelled by its starting year and begins in early
// September: the 2026 season spans Sept 2026 – Jan 2027. Before September we
// are still in the prior season's data year (July 2026 → season 2025).
function computeCurrentNflSeason(): number {
  const now = new Date()
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

// ── Sleeper fetch helpers ────────────────────────────────────────────────────

type SleeperMeta = Record<string, {
  status?: string
  team?: string | null
  position?: string
  fantasy_positions?: string[]
  full_name?: string
  first_name?: string
  last_name?: string
  injury_status?: string | null
}>

// The metadata payload is ~14 MB — over Next's 2 MB fetch-cache limit, so
// `revalidate` alone will not cache it. A module-level in-memory cache keeps
// it for 24h on warm server instances (cold starts refetch once).
let metaCache: { data: SleeperMeta; fetchedAt: number } | null = null
const META_TTL_MS = 86_400_000

async function fetchPlayerMeta(): Promise<SleeperMeta | null> {
  if (metaCache && Date.now() - metaCache.fetchedAt < META_TTL_MS) {
    return metaCache.data
  }
  try {
    const res = await fetch(`${SLEEPER}/players/nfl`, { next: { revalidate: 86400 } })
    if (!res.ok) return metaCache?.data ?? null
    const data = (await res.json()) as SleeperMeta
    metaCache = { data, fetchedAt: Date.now() }
    return data
  } catch {
    return metaCache?.data ?? null
  }
}

async function fetchWeek(season: number, week: number): Promise<Record<string, Record<string, number>> | null> {
  try {
    const res = await fetch(`${SLEEPER}/stats/nfl/regular/${season}/${week}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    return (await res.json()) as Record<string, Record<string, number>>
  } catch {
    return null
  }
}

// ── Season aggregation (ported from scripts/fetch-nfl-players.mjs) ─────────

type SeasonTotals = {
  totals: Record<string, Record<string, number>>
  gpCounts: Record<string, number>
}

async function fetchSeasonStats(season: number): Promise<SeasonTotals> {
  const weeks = await Promise.all(
    Array.from({ length: NFL_WEEKS }, (_, i) => fetchWeek(season, i + 1))
  )
  const totals: Record<string, Record<string, number>> = {}
  const gpCounts: Record<string, number> = {}

  for (const weekData of weeks) {
    if (!weekData) continue
    for (const [pid, stats] of Object.entries(weekData)) {
      if (!stats || typeof stats !== 'object') continue
      const played = Object.values(stats).some((v) => typeof v === 'number' && v > 0)
      if (!totals[pid]) totals[pid] = {}
      if (!gpCounts[pid]) gpCounts[pid] = 0
      if (played) gpCounts[pid]++

      for (const [key, val] of Object.entries(stats)) {
        if (typeof val === 'number') {
          totals[pid][key] = (totals[pid][key] ?? 0) + val
        }
      }
      // Yard-bonus game counts derived from weekly yardage so every
      // threshold is covered (Sleeper only pre-computes a few of them).
      for (const [statKey, calcPrefix] of [
        ['pass_yd', 'calc_bonus_pass_yd'],
        ['rush_yd', 'calc_bonus_rush_yd'],
        ['rec_yd',  'calc_bonus_rec_yd'],
      ] as const) {
        const yds = stats[statKey]
        if (typeof yds !== 'number') continue
        for (const thr of [100, 150, 200, 250, 300]) {
          if (yds >= thr) {
            const k = `${calcPrefix}_${thr}`
            totals[pid][k] = (totals[pid][k] ?? 0) + 1
          }
        }
      }
    }
  }
  return { totals, gpCounts }
}

// ── Projections (UNDOCUMENTED Sleeper endpoints) ────────────────────────────
// api.sleeper.com/projections/nfl/<season>?season_type=regular       (season)
// api.sleeper.com/projections/nfl/<season>/<week>?season_type=regular (weekly)
// These are not in docs.sleeper.com and could change without notice, so every
// response is shape-validated before use and wrapped in the same stamped-
// fallback pattern as the player data: last good response is cached in-memory
// with a timestamp; on failure we serve that snapshot (marked stale), and as
// a last resort the committed lib/nfl-projections.json snapshot.
// Projections return raw stat lines in the SAME key space as the stats
// endpoints (pass_yd, rush_td, rec, ...), so league scoring applies directly.
// Known gaps, handled below: DEF rows lack pts_allow (backfilled from the
// previous season's actuals) and kickers report fgmiss_* instead of fga_*.

const SLEEPER_PROJ = 'https://api.sleeper.com/projections/nfl'
const PROJ_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

type NflState = { season: string; week: number; seasonType: string; previousSeason: string }

async function fetchNflState(): Promise<NflState | null> {
  try {
    const res = await fetch(`${SLEEPER}/state/nfl`, { next: { revalidate: 3600 } })
    if (!res.ok) return null
    const s = (await res.json()) as Record<string, unknown>
    if (typeof s.season !== 'string' || typeof s.week !== 'number') return null
    return {
      season: s.season,
      week: s.week,
      seasonType: typeof s.season_type === 'string' ? s.season_type : 'regular',
      previousSeason:
        typeof s.previous_season === 'string' ? s.previous_season : String(Number(s.season) - 1),
    }
  } catch {
    return null
  }
}

/**
 * Validate + aggregate projection rows into the SeasonTotals shape used by
 * buildPlayers. Returns null when the response doesn't look like projections
 * (wrong shape, or suspiciously few valid rows) so callers fall back.
 * When `deriveBonuses` is true (weekly rows), yard-bonus game counts are
 * accumulated from each week's projected yardage, mirroring fetchSeasonStats.
 */
function projectionRowsToTotals(
  rows: unknown,
  into?: SeasonTotals,
  deriveBonuses = false
): SeasonTotals | null {
  if (!Array.isArray(rows)) return null
  const acc: SeasonTotals = into ?? { totals: {}, gpCounts: {} }
  let valid = 0
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const pid = (row as { player_id?: unknown }).player_id
    const stats = (row as { stats?: unknown }).stats
    if (typeof pid !== 'string' || !stats || typeof stats !== 'object') continue
    valid++
    const t = (acc.totals[pid] ??= {})
    for (const [key, val] of Object.entries(stats as Record<string, unknown>)) {
      if (typeof val === 'number' && !key.startsWith('adp')) {
        t[key] = (t[key] ?? 0) + val
      }
    }
    const gp = (stats as Record<string, unknown>).gp
    if (deriveBonuses) {
      acc.gpCounts[pid] = (acc.gpCounts[pid] ?? 0) + 1
      for (const [statKey, calcPrefix] of [
        ['pass_yd', 'calc_bonus_pass_yd'],
        ['rush_yd', 'calc_bonus_rush_yd'],
        ['rec_yd',  'calc_bonus_rec_yd'],
      ] as const) {
        const yds = (stats as Record<string, unknown>)[statKey]
        if (typeof yds !== 'number') continue
        for (const thr of [100, 150, 200, 250, 300]) {
          if (yds >= thr) t[`${calcPrefix}_${thr}`] = (t[`${calcPrefix}_${thr}`] ?? 0) + 1
        }
      }
    } else {
      acc.gpCounts[pid] = Math.min(18, Math.max(1,
        typeof gp === 'number' ? Math.round(gp) : 17))
    }
  }
  if (valid < 50) return null
  return acc
}

const projPositionParams = PROJ_POSITIONS.map((p) => `position[]=${p}`).join('&')

async function fetchSeasonProjections(season: string): Promise<SeasonTotals | null> {
  try {
    // Payload can exceed Next's 2 MB fetch-cache limit; the module-level
    // stamped cache below is the real cache layer.
    const res = await fetch(
      `${SLEEPER_PROJ}/${season}?season_type=regular&${projPositionParams}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    return projectionRowsToTotals(await res.json())
  } catch {
    return null
  }
}

async function fetchRestOfSeasonProjections(
  season: string,
  afterWeek: number
): Promise<SeasonTotals | null> {
  const weeks = Array.from({ length: NFL_WEEKS - afterWeek }, (_, i) => afterWeek + 1 + i)
  if (weeks.length === 0) return { totals: {}, gpCounts: {} }
  const acc: SeasonTotals = { totals: {}, gpCounts: {} }
  let anyValid = false
  for (const week of weeks) {
    try {
      const res = await fetch(
        `${SLEEPER_PROJ}/${season}/${week}?season_type=regular&${projPositionParams}`,
        { cache: 'no-store' }
      )
      if (!res.ok) continue
      if (projectionRowsToTotals(await res.json(), acc, true)) anyValid = true
    } catch { /* skip week */ }
  }
  return anyValid ? acc : null
}

/**
 * Sleeper's DEF projections carry no pts_allow, which would score every
 * defense as pitching shutouts. Backfill points allowed (and games) from
 * the most recent season with actual stats.
 */
function backfillDstPtsAllowed(proj: SeasonTotals, actuals: SeasonTotals): void {
  for (const abbr of NFL_TEAMS) {
    const t = (proj.totals[abbr] ??= {})
    if ((t.pts_allow ?? 0) === 0 && actuals.totals[abbr]?.pts_allow !== undefined) {
      t.pts_allow = actuals.totals[abbr].pts_allow
      proj.gpCounts[abbr] = actuals.gpCounts[abbr] ?? 17
    }
  }
}

type ProjectionsPayload = {
  seasonId: string
  week: number
  players: NflDbPlayer[]
  restOfSeason: NflDbPlayer[]
}

let projCache: { data: ProjectionsPayload; fetchedAt: number } | null = null
const PROJ_TTL_MS = 3_600_000

type ProjectionsFallbackJson = {
  generatedAt?: string | null
  seasonId: string
  week: number
  players: NflDbPlayer[]
  restOfSeason: NflDbPlayer[]
}
const PROJ_FALLBACK = nflProjectionsJson as ProjectionsFallbackJson

function projectionsResponse() {
  return (async () => {
    if (projCache && Date.now() - projCache.fetchedAt < PROJ_TTL_MS) {
      return NextResponse.json({
        ...projCache.data,
        source: 'sleeper',
        fetchedAt: new Date(projCache.fetchedAt).toISOString(),
      })
    }

    const [meta, state] = await Promise.all([fetchPlayerMeta(), fetchNflState()])
    if (meta && state) {
      // Completed regular-season weeks: 0 outside the regular season.
      const completedWeek = state.seasonType === 'regular' ? Math.max(0, state.week - 1) : 0
      const seasonProj = await fetchSeasonProjections(state.season)
      if (seasonProj) {
        // Backfill DEF pts_allow from the most recent season with actuals.
        const actualsYear = state.seasonType === 'pre' || completedWeek === 0
          ? Number(state.previousSeason)
          : Number(state.season)
        backfillDstPtsAllowed(seasonProj, await fetchSeasonStats(actualsYear))

        // Rest of season: remaining weekly projections summed. Pre-season
        // (or a failed weekly sweep) falls back to the full-season list.
        let restPlayers: NflDbPlayer[] | null = null
        if (completedWeek > 0) {
          const rest = await fetchRestOfSeasonProjections(state.season, completedWeek)
          if (rest) {
            backfillDstPtsAllowed(rest, await fetchSeasonStats(Number(state.season)))
            restPlayers = buildPlayers(meta, rest)
          }
        }
        const players = buildPlayers(meta, seasonProj)
        const data: ProjectionsPayload = {
          seasonId: state.season,
          week: completedWeek,
          players,
          restOfSeason: restPlayers ?? players,
        }
        if (players.length > 0) {
          projCache = { data, fetchedAt: Date.now() }
          return NextResponse.json({
            ...data,
            source: 'sleeper',
            fetchedAt: new Date(projCache.fetchedAt).toISOString(),
          })
        }
      }
    }

    // Live fetch failed or shape changed: stamped in-memory snapshot first…
    if (projCache) {
      console.warn('[NFL API] projections unreachable — serving stale in-memory snapshot')
      return NextResponse.json({
        ...projCache.data,
        source: 'cache',
        fetchedAt: new Date(projCache.fetchedAt).toISOString(),
      })
    }
    // …then the committed static snapshot.
    console.warn(
      '[NFL API] projections unreachable — serving STATIC fallback ' +
      `(generated ${PROJ_FALLBACK.generatedAt ?? 'unknown date'}). Data may be stale.`
    )
    return NextResponse.json({
      seasonId: PROJ_FALLBACK.seasonId,
      week: PROJ_FALLBACK.week,
      players: PROJ_FALLBACK.players,
      restOfSeason: PROJ_FALLBACK.restOfSeason,
      source: 'fallback',
      fetchedAt: null,
      fallbackGeneratedAt: PROJ_FALLBACK.generatedAt ?? null,
    })
  })()
}

// ── Stat mapping: Sleeper keys → NflPlayerStats ─────────────────────────────

function round(n: number): number { return Math.round(n) }

function mapSkillStats(s: Record<string, number>): NflPlayerStats {
  const out: NflPlayerStats = {
    passYds:     round(s.pass_yd  ?? 0),
    passTDs:     round(s.pass_td  ?? 0),
    passInt:     round(s.pass_int ?? 0),
    pass2pt:     round(s.pass_2pt ?? 0),
    rushYds:     round(s.rush_yd  ?? 0),
    rushTDs:     round(s.rush_td  ?? 0),
    rushAtt:     round(s.rush_att ?? 0),
    rush2pt:     round(s.rush_2pt ?? 0),
    rec:         round(s.rec      ?? 0),
    recYds:      round(s.rec_yd   ?? 0),
    recTDs:      round(s.rec_td   ?? 0),
    rec2pt:      round(s.rec_2pt  ?? 0),
    fumblesLost: round(s.fum_lost ?? 0),
  }
  for (const [cat, calcPrefix] of [
    ['Pass', 'calc_bonus_pass_yd'],
    ['Rush', 'calc_bonus_rush_yd'],
    ['Rec',  'calc_bonus_rec_yd'],
  ] as const) {
    for (const thr of [100, 150, 200, 250, 300]) {
      (out as Record<string, number>)[`bonus${cat}Yd${thr}`] = round(s[`${calcPrefix}_${thr}`] ?? 0)
    }
  }
  return out
}

function mapKickerStats(s: Record<string, number>): NflPlayerStats {
  const made0to19  = round(s.fgm_0_19  ?? 0)
  const made20to29 = round(s.fgm_20_29 ?? 0)
  const made30to39 = round(s.fgm_30_39 ?? 0)
  const made40to49 = round(s.fgm_40_49 ?? 0)
  const made50p    = round(s.fgm_50p   ?? s.fgm_50 ?? 0)
  const att0to19   = round(s.fga_0_19  ?? made0to19)
  const att20to29  = round(s.fga_20_29 ?? made20to29)
  const att30to39  = round(s.fga_30_39 ?? made30to39)
  const att40to49  = round(s.fga_40_49 ?? made40to49)
  const att50p     = round(s.fga_50p   ?? s.fga_50 ?? made50p)
  const xpm = round(s.xpm ?? 0)
  const xpa = round(s.xpa ?? xpm)
  // Projections report misses as fgmiss_* buckets instead of fga_* attempts
  const fgmissBuckets = round(
    (s.fgmiss_0_19 ?? 0) + (s.fgmiss_20_29 ?? 0) + (s.fgmiss_30_39 ?? 0) +
    (s.fgmiss_40_49 ?? 0) + (s.fgmiss_50p ?? 0)
  ) || round(s.fgmiss ?? 0)
  return {
    fgMade0to39:  made0to19 + made20to29 + made30to39,
    fgMade40to49: made40to49,
    fgMade50plus: made50p,
    fgMissed: Math.max(
      (att0to19 - made0to19) + (att20to29 - made20to29) +
      (att30to39 - made30to39) + (att40to49 - made40to49) +
      (att50p - made50p),
      fgmissBuckets,
      0),
    patMade:   xpm,
    patMissed: Math.max(0, xpa - xpm, round(s.xpmiss ?? 0)),
  }
}

function mapDstStats(s: Record<string, number>): NflPlayerStats {
  return {
    sacks:      round(s.sack ?? 0),
    ints:       round(s.int ?? 0),
    fumbRec:    round(s.fum_rec ?? 0),
    defTDs:     round((s.def_td ?? 0) + (s.def_st_td ?? 0)),
    ptsAllowed: round(s.pts_allow ?? 0),
  }
}

// ── Half-PPR score for sorting/filtering ────────────────────────────────────

function fantasyScore(s: NflPlayerStats, pos: string): number {
  switch (pos) {
    case 'QB':
      return (s.passYds ?? 0) * 0.04 + (s.passTDs ?? 0) * 4 + (s.passInt ?? 0) * -2 +
             (s.rushYds ?? 0) * 0.1 + (s.rushTDs ?? 0) * 6
    case 'RB':
      return (s.rushYds ?? 0) * 0.1 + (s.rushTDs ?? 0) * 6 +
             (s.rec ?? 0) * 0.5 + (s.recYds ?? 0) * 0.1 + (s.recTDs ?? 0) * 6
    case 'WR':
    case 'TE':
      return (s.rec ?? 0) * 0.5 + (s.recYds ?? 0) * 0.1 + (s.recTDs ?? 0) * 6 +
             (s.rushYds ?? 0) * 0.1 + (s.rushTDs ?? 0) * 6
    case 'K':
      return (s.fgMade0to39 ?? 0) * 3 + (s.fgMade40to49 ?? 0) * 4 +
             (s.fgMade50plus ?? 0) * 5 + (s.patMade ?? 0)
    case 'DST':
      return (s.sacks ?? 0) + (s.ints ?? 0) * 2 + (s.fumbRec ?? 0) * 2 + (s.defTDs ?? 0) * 6
    default:
      return 0
  }
}

// ── DST identities ──────────────────────────────────────────────────────────

const NFL_TEAMS = [
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE',
  'DAL','DEN','DET','GB', 'HOU','IND','JAX','KC',
  'LAC','LAR','LV', 'MIA','MIN','NE', 'NO', 'NYG',
  'NYJ','PHI','PIT','SEA','SF', 'TB', 'TEN','WAS',
]
const DST_FULL_NAMES: Record<string, string> = {
  ARI:'Arizona Cardinals',   ATL:'Atlanta Falcons',     BAL:'Baltimore Ravens',
  BUF:'Buffalo Bills',       CAR:'Carolina Panthers',   CHI:'Chicago Bears',
  CIN:'Cincinnati Bengals',  CLE:'Cleveland Browns',    DAL:'Dallas Cowboys',
  DEN:'Denver Broncos',      DET:'Detroit Lions',       GB:'Green Bay Packers',
  HOU:'Houston Texans',      IND:'Indianapolis Colts',  JAX:'Jacksonville Jaguars',
  KC:'Kansas City Chiefs',   LAC:'Los Angeles Chargers',LAR:'Los Angeles Rams',
  LV:'Las Vegas Raiders',    MIA:'Miami Dolphins',      MIN:'Minnesota Vikings',
  NE:'New England Patriots', NO:'New Orleans Saints',   NYG:'New York Giants',
  NYJ:'New York Jets',       PHI:'Philadelphia Eagles', PIT:'Pittsburgh Steelers',
  SEA:'Seattle Seahawks',    SF:'San Francisco 49ers',  TB:'Tampa Bay Buccaneers',
  TEN:'Tennessee Titans',    WAS:'Washington Commanders',
}

/** Stable numeric ID from a Sleeper player_id string */
function stableId(pid: string): number {
  let h = 5381
  for (const c of pid) h = ((h << 5) + h + c.charCodeAt(0)) | 0
  return (Math.abs(h) % 80000) + 10000
}

// ── Build NflDbPlayer list for one season ───────────────────────────────────

function buildPlayers(meta: SleeperMeta, seasonData: SeasonTotals): NflDbPlayer[] {
  const { totals, gpCounts } = seasonData
  const result: NflDbPlayer[] = []
  const usedIds = new Set<number>()
  const safeId = (baseId: number) => {
    let id = baseId
    while (usedIds.has(id)) id++
    usedIds.add(id)
    return id
  }

  type Scored = NflDbPlayer & { _score: number }
  const byPos: Record<string, Scored[]> = { QB: [], RB: [], WR: [], TE: [], K: [] }

  for (const [pid, info] of Object.entries(meta)) {
    if (!info) continue
    const status = (info.status ?? '').toLowerCase()
    if (status && !['active', 'injured_reserve', 'physically_unable_to_perform',
                    'ir', 'reserve', ''].includes(status)) continue

    const positions = info.fantasy_positions ?? (info.position ? [info.position] : [])
    const pos = positions[0]
    if (!pos || !SKILL_POSITIONS.has(pos)) continue

    const raw = totals[pid]
    if (!raw) continue

    const stats = pos === 'K' ? mapKickerStats(raw) : mapSkillStats(raw)
    const score = fantasyScore(stats, pos)
    if (score < 5) continue

    const gp = Math.max(1, Math.min(18, gpCounts[pid] ?? 1))
    const name = info.full_name ?? `${info.first_name ?? ''} ${info.last_name ?? ''}`.trim()
    if (!name) continue

    byPos[pos].push({
      id:          safeId(stableId(pid)),
      name,
      team:        info.team ?? 'FA',
      position:    pos as NflPlayerPosition,
      gamesPlayed: gp,
      // Data plumbing only — no badge or valuation use yet
      injuryStatus: info.injury_status ?? undefined,
      stats,
      _score: score,
    })
  }

  for (const [pos, limit] of Object.entries(POS_LIMITS)) {
    if (pos === 'DST') continue
    const sorted = (byPos[pos] ?? []).sort((a, b) => b._score - a._score).slice(0, limit)
    for (const { _score, ...player } of sorted) {
      void _score
      result.push(player)
    }
  }

  for (const [i, abbr] of NFL_TEAMS.entries()) {
    const raw = totals[abbr]
    const stats = mapDstStats(raw ?? {})
    const gp = Math.max(1, Math.min(18, gpCounts[abbr] ?? 17))
    result.push({
      id:          safeId(60000 + i + 1),
      name:        DST_FULL_NAMES[abbr] ?? abbr,
      team:        abbr,
      position:    'DST',
      gamesPlayed: gp,
      stats,
    })
  }
  return result
}

// ── Static fallback (last resort only) ──────────────────────────────────────

type FallbackJson = {
  generatedAt?: string
  currentSeason: { seasonId: string; players: NflDbPlayer[] }
  priorSeason:   { seasonId: string; players: NflDbPlayer[] }
}
const FALLBACK = nflPlayersJson as FallbackJson

function fallbackResponse() {
  console.warn(
    '[NFL API] Sleeper unreachable — serving STATIC fallback data ' +
    `(generated ${FALLBACK.generatedAt ?? 'unknown date'}). Data may be stale.`
  )
  return NextResponse.json({
    currentSeason: {
      seasonId: FALLBACK.currentSeason.seasonId,
      players:  FALLBACK.currentSeason.players,
      source:   'fallback',
      hasData:  FALLBACK.currentSeason.players.length > 0,
    },
    priorSeason: {
      seasonId: FALLBACK.priorSeason.seasonId,
      players:  FALLBACK.priorSeason.players,
      source:   'fallback',
      hasData:  FALLBACK.priorSeason.players.length > 0,
    },
    fallbackGeneratedAt: FALLBACK.generatedAt ?? null,
  })
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const endpoint = searchParams.get('endpoint')

  if (endpoint === 'projections') return projectionsResponse()

  const meta = await fetchPlayerMeta()
  if (!meta) {
    if (endpoint === 'all-seasons') return fallbackResponse()
    return NextResponse.json({ data: FALLBACK.currentSeason.players, source: 'fallback' })
  }

  const currentYear = computeCurrentNflSeason()
  const priorYear   = currentYear - 1

  const [currentStats, priorStats] = await Promise.all([
    fetchSeasonStats(currentYear),
    fetchSeasonStats(priorYear),
  ])
  const currentPlayers = buildPlayers(meta, currentStats)
  const priorPlayers   = buildPlayers(meta, priorStats)

  // buildPlayers appends all 32 DSTs unconditionally (even with zero stats),
  // so a raw length check can never see an "empty" season. A season only has
  // real data when at least one skill player survived the stat filters —
  // otherwise (pre-season, before week 1 completes) it's just phantom DSTs.
  const hasRealPlayers = (players: NflDbPlayer[]) =>
    players.some((p) => p.position !== 'DST')

  // Both seasons empty means the stats API is down even though metadata
  // loaded — treat as unreachable rather than serving an empty analyzer.
  if (!hasRealPlayers(currentPlayers) && !hasRealPlayers(priorPlayers)) {
    if (endpoint === 'all-seasons') return fallbackResponse()
    return NextResponse.json({ data: FALLBACK.currentSeason.players, source: 'fallback' })
  }

  if (endpoint === 'all-seasons') {
    // Pre-season: the current year's stats endpoint legitimately returns
    // nothing until week 1 — return it with hasData: false and let the
    // client fall back to prior-season modes.
    return NextResponse.json({
      currentSeason: {
        seasonId: String(currentYear),
        players:  currentPlayers,
        source:   'sleeper',
        hasData:  hasRealPlayers(currentPlayers),
      },
      priorSeason: {
        seasonId: String(priorYear),
        players:  priorPlayers,
        source:   'sleeper',
        hasData:  hasRealPlayers(priorPlayers),
      },
    })
  }

  // Legacy: current season only
  return NextResponse.json({ data: currentPlayers, source: 'sleeper' })
}
