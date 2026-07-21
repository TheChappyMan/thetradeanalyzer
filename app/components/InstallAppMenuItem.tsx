"use client";

/**
 * InstallAppMenuItem — "Download the App" entry for the mobile nav drawer.
 *
 * The "app" is this site installed to the home screen (PWA / Add to Home
 * Screen). Behavior by platform:
 *   - Android/Chrome: captures the browser's beforeinstallprompt event and
 *     triggers the real install prompt on tap.
 *   - iOS Safari (no programmatic install allowed by Apple): shows short
 *     Share → Add to Home Screen instructions.
 *   - Already installed (standalone display mode): renders nothing.
 */

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallAppMenuItem({ onNavigate }: { onNavigate?: () => void }) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // Hide entirely when already running as an installed app
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari legacy flag
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setStandalone(isStandalone);

    setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (standalone) return null;

  async function handleClick() {
    if (installEvent) {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === "accepted") {
        setInstallEvent(null);
        onNavigate?.();
      }
    } else {
      setShowHelp((v) => !v);
    }
  }

  return (
    <>
      <button
        className="nav-link py-3 text-left w-full"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
        onClick={handleClick}
      >
        📲 Download the App
      </button>

      {showHelp && (
        <div
          className="text-xs py-3 px-3 rounded-lg my-2 leading-relaxed"
          style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
        >
          {isIos ? (
            <>
              <strong>Install on iPhone/iPad:</strong> tap the{" "}
              <strong>Share</strong> button{" "}
              <span aria-hidden>(the square with an arrow)</span> in Safari,
              then choose <strong>&ldquo;Add to Home Screen&rdquo;</strong>. The Trade
              Analyzer will open full-screen like a regular app.
            </>
          ) : (
            <>
              <strong>Install this app:</strong> open your browser&apos;s menu
              (⋮) and choose <strong>&ldquo;Add to Home Screen&rdquo;</strong> or{" "}
              <strong>&ldquo;Install app&rdquo;</strong>. The Trade Analyzer will open
              full-screen like a regular app.
            </>
          )}
        </div>
      )}
    </>
  );
}
