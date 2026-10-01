/**
 * Homepage news feed. Add items by editing this array — newest first.
 * Dates are ISO (yyyy-mm-dd) and formatted for display by the homepage.
 */

export type NewsItem = {
  title: string
  date: string // ISO yyyy-mm-dd
  body: string
  href?: string
  linkLabel?: string
}

export const NEWS_ITEMS: NewsItem[] = [
  {
    title: 'Draft Mode now tracks your category balance',
    date: '2026-10-01',
    body:
      'Categories leagues get a new balance strip in NHL Draft Mode. Every category ' +
      'your league counts shows what your drafted roster has banked, the expected ' +
      'amount for the spots you have filled, and the full-roster target based on your ' +
      'league\'s average team. Ahead, on pace, or behind at a glance, so you can see ' +
      'when it is time to stop stacking points and go fill hits and PIM. NHL category ' +
      'values also got more accurate under the hood, including a fix that restores ' +
      'save percentage to goalie valuations.',
    href: '/rankings',
    linkLabel: 'Open Rankings',
  },
  {
    title: 'Smarter values for deep-bench leagues',
    date: '2026-09-09',
    body:
      'Replacement level now weighs bench slots by how often those players actually ' +
      'reach your lineup. In leagues with big benches, player values and draft pick ' +
      'values line up with how real managers trade, so fairness verdicts stay honest ' +
      'whether your league rosters 14 players or 20.',
  },
  {
    title: 'Draft Mode just got a lot smarter',
    date: '2026-09-01',
    body:
      'NFL draft recommendations are now starter-aware. The board fills your empty ' +
      'starting slots before suggesting depth, caps QB picks in superflex once your ' +
      'slots are covered, holds K and DST until the end, and warns you before stacking ' +
      'too many players on the same bye. Injury and availability badges now show on ' +
      'every board, so you can see exactly why a player is priced where he is.',
    href: '/rankings',
    linkLabel: 'Open Rankings',
  },
  {
    title: 'Draft Mode now covers NFL',
    date: '2026-08-27',
    body:
      'Draft Mode is live on NFL Rankings for all paid tiers, right in time for ' +
      'draft season. Check players off as they come off the board and the ' +
      'recommendations recalculate against your scoring format, roster slots, and ' +
      'what your team still needs, including flex and superflex handling and RB/TE ' +
      'scarcity. Rankings now run on full-season projections scored under your ' +
      'league settings, not last year\'s totals.',
    href: '/rankings',
    linkLabel: 'Open Rankings',
  },
  {
    title: 'Draft Assistant is live for paid accounts',
    date: '2026-08-27',
    body:
      'Draft Mode is now built into NHL Rankings for all paid tiers. Turn it on, ' +
      'check players off as they get drafted, and the board recalculates live against ' +
      'your league settings and roster. Your top pick is highlighted in green with ' +
      'ranked fallback options behind it, and a marker shows where your next pick lands. ' +
      'Because it runs on the same engine as the trade analyzer, it accounts for ' +
      'positional scarcity and what your roster actually needs, not just raw rankings.',
    href: '/rankings',
    linkLabel: 'Open Rankings',
  },
  {
    title: 'Rankings are here for every account',
    date: '2026-07-29',
    body:
      'Every signed-in user, including free accounts, now gets a full Rankings page ' +
      'for NHL, NFL, and MLB. Players are ranked under your league settings, with ' +
      'position filters, search, and stat highlighting that shows who beats the ' +
      'draftable-pool average at their position.',
    href: '/rankings',
    linkLabel: 'Open Rankings',
  },
]
