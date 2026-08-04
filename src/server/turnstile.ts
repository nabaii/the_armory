/**
 * CLOUDFLARE TURNSTILE verification.
 *
 * ---------------------------------------------------------------------------
 * WHY TURNSTILE AND NOT reCAPTCHA
 *
 * Spec §7: "No third-party advertising trackers on pages handling personal
 * data." reCAPTCHA is operated by Google as part of an advertising business and
 * sets cookies and fingerprints in that context. Putting it on the membership
 * application page — the page that collects the name, phone number and email of
 * a wealthy Abuja resident — would breach that requirement directly.
 *
 * Turnstile is privacy-preserving by design, sets no tracking cookies, and does
 * not feed an ad graph. It is also the only choice consistent with the
 * privacy-respecting analytics decision in the same section.
 *
 * ---------------------------------------------------------------------------
 * FAIL-OPEN, DELIBERATELY
 *
 * If Turnstile is not configured, or its API is unreachable, verification
 * passes. That is a considered trade-off rather than an oversight.
 *
 * Flow A is the primary conversion event, and the site's whole job is to convert
 * a sceptical visitor who arrived from a friend's WhatsApp link. Failing closed
 * would mean a Cloudflare incident silently blocks every membership application
 * — trading a small amount of spam for the entire funnel.
 *
 * The honeypot still runs, rate limiting still runs, and every submission still
 * lands with a human who can spot nonsense. Spam that reaches a person is an
 * annoyance; a lost application is unrecoverable revenue.
 *
 * A hard verification failure (Turnstile reachable, token genuinely invalid) is
 * still rejected — that is a real signal, not an outage.
 * ---------------------------------------------------------------------------
 */

import { env, isConfigured } from "@/server/env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileOutcome =
  | { ok: true; reason: "verified" | "not-configured" | "unavailable" }
  | { ok: false; reason: "invalid" | "missing-token" };

export async function verifyTurnstile(
  token: string | null,
  remoteIp: string | null,
): Promise<TurnstileOutcome> {
  if (!isConfigured.turnstile()) return { ok: true, reason: "not-configured" };

  /* Configured but no token: the widget did not render or was stripped. Treat
     as unavailable rather than invalid — see the fail-open note above. */
  if (!token) return { ok: true, reason: "unavailable" };

  const body = new URLSearchParams({
    secret: env.turnstileSecret!,
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      /* Never let bot defence hold an applicant's submission open. */
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) return { ok: true, reason: "unavailable" };

    const result = (await response.json()) as { success?: boolean };
    return result.success === true
      ? { ok: true, reason: "verified" }
      : { ok: false, reason: "invalid" };
  } catch {
    /* Timeout, DNS, network — an outage, not an attack. */
    return { ok: true, reason: "unavailable" };
  }
}
