import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

// A cold cache has to pace ~56 NHL requests (see the limiter below).
export const maxDuration = 60;

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

// The stats API caps every response at 100 rows (as of 2026-11; `limit=-1`,
// `limit=0` and `limit=1000` all return 100), so a season is read in pages.
// Page 1 reports `total`; the remaining pages follow. `sort=playerId` gives
// a stable order so no row is skipped or repeated across pages; rows are
// de-duplicated by playerId anyway.
//
// Paging turns 8 requests per refresh into ~56, and the API rate-limits
// bursts: probing showed HTTP 429 with `Retry-After: 60` after ~50 requests
// in a couple of seconds, while the same 56 spaced 300 ms apart all passed.
// So two layers sit between the route and the API:
//   1. Each PAGE is cached in the Next data cache (unstable_cache), shared
//      across serverless instances. Cache hits never reach the limiter.
//   2. Cache misses go through a limiter: at most NHL_MAX_PER_WINDOW request
//      starts per rolling NHL_WINDOW_MS, NHL_MAX_CONCURRENT in flight.
// A fully cold cache therefore takes ~10 s once (see maxDuration below);
// an hourly current-season refresh (~25 requests) is not delayed at all.

const NHL_PAGE_SIZE = 100;
const NHL_MAX_PAGES = 30; // safety stop: 3,000 rows is far above any season

const NHL_WINDOW_MS      = 10_000;
const NHL_MAX_PER_WINDOW = 40;
const NHL_MAX_CONCURRENT = 4;

type NhlRow  = Record<string, unknown>;
type NhlPage = { data: NhlRow[]; total: number };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Limiter (per serverless instance) ─────────────────────────
const nhlStarts: number[] = [];          // start times inside the window
let nhlGate: Promise<void> = Promise.resolve();
let nhlInFlight = 0;
const nhlWaiters: Array<() => void> = [];

/** Resolves when one more request may start without exceeding the window. */
function nhlWindowTurn(): Promise<void> {
  const turn = nhlGate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (nhlStarts.length && now - nhlStarts[0] >= NHL_WINDOW_MS) nhlStarts.shift();
      if (nhlStarts.length < NHL_MAX_PER_WINDOW) { nhlStarts.push(now); return; }
      await sleep(nhlStarts[0] + NHL_WINDOW_MS - now + 25);
    }
  });
  nhlGate = turn.catch(() => {});
  return turn;
}

async function nhlLimited<T>(fn: () => Promise<T>): Promise<T> {
  if (nhlInFlight >= NHL_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => nhlWaiters.push(resolve));
  } else {
    nhlInFlight++;
  }
  try {
    await nhlWindowTurn();
    return await fn();
  } finally {
    const next = nhlWaiters.shift();
    if (next) next();      // hand the slot straight to the next waiter
    else nhlInFlight--;
  }
}

// ── One page, uncached ────────────────────────────────────────
async function loadNhlPage(path: string, season: string, start: number): Promise<NhlPage> {
  const url =
    `${NHL_STATS_BASE}/${path}?limit=${NHL_PAGE_SIZE}&start=${start}&sort=playerId` +
    `&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`;
  // no-store: caching happens one level up, per page, in unstable_cache.
  let res = await nhlLimited(() => fetch(url, { cache: "no-store" }));
  if (res.status >= 500) {
    // One retry for a transient server error. A 429 is NOT retried: the
    // block lasts ~60 s, longer than this request can usefully wait.
    await sleep(500);
    res = await nhlLimited(() => fetch(url, { cache: "no-store" }));
  }
  // Throwing keeps a failed page out of the cache.
  if (!res.ok) throw new Error(`NHL API ${res.status} for ${path}/${season}`);
  const json = (await res.json()) as { data?: NhlRow[]; total?: number };
  const data = json.data ?? [];
  return { data, total: typeof json.total === "number" ? json.total : data.length };
}

// ── One page, cached ──────────────────────────────────────────
// The in-progress season changes nightly → 1 h. Finished seasons never
// change → 24 h, which also keeps the two refreshes from landing together.
const loadCurrentSeasonPage = unstable_cache(loadNhlPage, ["nhl-stats-page-v1"], { revalidate: 3600 });
const loadPastSeasonPage    = unstable_cache(loadNhlPage, ["nhl-stats-page-v1"], { revalidate: 86400 });

function fetchNhlPage(path: string, season: string, start: number): Promise<NhlPage> {
  const load = season === computeCurrentSeasonId() ? loadCurrentSeasonPage : loadPastSeasonPage;
  return load(path, season, start);
}

async function fetchNhlEndpoint(path: string, season: string): Promise<NhlRow[]> {
  const first = await fetchNhlPage(path, season, 0);
  const pageCount = Math.min(NHL_MAX_PAGES, Math.ceil(first.total / NHL_PAGE_SIZE));
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) =>
      fetchNhlPage(path, season, (i + 1) * NHL_PAGE_SIZE)
    )
  );

  const seen = new Set<unknown>();
  const rows: NhlRow[] = [];
  for (const page of [first, ...rest]) {
    for (const row of page.data) {
      if (row.playerId !== undefined) {
        if (seen.has(row.playerId)) continue;
        seen.add(row.playerId);
      }
      rows.push(row);
    }
  }

  // A short pool silently distorts every value (z-scores, replacement bars),
  // so make it visible in the server logs.
  if (rows.length !== first.total) {
    console.warn(
      `[nhl] ${path}/${season}: got ${rows.length} rows but the NHL API reports ${first.total}`
    );
  }
  return rows;
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

  try {
    const data = await fetchNhlEndpoint(ENDPOINT_MAP[endpoint], season);
    return NextResponse.json({ data, total: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch from NHL API: ${message}` },
      { status: 502 }
    );
  }
}
