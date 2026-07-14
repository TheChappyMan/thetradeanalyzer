import Link from "next/link";

/**
 * GlobalFooter — server-rendered on every page.
 *
 * Gives crawlers a hydration-independent link path to the analyzers with
 * descriptive anchor text, and gives users a consistent bottom nav.
 */
export default function GlobalFooter() {
  return (
    <footer
      className="mt-12 border-t px-6 py-8 text-sm"
      style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-start justify-between gap-6">
        <div>
          <div className="font-semibold mb-2" style={{ color: "var(--color-text)" }}>
            The Trade Analyzer
          </div>
          <p className="max-w-xs text-xs leading-relaxed">
            Fantasy trade analysis for NHL, NFL, and MLB based on your league&apos;s
            actual scoring settings.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-col sm:flex-row gap-4 sm:gap-10">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text)" }}>
              Analyzers
            </span>
            <Link href="/nhl" className="hover:underline">NHL Trade Analyzer</Link>
            <Link href="/nfl" className="hover:underline">NFL Trade Analyzer</Link>
            <Link href="/mlb" className="hover:underline">MLB Trade Analyzer</Link>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text)" }}>
              Account
            </span>
            <a href="https://thetradeanalyzer.com/pricing/" className="hover:underline">Pricing</a>
            <Link href="/sign-up" className="hover:underline">Create a Free Account</Link>
          </div>
        </nav>
      </div>

      <div className="max-w-6xl mx-auto mt-6 text-xs">
        © {new Date().getFullYear()} The Trade Analyzer. All rights reserved.
      </div>
    </footer>
  );
}
