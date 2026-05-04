/**
 * Central registry of supported sports.
 * Adding a new sport requires only a new entry here — all sport-card
 * and tab-rendering code should derive from this array.
 */

export type SportConfig = {
  key: string;
  label: string;
  path: string;
  settingsTab: string;
};

export const SPORTS_CONFIG: SportConfig[] = [
  { key: "nhl", label: "NHL", path: "/nhl", settingsTab: "NHL" },
  { key: "nfl", label: "NFL", path: "/nfl", settingsTab: "NFL" },
  { key: "mlb", label: "MLB", path: "/mlb", settingsTab: "MLB" },
];
