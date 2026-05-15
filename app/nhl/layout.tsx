import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'NHL Trade Analyzer | The Trade Analyzer',
  description:
    'Analyze NHL fantasy trades based on your league scoring settings. Points or categories, keeper or redraft.',
}

export default function NhlLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
