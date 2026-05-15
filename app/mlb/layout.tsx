import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'MLB Trade Analyzer | The Trade Analyzer',
  description:
    'Analyze MLB fantasy trades across 5x5, OBP, and points formats with real-time stats.',
}

export default function MlbLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
