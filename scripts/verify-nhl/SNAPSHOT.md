# NHL verification snapshot

- **Captured:** 2026-10-03 (see `capturedAt` inside `snapshot.json`)
- **Contents:** `snapshot.json` — 2025-26 regular season (`seasonId=20252026`,
  the "Last Year" season once 2026-27 began) from the public NHL stats API:
  `skater/summary`, `skater/realtime`, `skater/faceoffwins`, `goalie/summary`,
  each row pruned to the fields `buildPlayerDatabase` reads.
- **Engine state when pinned:** commit `2b50d5b` (TOI derived from
  `timeOnIcePerGame × GP`, SV% read from `savePct`) plus the trade-card fix
  that made the card print `tradeBase` instead of the points formula.
- **Pinned league:** LMAGMCF — 12 teams, 3C / 4W / 3D / 2G / 5B / 2 IR+,
  categories G A P +/- PIM PPP GWG SOG HIT BLK FW and W SO SV SV%,
  Last Year - Total.

- **Second snapshot:** `snapshot-current.json` — 2026-27 season captured
  2026-10-19, two weeks in (team GP 6–10). Used by the goalie workload-share
  scenarios (W1–W6), which need an EARLY-season table: backup GP as a live
  role signal (Bussi 5 of CAR's 10 games vs Wedgewood 2 of COL's 8), the
  thin-sample fallback firing for most of the league, and a meaningful
  current/prior blend. A full-season capture would make W1 meaningless.
  `snapshot.json` doubles as its prior season.

The harness runs ONLY against these snapshots, never live data. A completed
season is stable, but the API has corrected rows after the fact before, and
a frozen file keeps the pinned ranks (Johnston 39, Guentzel 31) meaningful.

## Re-snapshotting (deliberate act, not routine)

```
npm run verify:nhl:snapshot        # rewrites snapshot.json from the live API
npx tsx scripts/verify-nhl/verify-nhl.mts --snapshot-current
                                   # rewrites snapshot-current.json (2026-27)
npm run verify:nhl -- --capture    # prints the new actuals
```

Re-capturing `snapshot-current.json` later in the season will weaken the
W scenarios (shares converge, the fallback stops firing); if the W checks
ever need re-pinning, prefer keeping an early-season capture.

Then update the pinned values in `verify-nhl.mts` (scenario S2), the date
above, and commit all three files together with a message explaining WHY
the baseline moved. Re-snapshot when the engine changed deliberately, or
when the "Last Year" season rolls over (October). Never re-snapshot just to
make a failing scenario pass.

## What is NOT covered

- Keeper and injury multipliers (pure functions of rank / status, unchanged).
- The `/rankings` page and Draft Mode value basis (Draft Mode re-pools
  against undrafted players by design). The rankings page also has no
  thin-sample fallback (pre-existing gap) — its goalie workload scaling in
  the per-game projected modes IS covered via the shared derivation.

The thin-sample fallback IS covered now (W scenarios mirror it against the
current-season snapshot), including its goalie workload rescaling.
