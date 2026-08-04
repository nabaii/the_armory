"use client";

import Script from "next/script";
import { isTurnstileEnabled, turnstileSiteKey } from "@/lib/public-env";

/**
 * Cloudflare Turnstile widget.
 *
 * Renders nothing when no site key is configured, so forms are fully usable in
 * development and the component can be dropped into every form unconditionally.
 * The server side fails open for the same reason (see src/server/turnstile.ts):
 * bot defence must never be the thing that blocks a membership application.
 *
 * `strategy="lazyOnload"` keeps the script off the critical path. Turnstile is
 * needed at submit time, not at first paint, and the LCP target is 2.5s on a
 * mid-range Android over Nigerian mobile data — nothing that can wait should
 * compete with the hero image.
 *
 * Chosen over reCAPTCHA because spec §7 forbids third-party advertising
 * trackers on pages handling personal data. Turnstile sets no tracking cookies
 * and does not feed an ad graph.
 */
export function Turnstile({ className }: { className?: string }) {
  if (!isTurnstileEnabled()) return null;

  return (
    <div className={className}>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="lazyOnload"
      />
      <div
        className="cf-turnstile"
        data-sitekey={turnstileSiteKey()}
        /* Match the brand ground rather than defaulting to dark. */
        data-theme="light"
      />
    </div>
  );
}
