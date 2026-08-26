# The Trade Analyzer — Project Notes for Claude

Fantasy sports trade analyzer (NHL / NFL / MLB). Next.js 15 App Router,
TypeScript, Clerk auth (`publicMetadata.tier`: `free | tier1 | tier2 | tier3`),
Supabase for league/trade persistence (service-role key server-side;
`supabaseForUser` + Clerk JWT for RLS-scoped queries). Deployed on Vercel;
pushes to `main` auto-deploy.

Tier semantics: tier1 = Pro (single saved league), tier2 = Pro Plus
(multi-league), tier3 = Commissioner (everything tier2 has, plus
commissioner tools). **Any guard written as `tier === "tier2"` must also
accept tier3** — this bug has been fixed several times; use
`isEffectivelyTier2()` from `lib/auth.ts` where possible.

## Architecture map

- `lib/nfl-valuation.ts`, `lib/nhl-valuation.ts`, `lib/mlb-valuation.ts` —
  the three valuation engines. NHL/MLB were extracted from their page
  components (2026-07) so `/rankings` shares the exact math with the
  analyzers. **Never re-create engine logic inside page components.**
- `app/{nhl,nfl,mlb}/page.tsx` — trade analyzers (client components). They
  keep trade-specific logic only: picks, keeper multiplier, fairness
  display, flex position multiplier (NHL), scarcity multipliers.
- `app/rankings/` — top-level Rankings page (header nav), Settings-style
  sport tabs, available to all signed-in users. Premium users get a league
  dropdown initialized from the dashboard league context.
- `app/api/{nhl,mlb,nfl}/route.ts` — all three fetch league data live at
  request time. NFL uses Sleeper (metadata revalidate 86400 + module-level
  24h in-memory cache, because the ~14 MB payload exceeds Next's 2 MB
  fetch-cache limit; weekly stats revalidate 3600). `lib/nfl-players.json`
  is a stamped last-resort fallback only — the UI shows a staleness warning
  when it's served.
- `lib/types.ts` (NHL), `lib/nfl-types.ts`, `lib/mlb-types.ts` — league
  config types, stat keys, defaults. NHL page still carries duplicate local
  type aliases (structurally identical to `lib/types.ts`) — harmless, but
  consolidate if convenient.

## The value model (decided 2026-07, after several iterations)

For MLB roto and NHL categories leagues:

1. Summed z-scores per player against a league-shaped pool (MLB pitcher
   pool: teams×SP starters by IP + teams×RP relievers by saves+holds —
   selecting RPs by IP collapses the SV distribution and was the root of
   the "Bednar z=119" bug).
2. Rate stats are volume-weighted in BOTH data modes: ERA/WHIP/K-9/K-BB/K%
   by IP, AVG/OBP/SLG by AB, NHL SV%/GAA by their volumes.
3. **Positional replacement**: value = z − (bar at the player's position),
   where the bar is the best player outside the league's required starters
   at that position. UTIL deepens all MLB hitter positions uniformly; NHL
   W/F/U flex slots split per the slot-coverage map; DH-only players use
   the global hitter bar. NFL replacement is bench-aware (1 BN/team → QB,
   remaining BN proportional across RB/WR/TE by starter+flex share).
4. **Two values per player, never conflate them**:
   - `displayBase` — soft floor `0.05·e^(diff/2)` below the bar; keeps
     below-replacement players ordered on cards and rank lists.
   - `tradeBase` — identical above the bar, **exactly 0 below it**; used
     for trade sums, the fairness engine, and pick valuation, so waiver
     throw-ins can never tip a verdict.
5. Thin-sample fallback: players under 25% of pool-median GP (with absolute
   floors) are valued from prior-season per-game data, scaled to pool
   volume; thresholds must use REAL games played (Avg modes normalize
   everyone to 82/162 GP, which silently disables naive checks). Prior
   season must itself meet the floor or the player is "low confidence".
6. Multipliers (scarcity, keeper, age, injury) apply only to the
   non-negative trade value, in a fixed order.
7. **NHL points mode is deliberately untouched by all of the above** —
   verify byte-identical (`max |value − projected| = 0`) after any engine
   change.

NFL keeps its original `Math.max(0, proj − repl)` clamp (correct under the
display/trade standard) with RB/TE scarcity tiers multiplying VAR.

## Verification conventions

- Run `npx tsc --noEmit` after every change set.
- Engine changes get temporary diagnostics (replacement identities, top-N
  lists, invariant sweeps) captured from the browser console, then removed
  before commit. Permanent `console.warn`s stay for: empty injury maps,
  skipped degenerate categories, non-zero fairness offsets, replacement
  sum-invariant drift.
- The dev server is launched via `.claude/launch.json` (`preview_start`
  with name "dev"); local env lacks Clerk keys, so auth-gated views are
  verified with a temporary `if (!user && false)` bypass that must be
  restored before committing.
- Two invariants must always hold: adding any player never decreases a
  trade side; adding a below-replacement player never increases it.

## Session handoff — 2026-07-29

Shipped (all on `main`):

- Tier3 access fixes (settings selector, DELETE guards).
- NFL scoring: rush attempts, 2-pt conversions, configurable yard bonuses
  (two dropdown slots per category, 15 flat threshold weights); settings UI
  parity (headings, tooltips, mobile single-column).
- MLB: ~20 new categories incl. fielding PO/A/E (route now merges the
  fielding feed) and NH/PG (detected from CG pitchers' game logs; perfect
  game requires 27 BF **and** 0 BB/HBP — BF alone is insufficient); new
  roster slots CI/MI/IF/LF/CF/RF/NA; injury tiers softened (10/15-day IL
  badge-only, 60-day ×0.75).
- The full valuation overhaul described above, in both MLB and NHL.
- NFL: live Sleeper migration (ESPN path deleted; September season
  rollover; empty pre-season → forces prior-year mode), bench-aware
  replacement, `injuryStatus` plumbed onto `NflDbPlayer` (data only).
- Rankings feature: `/rankings` in the header nav, three sport tabs,
  draftable-pool stat highlighting (lower-is-better stats invert), premium
  league selector on every tab; `/nfl/rankings` redirects there.

Key decisions and why:

- Replacement is positional, not global — a global bar priced starting
  catchers 6–12 at identical zeros and neutralized every multiplier.
- Soft floor is display-only — it fixed ordering but let five throw-ins add
  ~+0.25 to a side, so trade math clamps to exactly 0 instead.
- Engine extraction over duplication for the rankings page — copies would
  drift from the actively-tuned engines.
- NFL caps raised to QB 60 / RB 120 / WR 160 / TE 70 / K 32 / DST 32,
  sized ≥20% above the deepest bench-aware replacement (14 teams, 11 BN).

Next up (in rough priority order):

1. **Scarcity multiplier retune** across all three sports — NFL RB/TE tiers
   and MLB positional multipliers now partially double-count scarcity that
   positional replacement already prices (e.g. RB1:RB16 steepens 3.7× →
   4.8×; TE1:TE13 11.2× → 15.7×). Top-20 curves are in the git log
   (commits `6ad19e2`, audit reports) as retune input.
2. **NFL keeper-rank collapse** — port the thin-sample fallback so a star
   with 7 GP (e.g. Jayden Daniels: rank 164 → keeper ×1.00 instead of
   per-game rank 22 → ×1.27) gets the right premium.
3. **NFL injury badges/discounts** — `injuryStatus` is already on the
   player objects; follow the MLB tier pattern (short = badge only).
4. Dead 1.075× pick cap (`Math.min(v, 1.075v)` ≡ v) in NFL and NHL —
   decide intended behavior or remove.
5. NFL QB replacement ignores `roster.QB` (only reads the 1QB/2QB toggle);
   MLB API has no `qualityStarts` field, so the QS category is silently
   zero — either compute QS from game logs or remove the category.
6. Cycle (CYC) cannot be derived from season stats — would need per-game
   logs for hundreds of hitters; deliberately not implemented.
