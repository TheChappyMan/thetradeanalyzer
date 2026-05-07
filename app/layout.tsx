import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { LeagueProvider } from "@/lib/league-context";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "thetradeanalyzer",
  description: "Fantasy trade analyzer for NHL, NFL, and more",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        <ClerkProvider>
          <LeagueProvider>
            {/* ── Global top bar (free / signed-out users) ───────── */}
            <SignedOut>
              <header className="nav-bar">
                <Link href="/" className="nav-wordmark">
                  thetradeanalyzer
                </Link>
                <div className="flex-1" />
                <div className="flex items-center gap-3">
                  <SignInButton mode="modal">
                    <button className="btn-secondary text-white border-white/40 hover:bg-white/10">
                      Sign In
                    </button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button
                      className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90"
                      style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
                    >
                      Sign Up Free
                    </button>
                  </SignUpButton>
                </div>
              </header>
            </SignedOut>

            {/* Pro users get their own ProNav per-page; just show avatar here */}
            <SignedIn>
              <div
                className="flex items-center justify-between px-6 py-2.5 text-sm"
                style={{ background: "var(--color-primary)" }}
              >
                <Link href="/" className="nav-wordmark">
                  thetradeanalyzer
                </Link>
                <UserButton
                  appearance={{
                    elements: {
                      avatarBox: "w-7 h-7",
                    },
                  }}
                />
              </div>
            </SignedIn>

            {children}
          </LeagueProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
