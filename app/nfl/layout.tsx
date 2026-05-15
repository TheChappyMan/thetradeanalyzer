import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'NFL Trade Analyzer | The Trade Analyzer',
  description:
    'Analyze NFL fantasy trades with positional scarcity, PPR format, and Superflex support.',
}

export default function NflLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
