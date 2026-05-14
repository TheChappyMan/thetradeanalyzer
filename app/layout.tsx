import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import GlobalNav from "./components/GlobalNav";
import { LeagueProvider } from "@/lib/league-context";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: 'The Trade Analyzer',
  description: 'The most accurate trade analyzer for fantasy football, hockey, and baseball.',
  icons: {
    icon: 'https://thetradeanalyzer.com/wp-content/uploads/2026/05/Favicon.png',
    apple: 'https://thetradeanalyzer.com/wp-content/uploads/2026/05/Favicon.png',
  },
  openGraph: {
    title: 'The Trade Analyzer',
    description: 'The most accurate trade analyzer for fantasy football, hockey, and baseball.',
    url: 'https://app.thetradeanalyzer.com',
    siteName: 'The Trade Analyzer',
    images: [
      {
        url: 'https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Featured-Image.jpg',
        width: 1200,
        height: 630,
        alt: 'The Trade Analyzer',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Trade Analyzer',
    description: 'The most accurate trade analyzer for fantasy football, hockey, and baseball.',
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
        {/* ── Google Analytics 4 ── */}
        {process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}

        {/* ── Meta Pixel ── */}
        {process.env.NEXT_PUBLIC_META_PIXEL_ID && (
          <>
            <Script id="meta-pixel-init" strategy="afterInteractive">
              {`
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window,document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init','${process.env.NEXT_PUBLIC_META_PIXEL_ID}');
                fbq('track','PageView');
              `}
            </Script>
            <noscript>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                height="1"
                width="1"
                style={{ display: "none" }}
                src={`https://www.facebook.com/tr?id=${process.env.NEXT_PUBLIC_META_PIXEL_ID}&ev=PageView&noscript=1`}
                alt=""
              />
            </noscript>
          </>
        )}

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
