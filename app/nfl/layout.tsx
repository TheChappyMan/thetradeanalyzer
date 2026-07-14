import type { Metadata } from 'next'

const TITLE = 'NFL Trade Analyzer'
const DESCRIPTION =
  'Analyze fantasy football trades using your league’s actual scoring — standard, half-PPR, or full PPR, ' +
  'redraft, keeper, or dynasty. Positional scarcity, draft picks, and instant fairness grades. Free, no account needed.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/nfl' },
  openGraph: {
    title: `${TITLE} | The Trade Analyzer`,
    description: DESCRIPTION,
    url: 'https://app.thetradeanalyzer.com/nfl',
    siteName: 'The Trade Analyzer',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} | The Trade Analyzer`,
    description: DESCRIPTION,
  },
}

export default function NflLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
