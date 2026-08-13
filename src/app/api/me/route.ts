import { ok, requireStaff } from "@/server/armory/http";
import { endStaffSession } from "@/server/armory/staff-session";
import { readDeviceToken } from "@/server/sync/device-auth";

/**
 * GET /api/me — §7's identity group.
 *
 * Who is holding this device, as far as the server is concerned. The desk calls
 * it on load to decide whether to show the unlock screen, and it is the only
 * honest way to answer that: a session can end server-side — expiry, the
 * founder revoking the tablet (§10) — without the client hearing about it, so a
 * client that trusted its own cached identity would show an officer's name over
 * a session that no longer exists.
 *
 * `read_only` is permitted here. It is the one endpoint where that role must
 * work, because a read-only user still has to know who they are signed in as.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireStaff(request, { atLeast: "read_only" });
  if ("response" in auth) return auth.response;

  return ok({ staff: auth.staff });
}

/**
 * DELETE /api/me — sign out at the end of a shift.
 *
 * §10 asks for sessions that are "short"; this is the other half, an officer
 * ending one deliberately rather than waiting for it to lapse. Idempotent: a
 * second call with an already-ended token is a no-op that still answers 200,
 * because a sign-out that reports failure invites the officer to try again and
 * there is nothing to retry.
 */
export async function DELETE(request: Request): Promise<Response> {
  const token = readDeviceToken(request);
  if (token) await endStaffSession(token, new Date());

  return ok({ signedOut: true });
}
