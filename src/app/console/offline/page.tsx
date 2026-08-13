import type { Metadata } from "next";

/**
 * The console's last-resort screen, served by the service worker when a request
 * inside /console/ has no network and nothing cached — which in practice means a
 * device whose shell precache failed, or one visiting a console URL for the first
 * time while offline.
 *
 * It should almost never be reached. `matchShell` in public/console/sw.js answers
 * every in-scope navigation with the app shell, so a device that has ever
 * successfully installed the worker gets the real desk. This is what is left when
 * that did not happen.
 *
 * A real route rather than a string of HTML inside the worker, for the same reason
 * the member offline page is: it is precached by URL, it is styled by the same
 * stylesheet as everything else, and a page assembled from a string literal in a
 * service worker is a page nobody ever looks at again.
 *
 * ===========================================================================
 * WHAT IT DOES NOT SAY
 *
 * It does not say "error", and it does not tell an officer to check their
 * connection — they are standing in a building where §1.1 says the power and the
 * internet are unreliable, and they know. It says what is true: this tablet has not
 * finished setting itself up, and that is a founder's job, not theirs.
 */
export const metadata: Metadata = {
  title: "Desk unavailable",
  robots: { index: false, follow: false },
};

export const dynamic = "force-static";

export default function ConsoleOfflinePage() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          This tablet has not finished setting up.
        </h1>
        <p className="mt-3 text-[--color-sight-ink]">
          The desk needs one connection to the club&rsquo;s system before it can
          work offline. Until then it cannot open without the internet.
        </p>
        <p className="mt-2 text-[--color-sight-ink]">
          A founder can complete this from the owner dashboard. Once it has synced
          once, it will open with no connection at all.
        </p>
      </div>
    </div>
  );
}
