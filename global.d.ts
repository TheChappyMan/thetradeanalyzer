// Global type augmentations for browser APIs injected at runtime.

interface Window {
  /**
   * Google Analytics 4 gtag function, injected by the GA4 script in app/layout.tsx.
   * Only the `event` command is typed here; extend as needed.
   */
  gtag: (
    command: "event" | "config" | "js" | "set",
    targetIdOrEventName: string,
    params?: Record<string, unknown>
  ) => void;
}
