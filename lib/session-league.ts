// Session-scoped league settings for FREE users.
//
// Free users have no Supabase persistence (saved settings are the paid
// feature), so without this their in-page league settings vanished the
// moment they navigated to Rankings and back. sessionStorage keeps the
// settings alive within the browser session only — cross-visit and
// cross-device persistence remains the Pro upsell.

export type SessionSport = 'nhl' | 'nfl' | 'mlb'

const key = (sport: SessionSport) => `fta-session-league-${sport}`

export function loadSessionLeague<T>(sport: SessionSport): T | null {
  try {
    const raw = sessionStorage.getItem(key(sport))
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function saveSessionLeague(sport: SessionSport, league: unknown): void {
  try {
    sessionStorage.setItem(key(sport), JSON.stringify(league))
  } catch {}
}
