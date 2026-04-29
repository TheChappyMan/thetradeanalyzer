"use client";

import Link from "next/link";
import { useUser, SignInButton, SignUpButton } from "@clerk/nextjs";

export default function Dashboard() {
  const { user, isLoaded } = useUser();
  const tier = (user?.publicMetadata?.tier as string) ?? "free";
  const isPro = tier === "tier1" || tier === "tier2";
  const isSignedIn = !!user;

  // Show nothing until Clerk resolves to avoid flash
  if (!isLoaded) {
    return <div className="p-6 max-w-6xl mx-auto" />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Welcome to the Fantasy Trade Analyzer</h1>

      {isPro ? (
        /* ── Pro dashboard ──────────────────────────────────── */
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <DashCard
            href="/nhl"
            title="NHL League"
            description="Analyze NHL trades using your league's scoring settings."
          />
          <DashCard
            href="/nfl"
            title="NFL League"
            description="Analyze NFL trades using your league's scoring settings."
          />
          <DashCard
            href="/history"
            title="Trade History"
            description="Review and compare trades you've analyzed."
          />
        </div>
      ) : (
        /* ── Free dashboard ─────────────────────────────────── */
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <DashCard
              href="/nhl"
              title="NHL Trade Analyzer"
              description="Analyze NHL trades using your league's scoring settings."
            />
          </div>

          <div className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500 mb-4">
            <span>💡 Upgrade to Pro to save your settings and track trade history</span>
          </div>

          {!isSignedIn && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <SignInButton mode="modal">
                <button className="border rounded-lg px-4 py-1.5 text-gray-700 hover:bg-gray-50 transition-colors">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 transition-colors">
                  Sign Up
                </button>
              </SignUpButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}

type DashCardProps = {
  href: string;
  title: string;
  description: string;
  comingSoon?: boolean;
};

function DashCard({ href, title, description, comingSoon }: DashCardProps) {
  if (comingSoon) {
    return (
      <div className="border rounded-2xl p-4 opacity-60 cursor-not-allowed select-none">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-medium">{title}</h2>
          <span className="text-xs text-gray-400 border rounded-full px-2 py-0.5">Coming Soon</span>
        </div>
        <p className="text-sm text-gray-500">{description}</p>
      </div>
    );
  }

  return (
    <Link href={href} className="block border rounded-2xl p-4 hover:border-blue-400 hover:shadow-sm transition-all group">
      <h2 className="font-medium mb-1 group-hover:text-blue-600 transition-colors">{title}</h2>
      <p className="text-sm text-gray-500">{description}</p>
    </Link>
  );
}
