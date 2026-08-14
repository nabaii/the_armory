import { dashboard } from "@/server/armory/dashboard";
import { handleRead, requireStaff } from "@/server/armory/http";

/**
 * GET /api/dashboard — §6.6, §7's reporting group, §11 M9.
 *
 *   §6.6: "Roster against cap with waitlist depth; hosting rate; guest-to-
 *    application conversion; admissions by host; occupancy by day and slot
 *    separating member and guest load; lapse list; revenue by source;
 *    reconciliation exceptions; expiries within 90 days; overrides in the last
 *    7 days."
 *
 * ===========================================================================
 * FOUNDER ONLY, AND NOT BECAUSE THE NUMBERS ARE SECRET
 *
 * Most of what this returns is visible elsewhere to a range officer — the
 * exception list, who is on the roster, what expires. The restriction is about
 * what the WHOLE of it is, together: revenue by source, a ranking of which
 * members bring people who join, and every override any officer has made in the
 * last week.
 *
 * That last one decides it. §10 requires every staff action to be attributable
 * to a named person, and §12 puts overrides in front of the founder the same
 * day. An officer who can read the list of overrides can see how closely they
 * are being watched, and an officer who can see that is being invited to
 * calibrate. The list has to reach the founder and stop there.
 *
 * ===========================================================================
 * ONE ENDPOINT, NOT TEN
 *
 * §6.6 lists ten metrics and the obvious REST shape is ten resources. They are
 * read together, once, on one screen, on a tablet that may be on a bad link —
 * so ten requests is ten chances to render a dashboard with three panels
 * missing and no explanation.
 *
 * They are also one snapshot. `dashboard()` runs its reads against a single
 * `now`, so the roster count and the exception list describe the same instant.
 * Ten endpoints called in sequence describe ten.
 */

export const dynamic = "force-dynamic";

/** The rates' window, in days. Bounded — see below. */
const MIN_WINDOW = 7;
const MAX_WINDOW = 365;

export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "founder" });
  if ("response" in auth) return auth.response;

  /**
   * The window, from the query string, clamped.
   *
   * Bounded rather than validated-and-refused: a founder who types 5000 wants a
   * long view, and answering with the longest one this endpoint will do is more
   * use than a 400. The upper bound exists because these are full scans (see
   * the note in dashboard.ts) and an unbounded window is an unbounded query on
   * a request anyone with a founder session can repeat.
   */
  const requested = Number(
    new URL(request.url).searchParams.get("windowDays") ?? "",
  );

  const windowDays = Number.isFinite(requested)
    ? Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.trunc(requested)))
    : undefined;

  return handleRead("dashboard.read", async (tx) =>
    dashboard(tx, new Date(), windowDays),
  );
}
