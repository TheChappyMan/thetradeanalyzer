/**
 * Plain-English descriptions for every scoring stat, shown in the hover
 * tooltips (StatHelp) beside each stat on the analyzer pages.
 */

export const NHL_SKATER_DESCRIPTIONS: Record<string, string> = {
  G:    "Goals scored.",
  A:    "Assists — passes leading directly to a goal.",
  P:    "Points — goals plus assists. If you score G and A separately, leave P at 0 to avoid double counting.",
  PM:   "Plus/minus — goal differential while the player is on the ice at even strength.",
  PIM:  "Penalty minutes.",
  PPG:  "Power-play goals.",
  PPA:  "Power-play assists.",
  PPP:  "Power-play points — PPG plus PPA. Don't combine with PPG/PPA or you'll double count.",
  SHG:  "Short-handed goals.",
  SHA:  "Short-handed assists.",
  SHP:  "Short-handed points — SHG plus SHA.",
  GWG:  "Game-winning goals.",
  SOG:  "Shots on goal.",
  HIT:  "Hits — body checks delivered.",
  BLK:  "Blocked shots.",
  FW:   "Faceoffs won.",
  FL:   "Faceoffs lost.",
  TOI:  "Total time on ice for the season (seconds).",
  ATOI: "Average time on ice per game.",
};

export const NHL_GOALIE_DESCRIPTIONS: Record<string, string> = {
  W:     "Wins — goalie was in net when the winning goal was scored.",
  L:     "Losses.",
  OTL:   "Overtime / shootout losses.",
  SO:    "Shutouts — complete games with zero goals allowed.",
  SV:    "Saves.",
  GA:    "Goals against.",
  GAA:   "Goals-against average — goals allowed per 60 minutes. Lower is better.",
  "SV%": "Save percentage — saves divided by shots faced. Higher is better.",
};

export const NFL_WEIGHT_DESCRIPTIONS: Record<string, string> = {
  passYds:          "Points per passing yard. 0.04 = 1 point per 25 yards.",
  passTDs:          "Points per passing touchdown.",
  passInt:          "Points per interception thrown — usually negative.",
  rushYds:          "Points per rushing yard. 0.1 = 1 point per 10 yards.",
  rushTDs:          "Points per rushing touchdown.",
  rec:              "Points per reception — 0 for standard, 0.5 for half-PPR, 1 for full PPR.",
  recYds:           "Points per receiving yard. 0.1 = 1 point per 10 yards.",
  recTDs:           "Points per receiving touchdown.",
  fumblesLost:      "Points per fumble lost — usually negative.",
  fgMade0to39:      "Points per made field goal from 0–39 yards.",
  fgMade40to49:     "Points per made field goal from 40–49 yards.",
  fgMade50plus:     "Points per made field goal from 50+ yards.",
  fgMissed:         "Points per missed field goal — usually negative.",
  patMade:          "Points per made extra point.",
  patMissed:        "Points per missed extra point — usually negative.",
  sacks:            "Points per sack by your team defense.",
  ints:             "Points per interception by your team defense.",
  fumbRec:          "Points per fumble recovered by your team defense.",
  defTDs:           "Points per defensive or special-teams touchdown.",
  ptsAllowed0:      "Bonus when your defense allows 0 points in a game.",
  ptsAllowed1to6:   "Bonus when your defense allows 1–6 points.",
  ptsAllowed7to13:  "Bonus when your defense allows 7–13 points.",
  ptsAllowed14to20: "Bonus when your defense allows 14–20 points.",
  ptsAllowed21to27: "Bonus when your defense allows 21–27 points.",
  ptsAllowed28to34: "Penalty when your defense allows 28–34 points.",
  ptsAllowed35plus: "Penalty when your defense allows 35+ points.",
};

export const MLB_HITTER_DESCRIPTIONS: Record<string, string> = {
  G:   "Games played.",
  R:   "Runs scored.",
  HR:  "Home runs.",
  RBI: "Runs batted in.",
  SB:  "Stolen bases.",
  AVG: "Batting average — hits divided by at-bats.",
  OBP: "On-base percentage — how often the batter reaches base.",
  SLG: "Slugging percentage — total bases per at-bat.",
  H:   "Hits.",
  BB:  "Walks (bases on balls).",
  K:   "Strikeouts by the batter — usually scored negative or as a 'less is better' category.",
  XBH: "Extra-base hits — doubles plus triples plus home runs.",
  TB:  "Total bases — 1 per single, 2 per double, 3 per triple, 4 per home run.",
  CS:  "Caught stealing.",
  AB:  "At-bats.",
};

export const MLB_PITCHER_DESCRIPTIONS: Record<string, string> = {
  W:    "Wins.",
  L:    "Losses.",
  SV:   "Saves.",
  HLD:  "Holds — relief appearances protecting a lead.",
  K:    "Strikeouts thrown.",
  ERA:  "Earned run average — earned runs per 9 innings. Lower is better.",
  WHIP: "Walks plus hits per inning pitched. Lower is better.",
  IP:   "Innings pitched.",
  QS:   "Quality starts — 6+ innings with 3 or fewer earned runs.",
  BB:   "Walks issued.",
  HR9:  "Home runs allowed per 9 innings. Lower is better.",
};
