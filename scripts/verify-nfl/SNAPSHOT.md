# NFL verification snapshot

- **Captured:** 2026-09-05 (America/Vancouver; file timestamp 2026-09-06 UTC)
- **Contents:** `snapshot.json` — 466 projection players (2026 season, Sleeper)
  and 463 last-year players (2025 actuals), taken from the production API
  (`/api/nfl?endpoint=projections` and `?endpoint=all-seasons`).
- **Engine state when pinned:** commit `6e3f090` (post bench-weight,
  full-pool-bars, QB suppression/cap, availability-discount work).

The harness runs ONLY against this snapshot, never live data — live Sleeper
projections drift daily (Jacobs' projection was slashed mid-verification the
week this was built, invalidating baselines).

## Re-snapshotting (deliberate act, not routine)

```
npm run verify:nfl:snapshot        # rewrites snapshot.json from the live feed
npm run verify:nfl -- --capture    # prints the new actuals
```

Then update the pinned values in `fixtures.mts`, the date above, and commit
all three files together with a message explaining WHY the baseline moved.
Re-snapshot when: the engine changed deliberately and you want fresh
calibration points, or the player pool changed structurally (new season).
Never re-snapshot just to make a failing scenario pass.
