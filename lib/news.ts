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
