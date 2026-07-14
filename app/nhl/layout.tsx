import type { Metadata } from 'next'

const TITLE = 'NHL Trade Analyzer'
const DESCRIPTION =
  'Analyze fantasy hockey trades using your league’s actual scoring settings — points or categories, ' +
  'keeper or redraft. Instant trade fairness grades for skaters, goalies, and draft picks. Free, no account needed.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/nhl' },
  openGraph: {
    title: `${TITLE} | The Trade Analyzer`,
    description: DESCRIPTION,
    url: 'https://app.thetradeanalyzer.com/nhl',
    siteName: 'The Trade Analyzer',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} | The Trade Analyzer`,
    description: DESCRIPTION,
  },
}

export default function NhlLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
