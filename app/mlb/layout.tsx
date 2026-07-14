import type { Metadata } from 'next'

const TITLE = 'MLB Trade Analyzer'
const DESCRIPTION =
  'Analyze fantasy baseball trades using your league’s actual scoring — 5×5 roto, OBP, or points formats, ' +
  'keeper or redraft. Hitter and pitcher values, draft picks, and instant fairness grades. Free, no account needed.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/mlb' },
  openGraph: {
    title: `${TITLE} | The Trade Analyzer`,
    description: DESCRIPTION,
    url: 'https://app.thetradeanalyzer.com/mlb',
    siteName: 'The Trade Analyzer',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} | The Trade Analyzer`,
    description: DESCRIPTION,
  },
}

export default function MlbLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
