import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import GlobalNav from "./components/GlobalNav";
import { LeagueProvider } from "@/lib/league-context";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "thetradeanalyzer",
  description: "Fantasy trade analyzer for NHL, NFL, and more",
  openGraph: {
    title: 'thetradeanalyzer',
    description: 'Fantasy trade analysis for NHL, NFL, and MLB. Know the value before you make the move.',
    url: 'https://app.thetradeanalyzer.com',
    siteName: 'thetradeanalyzer',
    images: [
      {
        url: 'https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Featured-Image.jpg',
        width: 1200,
        height: 630,
        alt: 'thetradeanalyzer',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'thetradeanalyzer',
    description: 'Fantasy trade analysis for NHL, NFL, and MLB. Know the value before you make the move.',
    images: ['https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Featured-Image.jpg'],
  },
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
            {/* ── Global top bar — always rendered for all visitors ── */}
            <GlobalNav />

            {children}
          </LeagueProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
