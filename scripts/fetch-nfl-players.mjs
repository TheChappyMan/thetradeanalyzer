/**
 * fetch-nfl-players.mjs
 *
 * One-time script: fetches 2025 and 2024 NFL season stats from the Sleeper API
 * and writes lib/nfl-players.json in the NflDbPlayer shape expected by the analyzer.
 *
 * Usage:
 *   node scripts/fetch-nfl-players.mjs
 *
 * Sleeper endpoints used:
 *   GET https://api.sleeper.app/v1/players/nfl
 *     → player metadata (name, team, position, status)
 *   GET https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}
 *     → all player stats for one regular-season week (accumulated × 18)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_PATH   = path.join(__dirname, '..', 'lib', 'nfl-players.json')
const SLEEPER    = 'https://api.sleeper.app/v1'
const NFL_WEEKS  = 18

// ── Positions we care about ────────────────────────────────────────────────
const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])

// ── All 32 NFL team abbreviations (Sleeper uses these as DST player IDs) ──
const NFL_TEAMS = [
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE',
  'DAL','DEN','DET','GB', 'HOU','IND','JAX','KC',
  'LAC','LAR','LV', 'MIA','MIN','NE', 'NO', 'NYG',
  'NYJ','PHI','PIT','SEA','SF', 'TB', 'TEN','WAS',
]

const DST_FULL_NAMES = {
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

// ── Helpers ────────────────────────────────────────────────────────────────

async function fetchJSON(url, timeoutMs = 12000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return await res.json()
  } catch (err) {
    clearTimeout(t)
    throw err
  }
}

/** Stable numeric ID from a Sleeper player_id string */
function stableId(pid) {
  let h = 5381
  for (const c of pid) h = ((h << 5) + h + c.charCodeAt(0)) | 0
  return (Math.abs(h) % 80000) + 10000
}

// ── Per-season stat aggregation ────────────────────────────────────────────

async function fetchSeasonStats(season) {
  console.log(`\nFetching ${season} season stats (${NFL_WEEKS} weeks)…`)
  const totals    = {}   // pid → accumulated stats
  const gpCounts  = {}   // pid → games with at least one stat

  for (let week = 1; week <= NFL_WEEKS; week++) {
    let weekData
    try {
      weekData = await fetchJSON(`${SLEEPER}/stats/nfl/regular/${season}/${week}`)
    } catch (e) {
      console.log(`  Week ${week}: skipped (${e.message})`)
      continue
    }

    let count = 0
    for (const [pid, stats] of Object.entries(weekData)) {
      if (!stats || typeof stats !== 'object') continue

      // Count a game played if the player has ANY non-zero numeric stat
      const played = Object.values(stats).some(v => typeof v === 'number' && v > 0)

      if (!totals[pid])   totals[pid]   = {}
      if (!gpCounts[pid]) gpCounts[pid] = 0
      if (played) gpCounts[pid]++

      for (const [key, val] of Object.entries(stats)) {
        if (typeof val === 'number') {
          totals[pid][key] = (totals[pid][key] ?? 0) + val
        }
      }
      count++
    }
    process.stdout.write(`  Week ${week}: ${count} entries\n`)
  }

  return { totals, gpCounts }
}

// ── Stat mapping: Sleeper keys → NflPlayerStats ────────────────────────────

function mapSkillStats(s) {
  return {
    passYds:     round(s.pass_yd  ?? 0),
    passTDs:     round(s.pass_td  ?? 0),
    passInt:     round(s.pass_int ?? 0),
    rushYds:     round(s.rush_yd  ?? 0),
    rushTDs:     round(s.rush_td  ?? 0),
    rec:         round(s.rec      ?? 0),
    recYds:      round(s.rec_yd   ?? 0),
    recTDs:      round(s.rec_td   ?? 0),
    fumblesLost: round(s.fum_lost ?? 0),
  }
}

function mapKickerStats(s) {
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

  const xpm   = round(s.xpm ?? 0)
  const xpa   = round(s.xpa ?? xpm)

  return {
    fgMade0to39:  made0to19 + made20to29 + made30to39,
    fgMade40to49: made40to49,
    fgMade50plus: made50p,
    fgMissed:     Math.max(0,
                    (att0to19 - made0to19) + (att20to29 - made20to29) +
                    (att30to39 - made30to39) + (att40to49 - made40to49) +
                    (att50p - made50p)),
    patMade:      xpm,
    patMissed:    Math.max(0, xpa - xpm),
  }
}

function mapDstStats(s) {
  return {
    sacks:      round(s.sack    ?? 0),
    ints:       round(s.int     ?? 0),
    fumbRec:    round(s.fum_rec ?? 0),
    defTDs:     round((s.def_td ?? 0) + (s.def_st_td ?? 0) + (s.def_st_ff ?? 0) * 0),
    ptsAllowed: round(s.pts_allow ?? 0),
  }
}

function round(n) { return Math.round(n) }

// ── Half-PPR score for sorting/filtering ──────────────────────────────────

function fantasyScore(stats, pos) {
  const s = stats
  switch (pos) {
    case 'QB':
      return (s.passYds??0)*0.04 + (s.passTDs??0)*4  + (s.passInt??0)*(-2) +
             (s.rushYds??0)*0.1  + (s.rushTDs??0)*6
    case 'RB':
      return (s.rushYds??0)*0.1  + (s.rushTDs??0)*6 +
             (s.rec??0)*0.5      + (s.recYds??0)*0.1 + (s.recTDs??0)*6
    case 'WR':
    case 'TE':
      return (s.rec??0)*0.5      + (s.recYds??0)*0.1 + (s.recTDs??0)*6 +
             (s.rushYds??0)*0.1  + (s.rushTDs??0)*6
    case 'K':
      return (s.fgMade0to39??0)*3 + (s.fgMade40to49??0)*4 +
             (s.fgMade50plus??0)*5 + (s.patMade??0)
    case 'DST':
      return (s.sacks??0)*1 + (s.ints??0)*2 + (s.fumbRec??0)*2 + (s.defTDs??0)*6
    default: return 0
  }
}

// ── Build a list of NflDbPlayer for one season ─────────────────────────────

const POS_LIMITS = { QB: 32, RB: 70, WR: 90, TE: 32, K: 16, DST: 32 }

function buildPlayers(allPlayerMeta, seasonData) {
  const { totals, gpCounts } = seasonData
  const result = []
  const usedIds = new Set()

  function safeId(baseId) {
    let id = baseId
    while (usedIds.has(id)) id++
    usedIds.add(id)
    return id
  }

  // ── Skill positions ──────────────────────────────────────────────────────
  const byPos = { QB: [], RB: [], WR: [], TE: [], K: [] }

  for (const [pid, info] of Object.entries(allPlayerMeta)) {
    if (!info) continue

    // Only include active players (or IR — they have stats)
    const status = (info.status ?? '').toLowerCase()
    if (status && !['active', 'injured_reserve', 'physically_unable_to_perform',
                    'ir', 'reserve', ''].includes(status)) continue

    const positions = info.fantasy_positions ?? (info.position ? [info.position] : [])
    const pos = positions[0]
    if (!SKILL_POSITIONS.has(pos)) continue

    const raw = totals[pid]
    if (!raw) continue

    const stats = pos === 'K' ? mapKickerStats(raw) : mapSkillStats(raw)
    const score = fantasyScore(stats, pos)
    if (score < 5) continue  // skip players with essentially no production

    const gp = Math.max(1, Math.min(18, gpCounts[pid] ?? 1))
    const name = info.full_name ?? `${info.first_name ?? ''} ${info.last_name ?? ''}`.trim()
    if (!name) continue

    byPos[pos].push({
      id:          safeId(stableId(pid)),
      name,
      team:        info.team ?? 'FA',
      position:    pos,
      gamesPlayed: gp,
      stats,
      _score: score,
    })
  }

  // Sort each position bucket by score and take top N
  for (const [pos, limit] of Object.entries(POS_LIMITS)) {
    if (pos === 'DST') continue
    const sorted = (byPos[pos] ?? []).sort((a, b) => b._score - a._score).slice(0, limit)
    for (const { _score, ...player } of sorted) result.push(player)
  }

  // ── DST ──────────────────────────────────────────────────────────────────
  for (const [i, abbr] of NFL_TEAMS.entries()) {
    const raw = totals[abbr]
    // Some seasons might not have data for every team — still include all 32
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

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Step 1: Fetching player metadata from Sleeper…')
  const allPlayerMeta = await fetchJSON(`${SLEEPER}/players/nfl`)
  const metaCount = Object.keys(allPlayerMeta).length
  console.log(`  ${metaCount} players in metadata`)

  const current2025 = await fetchSeasonStats(2025)
  const prior2024   = await fetchSeasonStats(2024)

  console.log('\nStep 2: Building player lists…')
  const currentPlayers = buildPlayers(allPlayerMeta, current2025)
  const priorPlayers   = buildPlayers(allPlayerMeta, prior2024)

  const posCount = (players, pos) => players.filter(p => p.position === pos).length
  for (const [label, players] of [['2025', currentPlayers], ['2024', priorPlayers]]) {
    console.log(`  ${label}: ${players.length} total —`,
      ['QB','RB','WR','TE','K','DST'].map(p => `${p}:${posCount(players, p)}`).join(' '))
  }

  const output = {
    currentSeason: { seasonId: '2025', players: currentPlayers },
    priorSeason:   { seasonId: '2024', players: priorPlayers   },
  }

  console.log(`\nStep 3: Writing ${OUT_PATH}…`)
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2))
  console.log('Done.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
