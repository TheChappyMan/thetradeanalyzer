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
      return NextResponse.json({ currentSeason, priorSeason });
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
