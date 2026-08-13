import { log } from "@/server/log";
import { malformed, ok, unavailable } from "@/server/armory/http";
import { unlockStaffSession } from "@/server/armory/staff-session";
import { requireDevice } from "@/server/sync/http";

/**
 * POST /api/auth/staff/unlock — §7's identity group, §10's "short local unlock".
 *
 * The one endpoint that does NOT require a staff session, because it is how one
 * is obtained. It requires the other factor instead: `requireDevice` proves the
 * request came from a tablet the founder registered, and the PIN in the body
 * proves which officer is holding it.
 *
 * ===========================================================================
 * WHY THE DEVICE CHECK COMES FIRST
 *
 * It costs one query and it means a PIN is never verified for a caller who
 * cannot possibly succeed. Without it this endpoint would be an oracle: anyone
 * on the internet could grind six-digit PINs against every officer in the club,
 * and the lockout in staff-session.ts — designed for someone holding the tablet
 * — would instead be a denial of service that locks the whole club out by
 * guessing wrongly five times per officer.
 *
 * That is the difference between a second factor and a password, and it is the
 * reason §10 specifies "device-bound" rather than just "a local unlock".
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireDevice(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return malformed("This request could not be read.");
  }

  const raw = body as Record<string, unknown>;
  if (typeof raw?.staffUserId !== "string" || typeof raw?.pin !== "string") {
    return malformed("An unlock needs the officer and their PIN.");
  }

  let result;
  try {
    result = await unlockStaffSession({
      deviceId: auth.device.deviceId,
      staffUserId: raw.staffUserId,
      pin: raw.pin,
      now: new Date(),
    });
  } catch (error) {
    log.error("armory.unlock.failed", {
      deviceId: auth.device.deviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return unavailable("The club's system could not be reached just now.");
  }

  if (!result.ok) {
    /**
     * 401 with the reason, and deliberately not 403.
     *
     * A wrong PIN is a failure to authenticate, and the client's correct
     * response is to ask for it again. `result.reason` is already written for
     * the officer — including the lockout case, which says how long — so it is
     * passed through rather than replaced with a generic line.
     */
    log.warn("armory.unlock.refused", {
      deviceId: auth.device.deviceId,
      staffUserId: raw.staffUserId,
    });

    return new Response(
      JSON.stringify({ reason: result.reason, remedy: null }),
      {
        status: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }

  return ok({
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
    staff: result.staff,
  });
}
