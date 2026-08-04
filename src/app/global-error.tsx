"use client";

import { fontVariables } from "@/lib/fonts";
import "./globals.css";

/**
 * Root error boundary.
 *
 * Defined for a brand reason, not only a resilience one. Next's built-in
 * global-error component is serialized into the payload of EVERY page, and it
 * carries inline styles that set `body{color:#000;background:#fff}` plus a
 * `prefers-color-scheme: dark` block inverting to pure black. Brand Guidelines
 * §11 lists "pure black, cool greys, and any palette drift toward gunmetal"
 * first among things to avoid, and this brand has no dark mode at all. Leaving
 * the default in place ships those declarations on every route.
 *
 * `global-error` replaces the root layout when it renders, so it owns its own
 * <html> and <body> and must re-apply the font variables itself.
 *
 * Voice: state the fact, offer the way out, do not apologise or explain.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en-NG" className={`${fontVariables} h-full`}>
      <body className="flex min-h-full flex-col bg-chalk text-reticle-black">
        <main className="mx-auto flex max-w-content flex-1 flex-col justify-center px-3 py-12 lg:px-8">
          <p className="u-kicker text-sight-ink">Error</p>
          <h1 className="mt-3 font-display text-h1">
            Something went wrong at our end.
          </h1>
          <p className="u-measure mt-3 text-body-lg text-sight-ink">
            The page could not be loaded. Try again, and if it persists please
            contact the club directly.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-6 items-center justify-center rounded-control bg-ten-ring-deep px-4 py-2 font-display text-body font-bold text-white"
            >
              Try again
            </button>
            {/* A plain anchor, deliberately, not next/link. This boundary
                renders when the React tree above it has failed, which can
                include the router itself — a client-side transition would try
                to navigate with the very machinery that just broke. A full
                document request is the only reliable way out. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex min-h-6 items-center justify-center rounded-control border border-reticle-black px-4 py-2 font-display text-body font-bold text-reticle-black no-underline"
            >
              Return home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
