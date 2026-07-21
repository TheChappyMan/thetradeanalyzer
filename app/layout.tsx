import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import GlobalNav from "./components/GlobalNav";
import GlobalFooter from "./components/GlobalFooter";
import { LeagueProvider } from "@/lib/league-context";
import { isAdminId } from "@/lib/auth";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL('https://app.thetradeanalyzer.com'),
  title: {
    default: 'Fantasy Trade Analyzer for NHL, NFL & MLB | The Trade Analyzer',
    template: '%s | The Trade Analyzer',
  },
  description:
    'Analyze fantasy hockey, football, and baseball trades using your league’s actual scoring settings. ' +
    'Instant fairness grades for points, categories, keeper, and dynasty leagues — free, no account needed.',
  alternates: {
    canonical: '/',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'The Trade Analyzer',
  },
  icons: {
    icon: '/favicon.png',
    apple: '/icons/icon-192.png',
  },
  openGraph: {
    title: 'Fantasy Trade Analyzer for NHL, NFL & MLB | The Trade Analyzer',
    description:
      'Analyze fantasy hockey, football, and baseball trades using your league’s actual scoring settings. Free, no account needed.',
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
    title: 'Fantasy Trade Analyzer for NHL, NFL & MLB | The Trade Analyzer',
    description:
      'Analyze fantasy hockey, football, and baseball trades using your league’s actual scoring settings. Free, no account needed.',
    images: ['https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Featured-Image.jpg'],
  },
};

export const viewport = {
  themeColor: '#0F4C5C',
};

// JSON-LD structured data for the application (rendered on every page;
// describes the app itself, so homepage-level scope is correct)
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "The Trade Analyzer",
  url: "https://app.thetradeanalyzer.com",
  applicationCategory: "SportsApplication",
  operatingSystem: "Web",
  description:
    "Fantasy trade analyzer for NHL, NFL, and MLB. Instant trade fairness grades based on your league's actual scoring settings.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "CAD",
    description: "Free to use — paid plans add saved settings, trade history, and multi-league management.",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve admin status server-side so ADMIN_USER_IDS is never sent to the client
  const { userId } = await auth();
  const adminUser = !!userId && isAdminId(userId);

  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        {/* ── Structured data (schema.org WebApplication) ── */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />

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

        {/* ── Google AdSense — signed-out visitors only ── */}
        {!userId && (
          <Script
            async
            src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7549014969344384"
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}

        {/* ── Microsoft Clarity ── */}
        <Script id="ms-clarity-init" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window,document,"clarity","script","xlxeoqmzpn");
          `}
        </Script>

        <ClerkProvider>
          <LeagueProvider>
            {/* ── Global top bar — always rendered for all visitors ── */}
            <GlobalNav isAdmin={adminUser} />

            <main>{children}</main>

            <GlobalFooter />
          </LeagueProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
