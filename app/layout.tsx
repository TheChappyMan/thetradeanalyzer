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
