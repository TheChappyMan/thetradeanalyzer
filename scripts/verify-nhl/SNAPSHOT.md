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

The harness runs ONLY against this snapshot, never live data. A completed
season is stable, but the API has corrected rows after the fact before, and
a frozen file keeps the pinned ranks (Johnston 39, Guentzel 31) meaningful.

## Re-snapshotting (deliberate act, not routine)

```
npm run verify:nhl:snapshot        # rewrites snapshot.json from the live API
npm run verify:nhl -- --capture    # prints the new actuals
```

Then update the pinned values in `verify-nhl.mts` (scenario S2), the date
above, and commit all three files together with a message explaining WHY
the baseline moved. Re-snapshot when the engine changed deliberately, or
when the "Last Year" season rolls over (October). Never re-snapshot just to
make a failing scenario pass.

## What is NOT covered

- Thin-sample fallback (This Year modes only — needs a current-season table).
- Keeper and injury multipliers (pure functions of rank / status, unchanged).
- The `/rankings` page and Draft Mode value basis (Draft Mode re-pools
  against undrafted players by design).
