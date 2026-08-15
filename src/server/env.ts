/**
 * SERVER ENVIRONMENT
 *
 * Every outbound integration is optional at build time and explicit at runtime.
 * Nothing here throws on import — a missing key must not break the build or the
 * marketing pages, which are static and have no need of any of this.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MATTERS MORE THAN THE KEYS
 *
 * An unconfigured integration must FAIL LOUDLY, never silently. Flow A is the
 * primary conversion event on the site, and the Brief is blunt about the
 * consequence of getting this wrong: "A membership-first site with nobody
 * answering applications is a prettier waitlist."
 *
 * The specific failure this file exists to prevent is a route that catches an
 * error, logs it, and returns a success page. That loses an application from a
 * wealthy, sceptical visitor who will never apply twice — and it loses it
 * invisibly, which is worse than an outage. See `src/server/intake.ts`.
 * ---------------------------------------------------------------------------
 */

const read = (key: string): string | null => {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : null;
};

export const env = {
  /* --- Transactional email. Flow A step 4, Flow B steps 5-7. -------------- */
  postmarkToken: read("POSTMARK_SERVER_TOKEN"),
  mailFrom: read("MAIL_FROM"),

  /* Where applications land if the CRM is unreachable, and where booking and
     group notifications go. This is the last line of defence for Flow A. */
  mailFallbackTo: read("MAIL_FALLBACK_TO"),

  /* --- CRM. Flow A step 5 requires a named owner and a CRM record. -------- */
  crmProvider: read("CRM_PROVIDER"), // "hubspot" | "none"
  crmToken: read("CRM_TOKEN"),

  /* --- Payments. Flow B step 4, Naira, card and transfer. ----------------- */
  paystackSecretKey: read("PAYSTACK_SECRET_KEY"),
  paystackPublicKey: read("NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY"),

  /* --- Bot defence. Deliberately Turnstile, not reCAPTCHA: spec §7 forbids
         third-party advertising trackers on pages handling personal data. ---- */
  turnstileSecret: read("TURNSTILE_SECRET_KEY"),
  turnstileSiteKey: read("NEXT_PUBLIC_TURNSTILE_SITE_KEY"),

  /* --- Booking store. See src/server/booking-store.ts for why this is a
         calendar rather than a database. -------------------------------------- */
  googleCalendarId: read("GOOGLE_CALENDAR_ID"),
  googleServiceAccountEmail: read("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  googleServiceAccountKey: read("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),

  /* Public origin, for absolute links in emails. */
  origin: read("NEXT_PUBLIC_ORIGIN"),

  /**
   * The shared secret a scheduler presents to §9's reconciliation endpoint.
   *
   * UNSET MEANS THE SCHEDULER PATH IS CLOSED, not that it is open. A founder
   * with a staff session can still run the sweep by hand — see
   * src/app/api/payments/reconcile/route.ts, which states the reasoning at
   * length, because the other reading of an absent secret is the classic shape
   * of an endpoint that is wide open on the one deployment where somebody
   * forgot to set the variable.
   */
  cronSecret: read("CRON_SECRET"),
} as const;

export const isConfigured = {
  mail: () => Boolean(env.postmarkToken && env.mailFrom),
  mailFallback: () => Boolean(env.mailFallbackTo),
  crm: () => Boolean(env.crmProvider && env.crmProvider !== "none" && env.crmToken),
  payments: () => Boolean(env.paystackSecretKey),
  turnstile: () => Boolean(env.turnstileSecret),
  bookingStore: () =>
    Boolean(
      env.googleCalendarId &&
        env.googleServiceAccountEmail &&
        env.googleServiceAccountKey,
    ),
} as const;

/**
 * Everything an intake route needs to be safe to accept a submission at all.
 *
 * A submission may be accepted if it can be DELIVERED somewhere durable —
 * the CRM, or failing that an email to a real person. If neither exists, the
 * route must refuse rather than accept and drop.
 */
export const canAcceptSubmissions = () =>
  isConfigured.crm() || (isConfigured.mail() && isConfigured.mailFallback());

/** Human-readable configuration report, for the health route and the gate. */
export function configurationReport() {
  return {
    mail: isConfigured.mail(),
    mailFallback: isConfigured.mailFallback(),
    crm: isConfigured.crm(),
    payments: isConfigured.payments(),
    turnstile: isConfigured.turnstile(),
    bookingStore: isConfigured.bookingStore(),
    canAcceptSubmissions: canAcceptSubmissions(),
  };
}
