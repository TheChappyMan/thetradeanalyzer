import type { Metadata } from 'next'

// Private/transactional route — keep out of search indexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
