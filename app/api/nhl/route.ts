import { NextResponse } from "next/server";

/**
 * NHL API Proxy
 *
 * The NHL's stats API blocks browser requests via CORS. This route proxies
 * the four endpoints we need from the server side, where CORS doesn't apply.
 *
 * Single-endpoint usage (legacy):
 *   fetch('/api/nhl?endpoint=skater-summary&season=20252026')
 *
 * Dual-season fetch (preferred — both seasons in one round-trip):
 *   fetch('/api/nhl?endpoint=all-seasons')
 *   Returns: { currentSeason: { seasonId, summary, realtime, faceoffs, goalies },
 *              priorSeason:   { seasonId, summary, realtime, faceoffs, goalies } }
 */

const NHL_STATS_BASE = "https://api.nhle.com/stats/rest/en";

const ENDPOINT_MAP: Record<string, string> = {
  "skater-summary":  "skater/summary",
  "skater-realtime": "skater/realtime",
  "skater-faceoffs": "skater/faceoffwins",
  "goalie-summary":  "goalie/summary",
};

// ── Season helpers ────────────────────────────────────────────

function computeCurrentSeasonId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const startYear = now.getMonth() >= 9 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}

function computePriorSeasonId(): string {
  const cur = computeCurrentSeasonId();
  const start = parseInt(cur.slice(0, 4), 10) - 1;
  return `${start}${start + 1}`;
}

// ── Internal fetch helper ─────────────────────────────────────

async function fetchNhlEndpoint(
  path: string,
  season: string
): Promise<Record<string, unknown>[]> {
  const url = `${NHL_STATS_BASE}/${path}?limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}/${season}`);
  const json = (await res.json()) as { data?: Record<string, unknown>[] };
  return json.data ?? [];
}

// ── Injury report ─────────────────────────────────────────────
// The NHL web API's /v1/injury endpoint was removed (404s as of 2026-10),
// which left the injury map permanently empty. The league-wide report now
// comes from ESPN's public NHL injuries feed; its entries carry ESPN ids,
// so players are matched back to NHL player ids by normalized full name
// built from both seasons' stat payloads (names unique to one id only —
// ambiguous names are skipped rather than risk tagging the wrong player).
// Returns a map of playerId → injuryStatus string (DTD, IR, OUT).
// Failures are silently ignored — injury data is supplemental.

const ESPN_INJURIES_URL =
  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries";

// ESPN statuses → the status codes the analyzer's injury tiers expect.
// Anything unmapped passes through raw: it renders as a badge with no
// value discount (nhlInjuryMultiplier defaults unknown statuses to ×1).
const ESPN_STATUS_MAP: Record<string, string> = {
  "day-to-day":      "DTD",
  "injured reserve": "IR",
  "out":             "OUT",
};

function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized full name → NHL player id; null marks an ambiguous name. */
function buildNameToIdMap(
  seasons: Array<{ summary: Record<string, unknown>[]; goalies: Record<string, unknown>[] }>
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const season of seasons) {
    for (const rows of [season.summary, season.goalies]) {
      for (const row of rows) {
        const id = typeof row.playerId === "number" ? row.playerId : 0;
        const rawName = row.skaterFullName ?? row.goalieFullName;
        if (!id || typeof rawName !== "string") continue;
        const name = normalizePlayerName(rawName);
        if (!name) continue;
        const existing = map.get(name);
        if (existing === undefined) map.set(name, id);
        else if (existing !== id) map.set(name, null); // ambiguous
      }
    }
  }
  return map;
}

async function fetchInjuries(
  nameToId: Map<string, number | null>
): Promise<Record<number, string>> {
  const map: Record<number, string> = {};
  try {
    const res = await fetch(ESPN_INJURIES_URL, { next: { revalidate: 1800 } });
    if (!res.ok) return map;
    const json = (await res.json()) as {
      injuries?: Array<{
        injuries?: Array<{
          status?: string;
          athlete?: { displayName?: string };
        }>;
      }>;
    };
    for (const team of json.injuries ?? []) {
      for (const entry of team.injuries ?? []) {
        const name   = entry.athlete?.displayName;
        const status = entry.status;
        if (!name || !status) continue;
        const playerId = nameToId.get(normalizePlayerName(name));
        if (!playerId) continue; // unknown or ambiguous name — skip
        map[playerId] = ESPN_STATUS_MAP[status.toLowerCase()] ?? status;
      }
    }
  } catch {
    // silently skip — injury data is supplemental
  }
  return map;
}

async function fetchOneSeason(season: string) {
  const [summary, realtime, faceoffs, goalies] = await Promise.all([
    fetchNhlEndpoint("skater/summary",     season),
    fetchNhlEndpoint("skater/realtime",    season),
    fetchNhlEndpoint("skater/faceoffwins", season),
    fetchNhlEndpoint("goalie/summary",     season),
  ]);
  return { seasonId: season, summary, realtime, faceoffs, goalies };
}

// ── Route handler ─────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");

  // ── all-seasons: fetch both current and prior season in parallel ──
  if (endpoint === "all-seasons") {
    try {
      const [currentSeason, priorSeason] = await Promise.all([
        fetchOneSeason(computeCurrentSeasonId()),
        fetchOneSeason(computePriorSeasonId()),
      ]);
      // Name→id map spans BOTH seasons: a player on IR since preseason has
      // no current-season row, and his injury entry must still resolve.
      const injuryMap = await fetchInjuries(buildNameToIdMap([currentSeason, priorSeason]));
      return NextResponse.json({
        currentSeason: { ...currentSeason, injuryMap },
        priorSeason:   { ...priorSeason,   injuryMap: {} },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json(
        { error: `Failed to fetch NHL seasons: ${message}` },
        { status: 502 }
      );
    }
  }

  // ── Legacy single-endpoint passthrough ───────────────────────
  const season = searchParams.get("season");

  if (!endpoint || !ENDPOINT_MAP[endpoint]) {
    return NextResponse.json(
      { error: "Invalid or missing endpoint parameter" },
      { status: 400 }
    );
  }

  if (!season || !/^\d{8}$/.test(season)) {
    return NextResponse.json(
      { error: "Invalid or missing season parameter (expected 8-digit format like 20252026)" },
      { status: 400 }
    );
  }

  const path = ENDPOINT_MAP[endpoint];
  const url = `${NHL_STATS_BASE}/${path}?limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });

    if (!res.ok) {
      return NextResponse.json(
        { error: `NHL API returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch from NHL API: ${message}` },
      { status: 502 }
    );
  }
}
