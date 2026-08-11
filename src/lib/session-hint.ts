/**
 * THE SESSION HINT — a client-readable "someone is signed in" flag.
 *
 * ===========================================================================
 * WHY THIS EXISTS RATHER THAN JUST CALLING getMember()
 *
 * The bottom bar swaps between the guest and member sets on every screen,
 * including marketing pages. The obvious implementation is to call
 * `getMember()` in `(site)/layout.tsx` and pass the result down.
 *
 * That would be correct and it would also be expensive in a way that is easy
 * to miss: `getMember()` reads `cookies()`, and reading cookies in a layout
 * opts EVERY ROUTE BENEATH IT into dynamic rendering. The whole marketing site
 * sits beneath that layout. The static prerender is not incidental here — it
 * is the thing `npm run audit` measures, and it is what the recorded 1088ms
 * LCP and 379KB payload are built on. Trading it for two swapped tab labels is
 * a bad trade, and it would be invisible in review.
 *
 * So the session cookie stays exactly as it is, and a second, non-secret
 * cookie is written beside it purely so the client can pick a nav set.
 *
 * ===========================================================================
 * WHY THIS IS NOT A SECURITY HOLE
 *
 * Every property of this cookie was chosen so that forging it achieves
 * nothing:
 *
 *   VALUE      The literal "1". No id, no email, no status, no expiry claim.
 *              There is nothing in it to tamper WITH.
 *   AUTHORITY  None. It is never read on the server and never consulted by
 *              any authorisation path. `requireMember()` still resolves the
 *              httpOnly token against the database on every request.
 *   WORST CASE Someone sets it by hand, sees the member tab set, taps
 *              Leagues, and is redirected to sign-in by the `(member)` layout
 *              guard with their destination preserved. They have given
 *              themselves a slower route to the sign-in page.
 *
 * The session token itself stays httpOnly, so an XSS bug still cannot reach
 * it — that guarantee is untouched. This cookie is deliberately NOT httpOnly
 * because being readable by script is its entire job.
 *
 * ===========================================================================
 * STALENESS
 *
 * It carries the same `maxAge` as the session, so the two expire together. If
 * they ever diverge — a session revoked server-side, say — the failure is a
 * member-looking tab bar that redirects to sign-in on use. Graceful, and the
 * alternative (trusting it for anything) is what would not be.
 */

export const SESSION_HINT_COOKIE = "armory_signed_in";

/**
 * Whether the hint cookie is present.
 *
 * This is the client snapshot of an external store — `document.cookie` is
 * mutated by the server and by other tabs, entirely outside React — so it is
 * consumed through `useSyncExternalStore` rather than copied into state in an
 * effect. Returning a primitive keeps the snapshot stable under `Object.is`,
 * which is what stops the store re-rendering on every commit.
 */
export function getSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => c === `${SESSION_HINT_COOKIE}=1`);
}

/**
 * The server snapshot: always false, so the server renders the guest tab set
 * and the markup React hydrates is identical to the markup it was sent.
 */
export function getSessionHintServerSnapshot(): boolean {
  return false;
}

/**
 * A cookie fires no events when it changes, so there is nothing to subscribe
 * to directly. These two are the moments the answer can have changed without
 * this component rendering, and both matter more once the app is installed
 * than they ever did on a website:
 *
 *   visibilitychange   The member signed in on another tab, or the session
 *                      expired while the app sat in the background. An
 *                      installed app is resumed far more often than a page is
 *                      loaded, so this is the common case, not the edge one.
 *   pageshow           Restored from the back/forward cache, where the whole
 *                      document is revived without re-running any of it.
 */
export function subscribeToSessionHint(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener("pageshow", onChange);
  document.addEventListener("visibilitychange", onChange);

  return () => {
    window.removeEventListener("pageshow", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}
